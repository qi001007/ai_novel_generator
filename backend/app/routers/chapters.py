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
    TocEntry,
)
from app.routers.planning import get_novel_or_404
from app.services.chapters import (
    ChapterDomainError,
    generate_from_brief,
    get_chapter_or_error,
    machine_check,
)
from app.services import documents
from app.services.context import build_writing_context, log_injection
from app.services.renumber import shift_after, vacate
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


class ChapterTitleUpdate(SQLModel):
    """自定义章名。序号不在这个请求里 - 它是位置，不是身份（批注 6）。"""

    title: str


def _titles_from_toc(session: Session, novel_id: int) -> dict[int, str]:
    """章名的唯一出处是 B 目录；`Chapter.title` 读的时候从这里取。

    两处各存一份章名就是第十五批 3.3 那个「两份 buffer 互相覆盖」的形状，
    所以这里不回写 chapter 表。
    """
    return {
        row.chapter_number: row.title
        for row in session.exec(
            select(TocEntry).where(
                TocEntry.novel_id == novel_id, TocEntry.is_active == True  # noqa: E712
            )
        ).all()
    }


@router.get("/{novel_id}/chapters", response_model=list[Chapter])
def list_chapters(
    novel_id: int,
    session: Session = Depends(get_session),
) -> list[Chapter]:
    get_novel_or_404(novel_id, session)
    chapters = list(
        session.exec(
            select(Chapter)
            .where(Chapter.novel_id == novel_id)
            .order_by(Chapter.chapter_number)
        ).all()
    )
    titles = _titles_from_toc(session, novel_id)
    for chapter in chapters:
        chapter.title = titles.get(chapter.chapter_number, "")
    return chapters


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
        chapter = get_chapter_or_error(session, novel_id, chapter_id)
    except ChapterDomainError as cause:
        raise _to_http(cause) from cause
    chapter.title = _titles_from_toc(session, novel_id).get(chapter.chapter_number, "")
    return chapter


@router.delete("/{novel_id}/chapters/by-number/{chapter_number}", status_code=204)
def delete_chapter(
    novel_id: int, chapter_number: int, session: Session = Depends(get_session)
) -> None:
    """删掉一章，后面的章号自动前移（第二十八批批注 6 推翻了第二十六批的「不顺延」）。

    我当时怕的是「顺延拖着改的东西太多」，主人把这件事定了：序号由位置决定、名字由他
    决定。那就整类一起搬 - 目录、简报、摘要、人物出场、弧起止、伏笔章号、设定来源章，
    一个都不留在原处（清单见 services/renumber.py）。运行记录按 chapter_id 走，
    跟着被删那一章一起删，不受搬家影响。
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
    # 目录行 / 章摘要 / 人物出场也说的是这一章，先一起腾空，压号才不会撞唯一约束。
    vacate(session, novel_id, number=chapter_number)
    session.commit()
    # 空洞不留在书架上：后面每一章往前挪一格。
    shift_after(session, novel_id, above=chapter_number, delta=-1)
    session.commit()


@router.post("/{novel_id}/chapters/make-room-after/{chapter_number}", response_model=dict)
def make_room_after(
    novel_id: int, chapter_number: int, session: Session = Depends(get_session)
) -> dict:
    """「在其后插入一章」的前半：把后面的整体后移一格，腾出 chapter_number + 1。

    只搬位置、不建内容 - 新章仍由首写 chapters/{N}/brief.md 落地（D-01 那条唯一写通路
    不变），所以这个端点一行正文都不碰。
    """
    get_novel_or_404(novel_id, session)
    if session.exec(
        select(Chapter).where(
            Chapter.novel_id == novel_id, Chapter.chapter_number == chapter_number
        )
    ).first() is None:
        raise HTTPException(status_code=404, detail=f"第 {chapter_number} 章还不存在")
    novel = session.get(Novel, novel_id)
    storage.snapshot(session, novel_id, novel.title)
    moved = shift_after(session, novel_id, above=chapter_number, delta=1)
    session.commit()
    return {"number": chapter_number + 1, "moved": moved}


@router.patch("/{novel_id}/chapters/by-number/{chapter_number}/title", response_model=Chapter)
def rename_chapter(
    novel_id: int,
    chapter_number: int,
    payload: ChapterTitleUpdate,
    session: Session = Depends(get_session),
) -> Chapter:
    """改章名：写的是 B 目录那一行，走 documents.write_file，也就是唯一那条写通路。

    序号不在可改范围内 - 它由位置决定，要挪位置请用插入 / 删除，别在这里改号。
    """
    get_novel_or_404(novel_id, session)
    chapter = session.exec(
        select(Chapter).where(
            Chapter.novel_id == novel_id, Chapter.chapter_number == chapter_number
        )
    ).first()
    if chapter is None:
        raise HTTPException(status_code=404, detail=f"第 {chapter_number} 章还不存在")
    title = payload.title.strip()
    try:
        doc = documents.read_file(session, novel_id, documents.TOC_PATH)
        rows = documents.load_document("toc", doc.text)
        hit = False
        for row in rows:
            if int(row["chapter"]) == chapter_number:
                row["title"] = title
                hit = True
        if not hit:
            rows.append(
                {"chapter": chapter_number, "title": title, "plot_function": "", "notes": ""}
            )
        documents.write_file(
            session,
            novel_id,
            documents.TOC_PATH,
            documents.render_document("toc", rows),
            base_revision=doc.revision,
        )
    except documents.DocumentError as cause:
        raise HTTPException(status_code=cause.status_code, detail=cause.detail) from cause
    # write_file 里 commit 过，对象已经过期；不先 refresh 就只赋一个 title，
    # 序列化出来会只剩 title 这一个键（我第一次就这么栽的）。
    session.refresh(chapter)
    chapter.title = title
    return chapter


@router.put("/{novel_id}/chapters/{chapter_id}", response_model=Chapter)
def update_chapter() -> None:
    raise _retired_write("正文写入已收口到 chapters/{N}/draft.md")
