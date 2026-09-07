import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app import sse
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
    OFFLINE_CHUNK,
    OFFLINE_DRAFT_MODEL,
    ChapterDomainError,
    draft_user_prompt,
    generate_from_brief,
    get_chapter_or_error,
    machine_check,
    persist_draft,
    prepare_draft,
)
from app.services import errors, documents
from app.services.context import build_writing_context, log_injection
from app.services.renumber import densify, renumber_plan, shift_after, vacate
from app.services.draft import build_template_draft
from app.services.llm import DRAFT_TEMPERATURE, LLMClient, get_llm_client
from app.services import storage
from app.services.prompts import DRAFT_SYSTEM_PROMPT


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

    try:
        writing_context = prepare_draft(session, novel, brief)
    except ChapterDomainError as cause:
        raise _to_http(cause) from cause

    system = DRAFT_SYSTEM_PROMPT
    user = draft_user_prompt(novel, writing_context)
    live_model = llm.settings.is_configured
    fallback_model = (
        OFFLINE_DRAFT_MODEL
        if not live_model
        else (llm.settings.models.get("draft") or llm.settings.provider)
    )

    def event_stream():
        yield sse.encode("context", {"manifest": writing_context.manifest()})

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
                    temperature=DRAFT_TEMPERATURE,
                    usage_out=usage,
                ):
                    chunks.append(chunk)
                    yield sse.encode("delta", {"text": chunk})
            else:
                full = build_template_draft(brief)
                for start in range(0, len(full), OFFLINE_CHUNK):
                    chunk = full[start:start + OFFLINE_CHUNK]
                    chunks.append(chunk)
                    yield sse.encode("delta", {"text": chunk})
        except Exception as cause:
            yield sse.encode("error", {"message": str(cause), "partial": "".join(chunks)})
            return

        content = "".join(chunks)
        with Session(bind=session.get_bind()) as persist:
            persist_novel = persist.get(Novel, novel.id)
            persist_brief = persist.get(ChapterBrief, brief.id)
            if persist_novel is None or persist_brief is None:
                yield sse.encode("error", {"message": "章节写入时找不到作品或简报", "partial": content})
                return

            try:
                outcome = persist_draft(
                    persist,
                    persist_novel.id,
                    persist_brief,
                    writing_context,
                    content,
                    str(usage.get("model") or fallback_model),
                    int(usage.get("token_input", 0)),
                    int(usage.get("token_output", 0)),
                )
            except ChapterDomainError as cause:
                # 事件流不能抛：抛了前端只会看到一条断掉的流，拿不到 partial
                yield sse.encode("error", {"message": cause.detail, "partial": content})
                return
            yield sse.encode("done", {
                "chapter": outcome["chapter"].model_dump(mode="json"),
                "generation_run": outcome["generation_run"].model_dump(mode="json"),
                "machine_check": outcome["machine_check"],
            })

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers=sse.HEADERS,
    )


@router.get("/{novel_id}/chapters/renumber-plan", response_model=dict)
def read_renumber_plan(
    novel_id: int, session: Session = Depends(get_session)
) -> dict:
    """「重新编号」会改哪些号 - 先给他看这张表，再决定要不要按。

    路径必须排在 /chapters/{chapter_id} 前面注册：那条的 chapter_id 是 int，
    晚一步这里就只会拿到一个 422，而不是我的报告。
    """
    get_novel_or_404(novel_id, session)
    return renumber_plan(session, novel_id)


@router.post("/{novel_id}/chapters/densify", response_model=dict)
def densify_chapter_numbers(
    novel_id: int, session: Session = Depends(get_session)
) -> dict:
    """把章号压成 1..N。**只搬号，不动章名**（主人 2026-09-07 批注 5 第 3 条）。

    这是他自己按下的键，不是开机自动跑的迁移 - 那正是 28.6b 被驳回的理由。
    动手前照例落一份快照（reason="renumber"），设置里能拿回来。
    """
    novel = get_novel_or_404(novel_id, session)
    plan = renumber_plan(session, novel_id)
    if plan["already_contiguous"]:
        return {"moved": 0, "changes": [], "already": True, "numbers": plan["numbers"]}
    storage.snapshot(session, novel_id, novel.title, reason="renumber")
    moved = densify(session, novel_id)
    session.commit()
    return {
        "moved": moved,
        "changes": plan["changes"],
        "already": False,
        # 取的是列不是 ORM 对象：Chapter 不能按下标读（真机 500 过一次）
        "numbers": list(
            session.exec(
                select(Chapter.chapter_number)
                .where(Chapter.novel_id == novel_id)
                .order_by(Chapter.chapter_number)
            ).all()
        ),
    }


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
    storage.snapshot(session, novel_id, novel.title, reason="chapter")
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
    storage.snapshot(session, novel_id, novel.title, reason="room")
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
        raise HTTPException(**errors.http_kwargs(cause)) from cause
    # write_file 里 commit 过，对象已经过期；不先 refresh 就只赋一个 title，
    # 序列化出来会只剩 title 这一个键（我第一次就这么栽的）。
    session.refresh(chapter)
    chapter.title = title
    return chapter


@router.put("/{novel_id}/chapters/{chapter_id}", response_model=Chapter)
def update_chapter() -> None:
    raise _retired_write("正文写入已收口到 chapters/{N}/draft.md")
