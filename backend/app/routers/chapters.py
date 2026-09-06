import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session, SQLModel, select

from app.db import get_session
from app.models import (
    Chapter,
    ChapterBrief,
    ChapterSummary,
    GenerationRun,
    Novel,
    Review,
)
from app.routers.planning import get_novel_or_404
from app.services.chapters import (
    ChapterDomainError,
    generate_from_brief,
    get_chapter_or_error,
    machine_check,
)
from app.services.context import build_writing_context, log_injection
from app.services.draft import build_template_draft
from app.services.llm import LLMClient, get_llm_client
from app.services import storage
from app.services.prompts import build_draft_user_prompt


router = APIRouter(prefix="/novels", tags=["chapters"])


class MachineCheckRequest(SQLModel):
    min_word_count: int = 0
    max_word_count: int = 0
    forbidden_words: list[str] = []
    blacklist: list[str] = []
    required_facts: list[str] = []


def _to_http(cause: ChapterDomainError) -> HTTPException:
    return HTTPException(status_code=cause.status_code, detail=cause.detail)


def _retired_write(message: str) -> HTTPException:
    return HTTPException(status_code=410, detail=message)


@router.get("/{novel_id}/chapters", response_model=list[Chapter])
def list_chapters(
    novel_id: int,
    session: Session = Depends(get_session),
) -> list[Chapter]:
    get_novel_or_404(novel_id, session)
    return list(
        session.exec(
            select(Chapter)
            .where(Chapter.novel_id == novel_id)
            .order_by(Chapter.chapter_number)
        ).all()
    )


@router.post("/{novel_id}/chapters", response_model=Chapter, status_code=201)
def create_chapter() -> None:
    raise _retired_write("章节创建已收口到首写 chapters/{N}/brief.md")


@router.post("/{novel_id}/chapters/{chapter_id}/machine-check")
def run_machine_check(
    novel_id: int,
    chapter_id: int,
    payload: MachineCheckRequest,
    session: Session = Depends(get_session),
) -> dict:
    get_novel_or_404(novel_id, session)
    try:
        chapter = get_chapter_or_error(session, novel_id, chapter_id)
    except ChapterDomainError as cause:
        raise _to_http(cause) from cause
    return machine_check(chapter, payload.model_dump())


@router.post("/{novel_id}/chapters/from-brief/{brief_id}", status_code=201)
def generate_chapter_from_brief(
    novel_id: int,
    brief_id: int,
    session: Session = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
) -> dict:
    novel = get_novel_or_404(novel_id, session)
    brief = session.get(ChapterBrief, brief_id)
    if brief is None or brief.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="没有找到这份 D 层简报")

    try:
        return generate_from_brief(session, llm, novel, brief)
    except ChapterDomainError as cause:
        raise _to_http(cause) from cause


