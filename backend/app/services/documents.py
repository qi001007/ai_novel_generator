"""Project the four planning layers onto editable Markdown documents.

The database stays the source of truth: a document is a rendering of it, and a
write is parsed back into it. Headings and field labels are structure and the
rest is content, so an ``ai`` actor may only touch the values it is allowed to
touch. The Markdown grammar itself lives in ``markdown_doc``.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Any

from sqlmodel import Session, select

from app.models import (
    ArcPlan,
    ChapterBrief,
    PlanningBlueprint,
    TocEntry,
    utc_now,
)
from app.services import markdown_doc


ACTOR_HUMAN = "human"
ACTOR_AI = "ai"
ACTORS = (ACTOR_HUMAN, ACTOR_AI)

BLUEPRINT_PATH = "blueprint.md"
TOC_PATH = "toc.md"
ARCS_PATH = "arcs.md"

BLUEPRINT_FIELDS = ("main_line", "ending", "core_conflicts", "themes", "constraints")
BLUEPRINT_AI_FIELDS = BLUEPRINT_FIELDS

TOC_FIELDS = ("chapter", "title", "plot_function", "notes")
TOC_AI_FIELDS = ("title", "plot_function", "notes")

ARC_FIELDS = (
    "arc",
    "title",
    "start_chapter",
    "end_chapter",
    "objective",
    "conflict",
    "resolution",
    "status",
)
ARC_AI_FIELDS = ("title", "objective", "conflict", "resolution", "status")

BRIEF_FIELDS = (
    "chapter",
    "arc",
    "goal",
    "events",
    "pov",
    "characters",
    "conflict",
    "hook",
    "required_facts",
    "status",
)
BRIEF_AI_FIELDS = ("goal", "events", "pov", "characters", "conflict", "hook", "required_facts", "status")

# The codec owns the field vocabulary, so the type sets are read from it.
_INT_FIELDS = markdown_doc.INT_FIELDS
_OPTIONAL_INT_FIELDS = markdown_doc.OPTIONAL_INT_FIELDS
_LIST_FIELDS = markdown_doc.LIST_FIELDS

_BRIEF_NAME = re.compile(r"^briefs/([0-9]{1,6})\.md$")


class DocumentError(Exception):
    def __init__(self, detail: str, status_code: int = 422) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


@dataclass(frozen=True)
class FileMeta:
    path: str
    kind: str
    layer: str
    label: str


@dataclass
class FileDoc:
    path: str
    kind: str
    layer: str
    label: str
    text: str
    ai_fields: tuple[str, ...]
    revision: str


@dataclass
class WriteResult:
    path: str
    changed: list[str] = field(default_factory=list)
    revision: str = ""


def render_document(kind: str, payload: Any, *, chapter: int | None = None) -> str:
    """Render a layer model to Markdown through the codec."""
    return markdown_doc.render(kind, payload, chapter=chapter)


def load_document(kind: str, body: str, *, chapter: int | None = None) -> Any:
    """Parse a document body, mapping codec complaints onto HTTP errors."""
    try:
        return markdown_doc.parse(kind, body, chapter=chapter)
    except markdown_doc.MarkdownError as cause:
        raise DocumentError(cause.detail) from cause



def _touch(record: Any) -> None:
    """Refresh ``updated_at`` only where the table actually has one."""
    if "updated_at" in type(record).model_fields:
        record.updated_at = utc_now()


def _revision(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:12]


def _block(value: str) -> str:
    return (value or "").rstrip()


def _as_text(value: Any, label: str) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    raise DocumentError(f"{label} 必须是文本")


def _as_int(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise DocumentError(f"{label} 必须是整数")
    return value


def _as_optional_int(value: Any, label: str) -> int | None:
    if value is None:
        return None
    return _as_int(value, label)


def _as_list(value: Any, label: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise DocumentError(f"{label} 必须是字符串列表")
    return list(value)


def resolve_path(path: str) -> tuple[str, int | None]:
    """Map a document path onto (kind, chapter number)."""
    normalized = (path or "").lstrip("/").replace("\\", "/")
    if normalized == BLUEPRINT_PATH:
        return "blueprint", None
    if normalized == TOC_PATH:
        return "toc", None
    if normalized == ARCS_PATH:
        return "arcs", None
    match = _BRIEF_NAME.match(normalized)
    if match:
        number = int(match.group(1))
        if number < 1:
            raise DocumentError("章号从 1 开始", status_code=404)
        return "brief", number
    raise DocumentError(f"没有这个文件：{path}", status_code=404)


def brief_path(chapter_number: int) -> str:
    return f"briefs/{chapter_number:04d}.md"


# --- proposal pre-flight ---------------------------------------------------

_FIELDS_BY_KIND: dict[str, tuple[str, ...]] = {
    "blueprint": BLUEPRINT_FIELDS,
    "toc": TOC_FIELDS,
    "arcs": ARC_FIELDS,
    "brief": BRIEF_FIELDS,
}
_LIST_KINDS = frozenset({"toc", "arcs"})


def validate_structure(path: str, text: str) -> str:
    """Return "" when a writer could take `text`, else why it cannot.

    A proposal arrives beside a diff and an 应用 button, so a shape the writer is
    certain to reject -- a renamed, missing or extra key -- has to be caught when
    the card is drawn, not after the reader clicks it.
    """
    kind, _ = resolve_path(path)
    try:
        parsed = load_document(kind, text)
    except DocumentError as cause:
        return cause.detail

    if kind in _LIST_KINDS:
        if not isinstance(parsed, list):
            return f"{path} 必须是「## …」的记录列表"
        records = list(enumerate(parsed, start=1))
        labels = [f"{path} 第 {index} 条" for index, _ in records]
    else:
        if not isinstance(parsed, dict):
            return f"{path} 必须是键值映射"
        records = list(enumerate([parsed], start=1))
        labels = [path]

    fields = _FIELDS_BY_KIND[kind]
    for (_, record), label in zip(records, labels):
        try:
            _require_keys(record, fields, label)
        except DocumentError as cause:
            return cause.detail
    return ""


# --- active records -------------------------------------------------------


def active_blueprint(session: Session, novel_id: int) -> PlanningBlueprint | None:
    """The only reader for the A layer: newest active version (PRD 6.1).

    Chat context and draft context both go through here, so the blueprint a chapter is
    written against is the blueprint the file view shows.
    """
    return session.exec(
        select(PlanningBlueprint)
        .where(PlanningBlueprint.novel_id == novel_id, PlanningBlueprint.is_active == True)  # noqa: E712
        .order_by(PlanningBlueprint.version.desc(), PlanningBlueprint.id.desc())
    ).first()


def _toc_rows(session: Session, novel_id: int) -> list[TocEntry]:
    return list(
        session.exec(
            select(TocEntry)
            .where(TocEntry.novel_id == novel_id, TocEntry.is_active == True)  # noqa: E712
            .order_by(TocEntry.chapter_number)
        ).all()
    )


def _arc_rows(session: Session, novel_id: int) -> list[ArcPlan]:
    return list(
        session.exec(
            select(ArcPlan)
            .where(ArcPlan.novel_id == novel_id)
            .order_by(ArcPlan.start_chapter)
        ).all()
    )


def _brief(session: Session, novel_id: int, chapter_number: int) -> ChapterBrief | None:
    return session.exec(
        select(ChapterBrief).where(
            ChapterBrief.novel_id == novel_id,
            ChapterBrief.chapter_number == chapter_number,
        )
    ).first()


# --- rendering ------------------------------------------------------------


def _blueprint_model(bp: PlanningBlueprint | None) -> dict[str, str]:
    return {name: _block(getattr(bp, name, "") if bp else "") for name in BLUEPRINT_FIELDS}


def _toc_model(rows: list[TocEntry]) -> list[dict[str, Any]]:
    return [
        {
            "chapter": row.chapter_number,
            "title": _block(row.title),
            "plot_function": _block(row.plot_function),
            "notes": _block(row.notes),
        }
        for row in rows
    ]


def _arcs_model(rows: list[ArcPlan]) -> list[dict[str, Any]]:
    return [
        {
            "arc": row.id,
            "title": _block(row.title),
            "start_chapter": row.start_chapter,
            "end_chapter": row.end_chapter,
            "objective": _block(row.objective),
            "conflict": _block(row.conflict),
            "resolution": _block(row.resolution),
            "status": row.status,
        }
        for row in rows
    ]


def _brief_model(brief: ChapterBrief | None, chapter_number: int) -> dict[str, Any]:
    arc = getattr(brief, "arc_plan_id", None) if brief else None
    return {
        "chapter": chapter_number,
        "arc": arc if arc else None,
        "goal": _block(brief.goal if brief else ""),
        "events": _block(brief.events if brief else ""),
        "pov": _block(brief.pov if brief else ""),
        "characters": list(brief.characters) if brief else [],
        "conflict": _block(brief.conflict if brief else ""),
        "hook": _block(brief.hook if brief else ""),
        "required_facts": list(brief.required_facts) if brief else [],
        "status": brief.status if brief else "draft",
    }


def list_files(session: Session, novel_id: int) -> list[FileMeta]:
    files = [
        FileMeta(BLUEPRINT_PATH, "blueprint", "A", "全书蓝图"),
        FileMeta(TOC_PATH, "toc", "B", "目录"),
        FileMeta(ARCS_PATH, "arcs", "C", "剧情弧"),
    ]
    for brief in session.exec(
        select(ChapterBrief)
        .where(ChapterBrief.novel_id == novel_id)
        .order_by(ChapterBrief.chapter_number)
    ).all():
        files.append(
            FileMeta(
                brief_path(brief.chapter_number),
                "brief",
                "D",
                f"第 {brief.chapter_number} 章简报",
            )
        )
    return files


def read_file(session: Session, novel_id: int, path: str) -> FileDoc:
    kind, number = resolve_path(path)
    if kind == "blueprint":
        model = _blueprint_model(active_blueprint(session, novel_id))
        text = render_document("blueprint", model)
        return FileDoc(BLUEPRINT_PATH, kind, "A", "全书蓝图", text, BLUEPRINT_AI_FIELDS, _revision(text))
    if kind == "toc":
        model = _toc_model(_toc_rows(session, novel_id))
        text = render_document("toc", model)
        return FileDoc(TOC_PATH, kind, "B", "目录", text, TOC_AI_FIELDS, _revision(text))
    if kind == "arcs":
        model = _arcs_model(_arc_rows(session, novel_id))
        text = render_document("arcs", model)
        return FileDoc(ARCS_PATH, kind, "C", "剧情弧", text, ARC_AI_FIELDS, _revision(text))

    assert number is not None
    model = _brief_model(_brief(session, novel_id, number), number)
    text = render_document("brief", model, chapter=number)
    return FileDoc(
        brief_path(number), kind, "D", f"第 {number} 章简报", text, BRIEF_AI_FIELDS, _revision(text)
    )


# --- validation helpers ---------------------------------------------------


def _require_keys(mapping: Any, expected: tuple[str, ...], label: str) -> dict[str, Any]:
    if not isinstance(mapping, dict):
        raise DocumentError(f"{label} 必须是键值映射")
    missing = [name for name in expected if name not in mapping]
    extra = [name for name in mapping if name not in expected]
    if missing or extra:
        parts = []
        if missing:
            parts.append(f"缺少 {', '.join(missing)}")
        if extra:
            parts.append(f"多出 {', '.join(extra)}")
        raise DocumentError(f"{label} 的键名是结构标识，不可增删改名：" + "；".join(parts))
    return mapping


def _require_same_ids(rows: list[dict[str, Any]], before: list[int], identity: str, label: str) -> None:
    after = [_as_int(row.get(identity), f"{label}.{identity}") for row in rows]
    if after != before:
        raise DocumentError(
            f"AI 不能增删条目或改动 {identity} 主键（{label}）：期望 {before}，收到 {after}"
        )


def _require_ai_values(
    allowed: tuple[str, ...], before: dict[str, Any], after: dict[str, Any], label: str
) -> list[str]:
    locked = [
        name
        for name in before
        if name not in allowed and before[name] != after.get(name)
    ]
    if locked:
        raise DocumentError(
            f"AI 只能改这些字段：{', '.join(allowed)}；"
            f"以下受保护字段被改动：{', '.join(locked)}（{label}）"
        )
    return [name for name in before if before[name] != after.get(name)]


def _coerce(mapping: dict[str, Any], expected: tuple[str, ...], label: str) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for name in expected:
        raw = mapping[name]
        if name in _INT_FIELDS:
            out[name] = _as_int(raw, f"{label}.{name}")
        elif name in _OPTIONAL_INT_FIELDS:
            out[name] = _as_optional_int(raw, f"{label}.{name}")
        elif name in _LIST_FIELDS:
            out[name] = _as_list(raw, f"{label}.{name}")
        else:
            out[name] = _as_text(raw, f"{label}.{name}")
    return out


def _coerce_optional_arc(mapping: dict[str, Any], label: str) -> int | None:
    return _as_optional_int(mapping.get("arc"), f"{label}.arc")


# --- writing --------------------------------------------------------------


def write_file(
    session: Session,
    novel_id: int,
    path: str,
    text: str,
    *,
    actor: str = ACTOR_HUMAN,
    base_revision: str | None = None,
) -> WriteResult:
    if actor not in ACTORS:
        raise DocumentError(f"未知的写入者：{actor}")

    kind, number = resolve_path(path)
    current = read_file(session, novel_id, path)
    if base_revision is not None and base_revision != current.revision:
        raise DocumentError(
            f"{path} 已被其它写入改过（{base_revision} → {current.revision}），请重载后再写",
            status_code=409,
        )

    parsed = load_document(kind, text, chapter=number)
    writer = {
        "blueprint": _write_blueprint,
        "toc": _write_toc,
        "arcs": _write_arcs,
        "brief": _write_brief,
    }[kind]
    changed = writer(session, novel_id, parsed, actor=actor, number=number)
    session.commit()

    after = read_file(session, novel_id, path)
    return WriteResult(path=current.path, changed=changed, revision=after.revision)


def _write_blueprint(
    session: Session, novel_id: int, parsed: Any, *, actor: str, number: int | None
) -> list[str]:
    data = _require_keys(parsed, BLUEPRINT_FIELDS, BLUEPRINT_PATH)
    values = _coerce(data, BLUEPRINT_FIELDS, BLUEPRINT_PATH)

    bp = active_blueprint(session, novel_id)
    if bp is None:
        bp = PlanningBlueprint(novel_id=novel_id, version=1, is_active=True)
        session.add(bp)
        session.flush()

    before = _blueprint_model(bp)
    changed = (
        _require_ai_values(BLUEPRINT_AI_FIELDS, before, values, BLUEPRINT_PATH)
        if actor == ACTOR_AI
        else [name for name in BLUEPRINT_FIELDS if before[name] != values[name]]
    )
    for name in changed:
        setattr(bp, name, values[name])
    _touch(bp)
    session.add(bp)
    return changed


def _write_toc(
    session: Session, novel_id: int, parsed: Any, *, actor: str, number: int | None
) -> list[str]:
    if not isinstance(parsed, list):
        raise DocumentError(f"{TOC_PATH} 必须是「## 第 N 章 …」的记录列表")

    rows = [_require_keys(row, TOC_FIELDS, f"{TOC_PATH} 第 {i + 1} 条") for i, row in enumerate(parsed)]
    existing = _toc_rows(session, novel_id)
    before_model = _toc_model(existing)

    if actor == ACTOR_AI:
        _require_same_ids(rows, [row["chapter"] for row in before_model], "chapter", TOC_PATH)
        changed: list[str] = []
        # Identities are verified equal and in order, so rows pair up by index.
        for row, before, raw in zip(existing, before_model, rows):
            after = _coerce(raw, TOC_FIELDS, TOC_PATH)
            touched = _require_ai_values(TOC_AI_FIELDS, before, after, f"第 {row.chapter_number} 章")
            for name in touched:
                setattr(row, name, after[name])
                changed.append(f"{row.chapter_number}.{name}")
            _touch(row)
            session.add(row)
        return changed

    seen: set[int] = set()
    changed = []
    for raw in rows:
        after = _coerce(raw, TOC_FIELDS, TOC_PATH)
        chapter_number = after["chapter"]
        if chapter_number in seen:
            raise DocumentError(f"目录里第 {chapter_number} 章出现了两次")
        seen.add(chapter_number)

        row = next((item for item in existing if item.chapter_number == chapter_number), None)
        if row is None:
            row = TocEntry(novel_id=novel_id, chapter_number=chapter_number, is_active=True)
            session.add(row)
            changed.append(f"{chapter_number}.created")
        for name, value in after.items():
            if name == "chapter":
                continue
            if getattr(row, name) != value:
                setattr(row, name, value)
                changed.append(f"{chapter_number}.{name}")
        _touch(row)

    for row in existing:
        if row.chapter_number not in seen:
            row.is_active = False
            _touch(row)
            session.add(row)
            changed.append(f"{row.chapter_number}.removed")
    return changed


def _write_arcs(
    session: Session, novel_id: int, parsed: Any, *, actor: str, number: int | None
) -> list[str]:
    if not isinstance(parsed, list):
        raise DocumentError(f"{ARCS_PATH} 必须是「## 弧 N …」的记录列表")

    rows = [_require_keys(row, ARC_FIELDS, f"{ARCS_PATH} 第 {i + 1} 条") for i, row in enumerate(parsed)]
    existing = _arc_rows(session, novel_id)
    by_id = {row.id: row for row in existing}
    before_model = _arcs_model(existing)

    if actor == ACTOR_AI:
        _require_same_ids(rows, [row["arc"] for row in before_model], "arc", ARCS_PATH)
        changed: list[str] = []
        for raw in rows:
            after = _coerce(raw, ARC_FIELDS, ARCS_PATH)
            row = by_id[after["arc"]]
            touched = _require_ai_values(
                ARC_AI_FIELDS, _arcs_model([row])[0], after, f"arc {after['arc']}"
            )
            for name in touched:
                setattr(row, name, after[name])
                changed.append(f"{row.id}.{name}")
            _touch(row)
            session.add(row)
        return changed

    changed = []
    seen: set[int] = set()
    for raw in rows:
        after = _coerce(raw, ARC_FIELDS, ARCS_PATH)
        arc_id = after["arc"]
        if arc_id in seen:
            raise DocumentError(f"arc {arc_id} 出现了两次")
        seen.add(arc_id)

        row = by_id.get(arc_id)
        if row is None:
            raise DocumentError(
                f"arc {arc_id} 不存在；新建剧情弧请留 arc: null（由系统分配主键）"
            )
        for name, value in after.items():
            if name == "arc":
                continue
            if getattr(row, name) != value:
                setattr(row, name, value)
                changed.append(f"{arc_id}.{name}")
        _touch(row)
    return changed


def _write_brief(
    session: Session,
    novel_id: int,
    parsed: Any,
    *,
    actor: str,
    number: int | None,
) -> list[str]:
    assert number is not None
    label = brief_path(number)
    data = _require_keys(parsed, BRIEF_FIELDS, label)
    after = _coerce(data, BRIEF_FIELDS, label)

    if after["chapter"] != number:
        raise DocumentError(f"{label} 的 chapter 必须等于文件名里的 {number}；改章号请新建文件")

    brief = _brief(session, novel_id, number)
    if brief is None:
        brief = ChapterBrief(novel_id=novel_id, chapter_number=number)
        session.add(brief)
        session.flush()

    before = _brief_model(brief, number)
    if actor == ACTOR_AI:
        changed = _require_ai_values(BRIEF_AI_FIELDS, before, after, label)
    else:
        changed = [name for name in BRIEF_FIELDS if before[name] != after[name]]

    for name in changed:
        if name == "chapter":
            continue
        if name == "arc":
            arc_id = _coerce_optional_arc(data, label)
            if arc_id is not None and session.get(ArcPlan, arc_id) is None:
                raise DocumentError(f"arc {arc_id} 不存在")
            brief.arc_plan_id = arc_id
        else:
            setattr(brief, name, after[name])
    _touch(brief)
    session.add(brief)
    return changed


def stabilize_proposal(path: str, current_text: str, proposed_text: str) -> str:
    """Stabilise a proposal against the file it would overwrite, by path."""
    try:
        kind, chapter = resolve_path(path)
    except DocumentError:
        return proposed_text
    return markdown_doc.stabilize(kind, current_text, proposed_text, chapter=chapter)


def current_text_reader(session: Session, novel_id: int):
    """Return ``path -> current text`` for the proposal cards drawn in one response."""
    cache: dict[str, str | None] = {}

    def current(path: str) -> str | None:
        if path not in cache:
            try:
                cache[path] = read_file(session, novel_id, path).text
            except DocumentError:
                cache[path] = None
        return cache[path]

    return current
