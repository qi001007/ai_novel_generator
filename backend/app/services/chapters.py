from sqlmodel import Session, select

from app.models import ArcPlan, Chapter, ChapterBrief, GenerationRun, Novel, PlanningBlueprint
from app.services.draft import build_template_draft
from app.services.llm import LLMClient, LLMError
from app.services.prompts import build_draft_user_prompt


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


def ensure_chapter_number_free(
    session: Session, novel_id: int, chapter_number: int, exclude_id: int | None = None
) -> None:
    statement = select(Chapter).where(
        Chapter.novel_id == novel_id,
        Chapter.chapter_number == chapter_number,
    )
    if exclude_id is not None:
        statement = statement.where(Chapter.id != exclude_id)
    if session.exec(statement).first() is not None:
        raise ChapterDomainError(409, "This chapter already exists")


def generate_from_brief(
    session: Session, llm: LLMClient, novel: Novel, brief: ChapterBrief
) -> dict:
    ensure_chapter_number_free(session, novel.id, brief.chapter_number)

    blueprint = session.exec(
        select(PlanningBlueprint)
        .where(PlanningBlueprint.novel_id == novel.id)
        .order_by(PlanningBlueprint.version)
    ).first()
    arc = session.get(ArcPlan, brief.arc_plan_id) if brief.arc_plan_id else None
    generation_model = "template-v1"
    token_input = 0
    token_output = 0

    if llm.settings.is_configured:
        try:
            result = llm.complete(
                task_type="draft",
                system=(
                    "你是中文网文长篇连载作者。严格遵守 A 层约束、C 层剧情弧和 D 层简报，"
                    "写出完整章节正文，只输出正文。"
                ),
                user=build_draft_user_prompt(novel, blueprint, arc, brief),
            )
        except LLMError as cause:
            raise ChapterDomainError(503, str(cause)) from cause
        content = result.content
        generation_model = result.model
        token_input = result.token_input
        token_output = result.token_output
    else:
        content = build_template_draft(brief)

    chapter = Chapter(
        novel_id=novel.id,
        brief_id=brief.id,
        chapter_number=brief.chapter_number,
        content=content,
        word_count=len(content),
        status="draft",
    )
    session.add(chapter)
    session.commit()
    session.refresh(chapter)

    generation_run = GenerationRun(
        novel_id=novel.id,
        chapter_id=chapter.id,
        task_type="draft",
        model=generation_model,
        input_summary=f"ChapterBrief:{brief.id}",
        output=content,
        token_input=token_input,
        token_output=token_output,
        cost_estimate=0.0,
    )
    session.add(generation_run)
    session.commit()
    session.refresh(generation_run)

    machine_check_result = machine_check(chapter, {"required_facts": brief.required_facts})
    return {
        "chapter": chapter,
        "generation_run": generation_run,
        "machine_check": machine_check_result,
    }