@router.post("/{novel_id}/chapters/from-brief/{brief_id}/stream")
def stream_generate_chapter_from_brief(
    novel_id: int,
    brief_id: int,
    session: Session = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
) -> StreamingResponse:
    novel = get_novel_or_404(novel_id, session)
    brief = session.get(ChapterBrief, brief_id)
    if brief is None or brief.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Chapter brief not found")

    existing = session.exec(
        select(Chapter).where(
            Chapter.novel_id == novel.id,
            Chapter.chapter_number == brief.chapter_number,
        )
    ).first()
    if existing is not None and existing.content.strip():
        raise HTTPException(status_code=409, detail="该章已有正文；请先打回或清空后再生成")

    writing_context = build_writing_context(
        session, novel.id, brief.chapter_number, brief_id=brief.id
    )
    log_injection(writing_context, novel_id=novel.id, chapter_number=brief.chapter_number)
    system = (
        "你是中文网文长篇连载作者。严格遵守 A 层约束、C 层剧情弧和 D 层简报，"
        "写出完整章节正文，只输出正文。"
    )
    user = build_draft_user_prompt(novel, [block.item for block in writing_context.selected])
    live_model = llm.settings.is_configured
    fallback_model = (
        "offline-template"
        if not live_model
        else (llm.settings.models.get("draft") or llm.settings.provider)
    )

    def sse(event: str, data: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

    def event_stream():
        yield sse("context", {"manifest": writing_context.manifest()})

        chunks: list[str] = []
        usage: dict = {}
        try:
            if live_model:
                for chunk in llm.stream_messages(
                    "draft",
                    [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    temperature=0.8,
                    usage_out=usage,
                ):
                    chunks.append(chunk)
                    yield sse("delta", {"text": chunk})
            else:
                full = build_template_draft(brief)
                for start in range(0, len(full), 8):
                    chunk = full[start:start + 8]
                    chunks.append(chunk)
                    yield sse("delta", {"text": chunk})
        except Exception as cause:
            yield sse("error", {"message": str(cause), "partial": "".join(chunks)})
            return

        content = "".join(chunks)
        with Session(bind=session.get_bind()) as persist:
            persist_novel = persist.get(Novel, novel.id)
            persist_brief = persist.get(ChapterBrief, brief.id)
            if persist_novel is None or persist_brief is None:
                yield sse("error", {"message": "章节写入时找不到作品或简报", "partial": content})
                return

            chapter = persist.exec(
                select(Chapter).where(
                    Chapter.novel_id == persist_novel.id,
                    Chapter.chapter_number == persist_brief.chapter_number,
                )
            ).first()
            if chapter is None:
                chapter = Chapter(
                    novel_id=persist_novel.id,
                    brief_id=persist_brief.id,
                    chapter_number=persist_brief.chapter_number,
                    status="draft",
                )
            elif chapter.content.strip():
                yield sse("error", {"message": "该章已有正文；请先打回或清空后再生成", "partial": content})
                return

            chapter.content = content
            chapter.word_count = len(content)
            chapter.brief_id = persist_brief.id
            persist.add(chapter)
            persist.commit()
            persist.refresh(chapter)

            run = GenerationRun(
                novel_id=persist_novel.id,
                chapter_id=chapter.id,
                task_type="draft",
                model=str(usage.get("model") or fallback_model),
                input_summary=writing_context.manifest_json(),
                output=content,
                token_input=int(usage.get("token_input", 0)),
                token_output=int(usage.get("token_output", 0)),
                cost_estimate=0.0,
            )
            persist.add(run)
            persist.commit()
            persist.refresh(run)
            check = machine_check(chapter, {"required_facts": persist_brief.required_facts})
            yield sse("done", {
                "chapter": chapter.model_dump(mode="json"),
                "generation_run": run.model_dump(mode="json"),
                "machine_check": check,
            })

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/{novel_id}/chapters/{chapter_id}", response_model=Chapter)
def get_chapter(
    novel_id: int,
    chapter_id: int,
    session: Session = Depends(get_session),
) -> Chapter:
    get_novel_or_404(novel_id, session)
    try:
        return get_chapter_or_error(session, novel_id, chapter_id)
    except ChapterDomainError as cause:
        raise _to_http(cause) from cause


@router.delete("/{novel_id}/chapters/by-number/{chapter_number}", status_code=204)
def delete_chapter(
    novel_id: int, chapter_number: int, session: Session = Depends(get_session)
) -> None:
    """删掉一章，**不顺延后面的章号**。

    第二十六批批注 6：树里那个「删除」他点了三轮，我前两轮都拿「D-13 未决」挡回去。
    这次我把话定了：章号是主键（D-11），顺延会把文件名、目录锚点、弧起止、
    已生成的运行记录一起拖着改，而且改完不可逆；留一个空洞是伤害最小的语义，
    和 D-13「章号只允许末尾追加」也不冲突。
    路径写成 by-number/ 而不是 {chapter_id}：同一个前缀下两种 id 混在一列是事故源。
    """
    novel = get_novel_or_404(novel_id, session)
    chapter = session.exec(
        select(Chapter).where(Chapter.novel_id == novel_id, Chapter.chapter_number == chapter_number)
    ).first()
    if chapter is None:
        raise HTTPException(status_code=404, detail=f"第 {chapter_number} 章还不存在")
    brief = session.get(ChapterBrief, chapter.brief_id) if chapter.brief_id else None
    # 删之前照例留一份现场：删一章同样是手滑，快照要能把它取回来（见「导出与恢复」）
    storage.snapshot(session, novel_id, novel.title)
    for model in (Review, GenerationRun, ChapterSummary):
        for row in session.exec(select(model).where(model.chapter_id == chapter.id)).all():
            session.delete(row)
    session.delete(chapter)
    if brief is not None:
        session.delete(brief)
    session.commit()


@router.put("/{novel_id}/chapters/{chapter_id}", response_model=Chapter)
def update_chapter() -> None:
    raise _retired_write("正文写入已收口到 chapters/{N}/draft.md")
