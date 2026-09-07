from sqlmodel import Session, select

from app.models import Chapter, ChapterBrief, GenerationRun, Novel
from app.services.context import build_writing_context, log_injection
from app.services.draft import build_template_draft
from app.services.llm import DRAFT_TEMPERATURE, LLMClient, LLMError
from app.services.prompts import DRAFT_SYSTEM_PROMPT, build_draft_user_prompt


class ChapterDomainError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def machine_check(chapter: Chapter, rules: dict) -> dict:
    issues: list[dict[str, str]] = []
    if rules.get("min_word_count") and chapter.word_count < rules["min_word_count"]:
        issues.append({"type": "word_count", "message": f"字数少于下限 {rules['min_word_count']}"})
    if rules.get("max_word_count") and chapter.word_count > rules["max_word_count"]:
        issues.append({"type": "word_count", "message": f"字数超过上限 {rules['max_word_count']}"})
    for word in rules.get("forbidden_words", []):
        if word and word in chapter.content:
            issues.append({"type": "forbidden_word", "message": f"命中禁用词：{word}"})
    for phrase in rules.get("blacklist", []):
        if phrase and phrase in chapter.content:
            issues.append({"type": "blacklist", "message": f"命中黑名单：{phrase}"})
    for fact in rules.get("required_facts", []):
        if fact and fact not in chapter.content:
            issues.append({"type": "missing_fact", "message": f"缺少必要事实：{fact}"})
    return {"passed": not issues, "word_count": chapter.word_count, "issues": issues}


def get_chapter_or_error(session: Session, novel_id: int, chapter_id: int) -> Chapter:
    chapter = session.get(Chapter, chapter_id)
    if chapter is None or chapter.novel_id != novel_id:
        raise ChapterDomainError(404, "Chapter not found")
    return chapter


PROSE_EXISTS_DETAIL = "该章已有正文；请先打回或清空后再生成"
OFFLINE_DRAFT_MODEL = "template-v1"
OFFLINE_CHUNK = 8


def existing_chapter(session: Session, novel_id: int, chapter_number: int) -> Chapter | None:
    return session.exec(
        select(Chapter).where(
            Chapter.novel_id == novel_id,
            Chapter.chapter_number == chapter_number,
        )
    ).first()


def prepare_draft(session: Session, novel: Novel, brief: ChapterBrief):
    """一条规则一个主人：先挡「已有正文」，再组上下文、记注入日志。

    两条生成路（流式与非流式）都从这里进，所以「什么情况下不许生成」只写一遍。
    上下文仍然只由 `collect_items()` 那条口出（D-04），这里不拼任何 prompt。
    """
    existing = existing_chapter(session, novel.id, brief.chapter_number)
    if existing is not None and existing.content.strip():
        raise ChapterDomainError(409, PROSE_EXISTS_DETAIL)
    writing_context = build_writing_context(
        session, novel.id, brief.chapter_number, brief_id=brief.id
    )
    log_injection(writing_context, novel_id=novel.id, chapter_number=brief.chapter_number)
    return writing_context


def draft_user_prompt(novel: Novel, writing_context) -> str:
    return build_draft_user_prompt(novel, [block.item for block in writing_context.selected])


def persist_draft(
    session: Session,
    novel_id: int,
    brief: ChapterBrief,
    writing_context,
    content: str,
    model: str,
    token_input: int = 0,
    token_output: int = 0,
) -> dict:
    """写章 + 记一次调用 + 机械校验：两条路共用同一段，字段口径不会各说各话。"""
    chapter = existing_chapter(session, novel_id, brief.chapter_number)
    if chapter is None:
        chapter = Chapter(
            novel_id=novel_id,
            brief_id=brief.id,
            chapter_number=brief.chapter_number,
            content="",
            status="draft",
        )
    elif chapter.content.strip():
        raise ChapterDomainError(409, PROSE_EXISTS_DETAIL)
    chapter.content = content
    chapter.word_count = len(content)
    chapter.brief_id = brief.id
    session.add(chapter)
    session.commit()
    session.refresh(chapter)

    run = GenerationRun(
        novel_id=novel_id,
        chapter_id=chapter.id,
        task_type="draft",
        model=model,
        input_summary=writing_context.manifest_json(),
        output=content,
        token_input=token_input,
        token_output=token_output,
        cost_estimate=0.0,
    )
    session.add(run)
    session.commit()
    session.refresh(run)

    return {
        "chapter": chapter,
        "generation_run": run,
        "machine_check": machine_check(chapter, {"required_facts": brief.required_facts}),
    }


def generate_from_brief(
    session: Session, llm: LLMClient, novel: Novel, brief: ChapterBrief
) -> dict:
    """非流式那一路：只负责「拿全文」，其余决策全在服务里。"""
    writing_context = prepare_draft(session, novel, brief)
    if not llm.settings.is_configured:
        return persist_draft(
            session, novel.id, brief, writing_context,
            build_template_draft(brief), OFFLINE_DRAFT_MODEL,
        )
    try:
        result = llm.complete(
            task_type="draft",
            system=DRAFT_SYSTEM_PROMPT,
            user=draft_user_prompt(novel, writing_context),
        )
    except LLMError as cause:
        raise ChapterDomainError(503, str(cause)) from cause
    # 不传 temperature：`complete_messages` 的回退已经按 task 决定（draft = DRAFT_TEMPERATURE）
    return persist_draft(
        session, novel.id, brief, writing_context,
        result.content, result.model, result.token_input, result.token_output,
    )
