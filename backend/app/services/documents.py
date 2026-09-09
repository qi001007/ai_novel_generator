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
    Chapter,
    ChapterBrief,
    Character,
    Foreshadow,
    PlanningBlueprint,
    Setting,
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
CHARACTER_DIR = "settings/characters"
CHARACTER_NEW_PATH = f"{CHARACTER_DIR}/new.md"
# 帧 26 的三册：与四层规划同级的一份文档，DB 是真源，这里是投影（D-15）。
FORESHADOW_PATH = "settings/foreshadow.md"
WORLDVIEW_PATH = "settings/worldview.md"

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

DRAFT_FIELDS = ("content",)
DRAFT_AI_FIELDS = DRAFT_FIELDS

CHARACTER_FIELDS = (
    "name",
    "level",
    "expected_start_chapter",
    "expected_end_chapter",
    "identity",
    "goals",
    "behavior_constraints",
    "current_status",
)
# 姓名 is not AI-writable: it is unique per novel and the file path (the id) is the
# durable identity, so a rename stays a deliberate human act.
CHARACTER_AI_FIELDS = tuple(name for name in CHARACTER_FIELDS if name != "name")

# 埋设与收束章号只由主人调整，姓名同理不是 AI 能改的：路径里的 id 才是持久身份。
FORESHADOW_FIELDS = (
    "foreshadow",
    "title",
    "planted_chapter",
    "expected_payoff_chapter",
    "payoff_chapter",
    "status",
    "content",
)
FORESHADOW_AI_FIELDS = ("title", "status", "content")

WORLDVIEW_FIELDS = (
    "setting",
    "name",
    "category",
    "is_confirmed",
    "source_chapter",
    "current_state",
    "content",
)
WORLDVIEW_AI_FIELDS = ("category", "current_state", "content")

# The codec owns the field vocabulary, so the type sets are read from it.
_INT_FIELDS = markdown_doc.INT_FIELDS
_OPTIONAL_INT_FIELDS = markdown_doc.OPTIONAL_INT_FIELDS
_LIST_FIELDS = markdown_doc.LIST_FIELDS
_BOOL_FIELDS = markdown_doc.BOOL_FIELDS

_BRIEF_NAME = re.compile(r"^briefs/([0-9]{1,6})\.md$")
_CHAPTER_BRIEF_NAME = re.compile(r"^chapters/([0-9]{1,6})/brief\.md$")
_CHAPTER_DRAFT_NAME = re.compile(r"^chapters/([0-9]{1,6})/(?:draft\.md|)$")
_CHARACTER_NAME = re.compile(r"^settings/characters/([0-9]{1,9})\.md$")


class DocumentError(Exception):
    def __init__(self, detail: str, status_code: int = 422, code: str | None = None) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code
        self.code = code


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
    # 投影自带的语法表（字段↔标签）。默认空：只有走 read_file 的投影才有内容可发。
    grammar: dict = field(default_factory=dict)

    def with_grammar(self):
        self.grammar = markdown_doc.grammar_for_kind(self.kind)
        return self


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
    """Map a path onto (kind, chapter number), folding the model's aliases first.

    canonical_path is the one alias table, and this is the one resolution every entry
    passes through, so read / validate / write cannot disagree about where a path
    points. A None number means the create template: the path a write lands on is
    assigned here and reported back by WriteResult.
    """
    normalized = canonical_path(path)[0]
    if normalized == BLUEPRINT_PATH:
        return "blueprint", None
    if normalized == TOC_PATH:
        return "toc", None
    if normalized == ARCS_PATH:
        return "arcs", None
    match = _BRIEF_NAME.match(normalized)
    if match:
        return "brief", _chapter_number_or_404(int(match.group(1)))
    match = _CHAPTER_BRIEF_NAME.match(normalized)
    if match:
        return "brief", _chapter_number_or_404(int(match.group(1)))
    match = _CHAPTER_DRAFT_NAME.match(normalized)
    if match:
        return "draft", _chapter_number_or_404(int(match.group(1)))
    if normalized == FORESHADOW_PATH:
        return "foreshadow", None
    if normalized == WORLDVIEW_PATH:
        return "worldview", None
    if normalized == CHARACTER_NEW_PATH:
        return "character", None
    match = _CHARACTER_NAME.match(normalized)
    if match:
        return "character", int(match.group(1))
    raise DocumentError(f"没有这个文件：{path}", status_code=404)


def _chapter_number_or_404(number: int) -> int:
    if number < 1:
        raise DocumentError("章号从 1 开始", status_code=404)
    return number


def brief_path(chapter_number: int) -> str:
    return f"chapters/{chapter_number:04d}/brief.md"


def draft_path(chapter_number: int) -> str:
    return f"chapters/{chapter_number:04d}/draft.md"


def character_path(character_id: int) -> str:
    return f"{CHARACTER_DIR}/{character_id}.md"


# --- proposal pre-flight ---------------------------------------------------

_FIELDS_BY_KIND: dict[str, tuple[str, ...]] = {
    "blueprint": BLUEPRINT_FIELDS,
    "toc": TOC_FIELDS,
    "arcs": ARC_FIELDS,
    "brief": BRIEF_FIELDS,
    "draft": DRAFT_FIELDS,
    "character": CHARACTER_FIELDS,
    "foreshadow": FORESHADOW_FIELDS,
    "worldview": WORLDVIEW_FIELDS,
}
_LIST_KINDS = frozenset({"toc", "arcs", "foreshadow", "worldview"})
# Each book of records is keyed by one field; a proposal that moves that key is
# certain to be rejected by the writer, so the card must say so before the click.
_KEY_BY_KIND = {
    "toc": "chapter",
    "arcs": "arc",
    "foreshadow": "foreshadow",
    "worldview": "setting",
}

# These books are keyed by a row id the file layer assigns, so a new record has to
# arrive as `?`. toc is different: the chapter number *is* content there.
_SURROGATE_KEY_KINDS = {"arcs", "foreshadow", "worldview"}


def validate_structure(path: str, text: str, *, current_text: str | None = None) -> str:
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

    if current_text and kind in _KEY_BY_KIND:
        identity = _KEY_BY_KIND[kind]
        try:
            current = load_document(kind, current_text)
        except DocumentError:
            # The file itself is unreadable; the write will report that precisely.
            return ""
        if isinstance(current, list):
            # An empty B/C projection has no identities to protect. The owner
            # may apply the first complete proposal; non-empty books are paired
            # by the same `_resolve_ids` verdict the writers run.
            if not current and kind in {"toc", "arcs"}:
                return ""
            _, reason = _resolve_ids(
                identity,
                [row.get(identity) for row in current],
                [row.get(identity) for row in parsed],
                surrogate=kind in _SURROGATE_KEY_KINDS,
            )
            if reason:
                return reason
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


def _chapter(session: Session, novel_id: int, chapter_number: int) -> Chapter | None:
    return session.exec(
        select(Chapter).where(
            Chapter.novel_id == novel_id,
            Chapter.chapter_number == chapter_number,
        )
    ).first()


def _ensure_chapter(
    session: Session, novel_id: int, chapter_number: int, brief_id: int | None = None
) -> Chapter:
    """Create the prose row if it is missing, and claim `brief_id` when given.

    D-39: a new B-layer entry and a new brief both land the chapter in the left tree,
    so the construction lives here rather than being copied into a second writer.
    """
    chapter = _chapter(session, novel_id, chapter_number)
    if chapter is None:
        chapter = Chapter(
            novel_id=novel_id, brief_id=brief_id, chapter_number=chapter_number, status="draft"
        )
    elif brief_id is not None and chapter.brief_id != brief_id:
        chapter.brief_id = brief_id
    session.add(chapter)
    return chapter


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


def _foreshadow_rows(session: Session, novel_id: int) -> list[Foreshadow]:
    return list(
        session.exec(
            select(Foreshadow)
            .where(Foreshadow.novel_id == novel_id)
            .order_by(Foreshadow.planted_chapter, Foreshadow.id)
        ).all()
    )


def _worldview_rows(session: Session, novel_id: int) -> list[Setting]:
    return list(
        session.exec(
            select(Setting).where(Setting.novel_id == novel_id).order_by(Setting.id)
        ).all()
    )


def _foreshadow_model(rows: list[Foreshadow]) -> list[dict[str, Any]]:
    return [
        {
            "foreshadow": row.id,
            "title": _block(row.title),
            "planted_chapter": row.planted_chapter,
            "expected_payoff_chapter": row.expected_payoff_chapter,
            "payoff_chapter": row.payoff_chapter,
            "status": row.status,
            "content": _block(row.content),
        }
        for row in rows
    ]


def _worldview_model(rows: list[Setting]) -> list[dict[str, Any]]:
    return [
        {
            "setting": row.id,
            "name": _block(row.name),
            "category": row.category,
            "is_confirmed": row.is_confirmed,
            "source_chapter": row.source_chapter,
            "current_state": _block(row.current_state),
            "content": _block(row.content),
        }
        for row in rows
    ]


def _character_model(row: Character) -> dict[str, Any]:
    # portrait and relationships are deliberately absent: a portrait is a base64
    # data URL (an asset, not prose) and relationships are a JSON map. Neither
    # belongs in a hand-edited document, and neither is edited by the UI today.
    return {
        "name": row.name,
        "level": row.level,
        "expected_start_chapter": row.expected_start_chapter,
        "expected_end_chapter": row.expected_end_chapter,
        "identity": row.identity,
        "goals": row.goals,
        "behavior_constraints": row.behavior_constraints,
        "current_status": row.current_status,
    }


def list_files(session: Session, novel_id: int) -> list[FileMeta]:
    files = [
        FileMeta(BLUEPRINT_PATH, "blueprint", "A", "全书蓝图"),
        FileMeta(TOC_PATH, "toc", "B", "目录"),
        FileMeta(ARCS_PATH, "arcs", "C", "剧情弧"),
    ]
    for chapter in session.exec(
        select(Chapter)
        .where(Chapter.novel_id == novel_id)
        .order_by(Chapter.chapter_number)
    ).all():
        files.append(
            FileMeta(
                draft_path(chapter.chapter_number),
                "draft",
                "正文",
                f"第 {chapter.chapter_number} 章正文",
            )
        )
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
    for person in session.exec(
        select(Character).where(Character.novel_id == novel_id).order_by(Character.id)
    ).all():
        files.append(
            FileMeta(character_path(person.id), "character", "设定", f"{person.name} 档案")
        )
    # The books always exist, like the four planning layers: an empty one is a page
    # waiting to be filled, not a missing file.
    files.append(FileMeta(FORESHADOW_PATH, "foreshadow", "设定", "伏笔"))
    files.append(FileMeta(WORLDVIEW_PATH, "worldview", "设定", "世界观"))
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
    if kind == "foreshadow":
        model = _foreshadow_model(_foreshadow_rows(session, novel_id))
        text = render_document("foreshadow", model)
        return FileDoc(
            FORESHADOW_PATH, kind, "设定", "伏笔", text, FORESHADOW_AI_FIELDS, _revision(text)
        )
    if kind == "worldview":
        model = _worldview_model(_worldview_rows(session, novel_id))
        text = render_document("worldview", model)
        return FileDoc(
            WORLDVIEW_PATH, kind, "设定", "世界观", text, WORLDVIEW_AI_FIELDS, _revision(text)
        )

    if kind == "character":
        if number is None:
            model: dict[str, Any] = {name: "" for name in CHARACTER_FIELDS}
            path = CHARACTER_NEW_PATH
        else:
            person = session.get(Character, number)
            if person is None or person.novel_id != novel_id:
                raise DocumentError(f"人物 {number} 不存在", status_code=404)
            model = _character_model(person)
            path = character_path(number)
        text = render_document("character", model)
        return FileDoc(
            path, kind, "设定", f"{model.get('name') or '新人物'} 档案",
            text, CHARACTER_AI_FIELDS, _revision(text),
        )

    if kind == "draft":
        assert number is not None
        chapter = _chapter(session, novel_id, number)
        if chapter is None:
            raise DocumentError(f"第 {number} 章正文不存在", status_code=404)
        text = render_document("draft", {"content": chapter.content}, chapter=number)
        return FileDoc(
            draft_path(number),
            kind,
            "正文",
            f"第 {number} 章正文",
            text,
            DRAFT_AI_FIELDS,
            _revision(text),
        )

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


def _resolve_ids(
    identity: str, wanted: list[int], got: list[Any], *, surrogate: bool
) -> tuple[list[int], str]:
    """Pair a proposal with the file it overwrites: which record lands on which key.

    D-39 lets a confirmed proposal append records but never delete or renumber one.
    A surrogate key (`弧`、`伏笔`、`设定`) has to arrive as `?` so this layer assigns it;
    the B layer's chapter number is content, so a number the file lacks *is* the new
    record. "" means the pairing is legal -- the same verdict preview and writers use.
    """
    existing = set(wanted)
    seen: set[int] = set()
    landed: list[int | None] = []
    for value in got:
        if value is None:
            if not surrogate:
                return [], f"{identity} 主键不能留空：新建记录要写出编号"
            landed.append(None)
            continue
        number = int(value)
        if number in seen:
            return [], f"{identity} 主键 {number} 出现了两次"
        seen.add(number)
        if surrogate and number not in existing:
            return [], (
                f"新建 {identity} 记录请把主键写成 ?，由系统分配；提案不能自己点号（收到 {number}）"
            )
        landed.append(number)
    stale = [key for key in wanted if key not in seen]
    if stale:
        return [], (
            f"不能删除条目或改动 {identity} 主键：文件里的 {stale} 在提案中不见了。"
            "要下线一章请主人手工处理，AI 只能追加；要新增请把已有条目一并列全"
        )
    out: list[int] = []
    free = max(wanted, default=0) + 1
    for value in landed:
        if value is None:
            while free in seen:
                free += 1
            seen.add(free)
            out.append(free)
            free += 1
        else:
            out.append(value)
    return out, ""


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


def _as_bool(value: Any, label: str) -> bool:
    """A flag column never stores None; an empty bullet means 否."""
    if value is None or isinstance(value, bool):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"是", "true", "yes", "1"}:
        return True
    if text in {"", "否", "false", "no", "0"}:
        return False
    raise DocumentError(f"{label} 只能写 是 或 否，收到「{value}」")


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
        elif name in _BOOL_FIELDS:
            out[name] = _as_bool(raw, f"{label}.{name}")
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
            code="write_conflict",
        )
    if actor == ACTOR_AI:
        text = canonicalize_proposal(path, text, current_text=current.text)

    parsed = load_document(kind, text, chapter=number)
    writer = {
        "blueprint": _write_blueprint,
        "toc": _write_toc,
        "arcs": _write_arcs,
        "brief": _write_brief,
        "draft": _write_draft,
        "character": _write_character,
        "foreshadow": _write_foreshadow,
        "worldview": _write_worldview,
    }[kind]
    changed = writer(session, novel_id, parsed, actor=actor, number=number)
    session.commit()
    if kind == "character" and number is None:
        # A create lands on a numeric path, so report that path rather than new.md.
        created = session.exec(
            select(Character).where(
                Character.novel_id == novel_id,
                Character.name == str(parsed["name"]).strip(),
            )
        ).first()
        if created is not None:
            path = character_path(created.id)

    after = read_file(session, novel_id, path)
    return WriteResult(path=after.path, changed=changed, revision=after.revision)


def canonicalize_proposal(path: str, text: str, *, current_text: str | None = None) -> str:
    """Repair known model aliases before the shared strict parser runs."""
    if path == TOC_PATH:
        return re.sub(r"(\*\*)内容(\*\*\s*[：:])", r"\1备注\2", text)
    if path != ARCS_PATH:
        return text

    # `弧 ?` is the codec's own "assign this key" form (see _ARC_ANCHOR), so only a
    # heading with neither a number nor `?` is junk worth dropping.
    text = re.sub(r"^##\s*弧(?!\s*(?:\d|\?))\s*.*$", "", text, flags=re.M)
    text = re.sub(r"(\*\*)(?:核心事件|核心目标)(\*\*\s*[：:])", r"\1目标\2", text)
    text = re.sub(r"(\*\*)弧内悬念(\*\*\s*[：:])", r"\1冲突\2", text)

    def split_range(match: re.Match[str]) -> str:
        return f"- **起始章**：{match.group(1)}\n- **结束章**：{match.group(2)}"

    text = re.sub(
        r"-\s+(?:\*\*)?(?:起止章|起止章节|章节范围)(?:\*\*)?\s*[：:]\s*"
        r"(?:第\s*)?(\d+)\s*[-—至]\s*(?:第\s*)?(\d+)\s*章?",
        split_range,
        text,
    )

    if current_text is not None:
        try:
            is_initial = not load_document("arcs", current_text)
        except DocumentError:
            is_initial = False
        if is_initial:
            blocks = text.split("## ")
            rebuilt = [blocks[0]]
            labels = ("起始章", "结束章", "目标", "冲突", "收束", "状态")
            for block in blocks[1:]:
                lines = block.splitlines()
                found = {
                    match.group(1).strip()
                    for line in lines
                    if (match := re.match(r"^-\s+\*\*(.+?)\*\*\s*[：:]", line))
                }
                lines.extend(
                    f"- **{label}**：{'planned' if label == '状态' else ''}"
                    for label in labels
                    if label not in found
                )
                rebuilt.append("## " + "\n".join(lines))
            text = "\n".join(rebuilt)

    known = {"起始章", "结束章", "目标", "冲突", "收束", "状态"}
    repaired: list[str] = []
    for line in text.splitlines():
        match = re.match(r"^-\s+\*\*(.+?)\*\*\s*[：:]\s*(.*)$", line)
        if match and match.group(1).strip() not in known and repaired:
            repaired.append(f"  {match.group(1).strip()}：{match.group(2)}")
        else:
            repaired.append(line)
    return _align_arc_history("\n".join(repaired), current_text)


# --- deterministic proposal rescue -----------------------------------------
#
# The model writes these books out of memory, so two shapes keep arriving that the
# strict codec has to refuse although nothing is in doubt. Both repairs only copy
# what is already on file; neither invents content.

_ARC_LABELS: tuple[tuple[str, str], ...] = (
    ("起始章", "start_chapter"),
    ("结束章", "end_chapter"),
    ("目标", "objective"),
    ("冲突", "conflict"),
    ("收束", "resolution"),
    ("状态", "status"),
)
_BULLET_LINE = re.compile(r"^-\s+\*\*(.+?)\*\*\s*[：:]\s*(.*)$")
_ARC_HEADING = re.compile(r"^弧\s*(\d+|\?)\s*(.*)$")
# A range heading is a C-layer summary the model wrote into the B layer.
_TOC_RANGE_HEADING = re.compile(r"^##\s*第\s*(\d+)\s*[-—–~至]\s*(\d+)\s*章\s*(.*)$")
_TOC_RECORD_HEADING = re.compile(r"^##\s*第\s*\d+\s*章")
_ARC_TITLE_PREFIX = re.compile(r"^弧\s*\d+(?:\s*[-—–~至]\s*\d+)?\s*[：:、.]?\s*")


def _bullet_map(lines: list[str]) -> dict[str, str]:
    """The labels one block really carries; the first occurrence wins."""
    found: dict[str, str] = {}
    for line in lines:
        match = _BULLET_LINE.match(line)
        if match:
            found.setdefault(match.group(1).strip(), match.group(2).strip())
    return found


def _record_int(value: Any) -> int | None:
    """A heading or bullet number, tolerant of the "?" a create writes."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    text = str(value).strip()
    return int(text) if text.isdigit() else None


def _existing_arcs(current_text: str | None) -> list[dict[str, Any]]:
    """The C-layer records already on file, or [] when the book is unreadable."""
    if current_text is None:
        return []
    try:
        rows = load_document("arcs", current_text)
    except DocumentError:
        return []
    return rows if isinstance(rows, list) else []


def _align_arc_history(text: str, current_text: str | None) -> str:
    """Keep every existing arc key and fill the bullets the model left out.

    Measured on the owner's screenshot: arcs.md held 弧 4 (1-5) and 弧 5 (6-10); the
    model rewrote both records, restarted the numbering at 弧 1 and dropped 收束 and
    状态, so the card reported 缺少 收束、状态 on top of a moved key and could not be
    applied. A record that lands on an arc already on file - by 起始章/结束章, or by
    position once the counts agree - keeps that arc's key, and every bullet it omitted
    comes back from that same record. A bullet the model did write is never overwritten:
    moving an arc's bounds stays a deliberate human edit.
    """
    existing = _existing_arcs(current_text)
    if not existing:
        return text
    head, *blocks = text.split("## ")
    if not blocks:
        return text

    lines_by_block = [block.splitlines() for block in blocks]
    headings: list[re.Match[str]] = []
    for lines in lines_by_block:
        match = _ARC_HEADING.match(lines[0].strip()) if lines else None
        if match is None:
            return text
        headings.append(match)

    # `弧 ?` is the key the system assigns (D-39), so an append is not a count mismatch
    # to give up on: the numbered records still have to line up one-for-one with the
    # book on file. Bailing out on the whole text used to cost those records their
    # inheritance too, which is the 缺少 起始章、结束章… the owner could not apply.
    fresh = {index for index, match in enumerate(headings) if match.group(1) == "?"}
    numbered = [index for index in range(len(headings)) if index not in fresh]

    slots: dict[int, int] = {}
    taken: set[int] = set()

    def by_bounds(index: int) -> int:
        """The untaken record on file with exactly this block's bounds, or -1."""
        fields = _bullet_map(lines_by_block[index])
        start = _record_int(fields.get("起始章"))
        end = _record_int(fields.get("结束章"))
        if start is None or end is None:
            return -1
        for candidate, row in enumerate(existing):
            if candidate not in taken and row.get("start_chapter") == start and row.get("end_chapter") == end:
                return candidate
        return -1

    # A create carries no key to check against the book, so exact 起始章/结束章 is the
    # only thing that can say "this one is already on file". Measured on the owner's
    # B-layer fence: once its 7 arcs were written, the re-read card listed them again as
    # `弧 ?` - a pure append never lists the arcs it does not add, so no count arithmetic
    # can see that - and 应用 a second time turned 9 arcs into 16.
    bound_fresh: set[int] = set()
    for index in sorted(fresh):
        picked = by_bounds(index)
        if picked < 0:
            continue
        taken.add(picked)
        slots[index] = picked
        bound_fresh.add(index)
        fresh.discard(index)

    # Position only means something while the numbered records still cover what is left
    # of the book one for one; after that a guess would land on the wrong arc.
    one_for_one = len(numbered) == len(existing) - len(taken)
    for ordinal, index in enumerate(numbered):
        picked = by_bounds(index)
        if picked < 0 and one_for_one and ordinal not in taken:
            picked = ordinal
        if picked < 0:
            return text  # 删条目由校验器说清楚，这里不猜
        taken.add(picked)
        slots[index] = picked

    offered = [_record_int(headings[index].group(1)) for index in numbered]
    wanted = [_record_int(row.get("arc")) for row in existing]
    # Only a restart at 弧 1 counts as the model renumbering the book for itself; an
    # off-sequence key such as 弧 99 is an arc that does not exist, and must stay red.
    # The sequence runs over the records the fence numbers, not over the book on file -
    # an append fence leaves part of the book unlisted, so those two differ.
    renumber = offered != wanted and offered == list(range(1, len(numbered) + 1))

    rebuilt = [head]
    for index, block in enumerate(blocks):
        lines = lines_by_block[index]
        fields = _bullet_map(lines)
        if index in fresh:
            # A record being added has nothing on file to inherit from. Only the three
            # optional fields get the empty-book default; 起始章/结束章/目标 stay with
            # the validator, because an arc with no bounds is a real gap, not something
            # to paper over with an empty string the integer check then refuses.
            for label, _field in _ARC_LABELS:
                if label in fields or label not in {"冲突", "收束", "状态"}:
                    continue
                lines.append(f"- **{label}**：{'planned' if label == '状态' else ''}")
        else:
            row = existing[slots[index]]
            # A bound create has to come back with the key it landed on: `?` reads as a
            # create all the way down to `_resolve_ids`, which would append it again.
            if renumber or index in bound_fresh:
                title = headings[index].group(2).strip() or str(row.get("title") or "")
                lines[0] = f"弧 {row.get('arc')} {title}".rstrip()
            for label, field in _ARC_LABELS:
                if label in fields:
                    continue
                value = row.get(field)
                lines.append(f"- **{label}**：{'' if value is None else value}")
        # splitlines() ate the newline that closed the block, and the next heading
        # marker sits right behind it: put both back or 弧 2 glues onto 弧 1.
        rebuilt.append("\n".join(lines) + ("\n" if block.endswith("\n") else ""))
    # Split on the heading marker, so it goes back exactly once: re-prefixing every
    # block here is how a heading turns into "## ## 弧 1" and the codec calls it 不是记录.
    return "## ".join(rebuilt)


def canonical_path(path: str) -> tuple[str, str]:
    """Fold the aliases a model writes for a file back onto the projected path.

    Returns the canonical path plus a note when the file genuinely moved, so the
    review card can say what happened instead of quietly rewriting the target.
    """
    raw = (path or "").strip().lstrip("/").replace("\\", "/")
    if raw in {"settings/characters.md", "characters.md", "settings/characters"}:
        return CHARACTER_NEW_PATH, "人物档案只从 " + CHARACTER_NEW_PATH + " 建，提案已改道"
    builders = (
        (_BRIEF_NAME, lambda number: f"briefs/{number:04d}.md"),
        (_CHAPTER_BRIEF_NAME, brief_path),
        (_CHAPTER_DRAFT_NAME, draft_path),
    )
    for pattern, builder in builders:
        match = pattern.match(raw)
        if match:
            return builder(int(match.group(1))), ""
    return raw, ""


def toc_record_count(text: str) -> int:
    """How many per-chapter records a toc proposal still holds."""
    return sum(1 for line in text.splitlines() if _TOC_RECORD_HEADING.match(line))


def arc_proposal_from_toc_ranges(toc_text: str, current_arcs_text: str | None) -> tuple[str, str]:
    """Move `## 第 11-30 章 …` out of a toc proposal into an arcs.md file.

    The B layer holds one record per chapter, so a range heading is a C-layer arc the
    model wrote into the wrong book. What comes back is only what the model already
    typed: 起始章/结束章 from the heading, 目标 from that entry's 剧情功能/备注, and the
    title with the `弧 3：` prefix stripped. The arcs already on file are re-emitted in
    front of the new record so the card still shows a whole file, and a range whose
    起始章/结束章 already match one of them edits that arc instead of adding a record.
    The second value is "" when there was nothing to move.
    """
    lines = toc_text.splitlines()
    kept: list[str] = []
    moved: list[dict[str, Any]] = []
    index = 0
    while index < len(lines):
        match = _TOC_RANGE_HEADING.match(lines[index])
        if match is None:
            kept.append(lines[index])
            index += 1
            continue
        index += 1
        bullets: dict[str, str] = {}
        while index < len(lines) and not lines[index].startswith("## "):
            bullet = _BULLET_LINE.match(lines[index])
            if bullet:
                bullets.setdefault(bullet.group(1).strip(), bullet.group(2).strip())
            index += 1
        # 内容 is the alias the toc layer answers to on the way in (canonicalize_proposal),
        # so a range entry written with it still carries its own text into 目标.
        note = bullets.get("备注") or bullets.get("内容") or ""
        goal = "\n".join(
            value
            for value in (bullets.get("剧情功能", ""), note)
            if value
        )
        tail = match.group(3).strip()
        moved.append(
            {
                "arc": None,
                "title": _ARC_TITLE_PREFIX.sub("", tail).strip(),
                "start_chapter": int(match.group(1)),
                "end_chapter": int(match.group(2)),
                "objective": goal or tail,
                "conflict": "",
                "resolution": "",
                "status": "planned",
            }
        )
    if not moved:
        return toc_text, ""
    rows = _existing_arcs(current_arcs_text)
    on_file = {(row.get("start_chapter"), row.get("end_chapter")): row for row in rows}
    for row in moved:
        bound = on_file.get((row["start_chapter"], row["end_chapter"]))
        if bound is None:
            rows.append(row)
            continue
        # 起止章相同就是同一条弧（D-43）：这条围栏上一轮已经把它写进去了，再列一遍
        # 就是又添一条。作品 6 实测：重读同一条 B 层围栏，9 条弧变 16 条。
        # 围栏只带 标题/目标 两个可改字段，空值一律不许清掉档上的字。
        for field in ("title", "objective"):
            if row[field]:
                bound[field] = row[field]
    return "\n".join(kept).rstrip("\n") + "\n", render_document("arcs", rows)


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

    if actor == ACTOR_AI and existing:
        resolved, reason = _resolve_ids(
            "chapter",
            [row["chapter"] for row in before_model],
            [row.get("chapter") for row in rows],
            surrogate=False,
        )
        if reason:
            raise DocumentError(reason)
        by_number = {row.chapter_number: row for row in existing}
        changed: list[str] = []
        for raw, number in zip(rows, resolved):
            after = _coerce({**raw, "chapter": number}, TOC_FIELDS, TOC_PATH)
            row = by_number.get(number)
            if row is None:
                row = TocEntry(novel_id=novel_id, chapter_number=number, is_active=True)
                session.add(row)
                session.flush()
                # D-39：目录里新增一章，左侧树就要立刻出现这一章。
                _ensure_chapter(session, novel_id, number)
                changed.append(f"{number}.created")
                targets = [name for name in after if name != "chapter"]
            else:
                targets = _require_ai_values(
                    TOC_AI_FIELDS, _toc_model([row])[0], after, f"第 {number} 章"
                )
            for name in targets:
                if getattr(row, name) != after[name]:
                    setattr(row, name, after[name])
                    changed.append(f"{number}.{name}")
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
            session.flush()
            # D-39：目录里新增一章就要立刻有这一章，35.13 让全量分支与上面的追加分支共用同一次建本体。
            _ensure_chapter(session, novel_id, chapter_number)
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

    if actor == ACTOR_AI and existing:
        resolved, reason = _resolve_ids(
            "arc",
            [row["arc"] for row in before_model],
            [row.get("arc") for row in rows],
            surrogate=True,
        )
        if reason:
            raise DocumentError(reason)
        changed: list[str] = []
        for raw, arc_id in zip(rows, resolved):
            after = _coerce({**raw, "arc": arc_id}, ARC_FIELDS, ARCS_PATH)
            # `弧 ?` never names a row that already exists, so it must never be looked
            # up either: the number `_resolve_ids` guessed is this novel's max + 1, while
            # ArcPlan.id counts globally, so the guess can hit a row this same proposal
            # inserted one step earlier and turn an append into a refused bounds edit.
            row = None if raw.get("arc") is None else by_id.get(arc_id)
            if row is None:
                row = ArcPlan(
                    novel_id=novel_id,
                    start_chapter=after["start_chapter"],
                    end_chapter=after["end_chapter"],
                    status=after["status"],
                )
                session.add(row)
                session.flush()
                by_id[row.id] = row
                changed.append(f"{row.id}.created")
                targets = [name for name in after if name != "arc"]
            else:
                targets = _require_ai_values(
                    ARC_AI_FIELDS, _arcs_model([row])[0], after, f"arc {arc_id}"
                )
            for name in targets:
                if getattr(row, name) != after[name]:
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
            if actor == ACTOR_AI and existing:
                raise DocumentError(
                    f"arc {arc_id} 不存在；新建剧情弧请留 arc: null（由系统分配主键）"
                )
            row = ArcPlan(
                novel_id=novel_id,
                start_chapter=after["start_chapter"],
                end_chapter=after["end_chapter"],
                status=after["status"],
            )
            session.add(row)
            session.flush()
            by_id[row.id] = row
            arc_id = row.id
            changed.append(f"{row.id}.created")
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

    # The first durable write of a brief is the append action. Making the prose
    # row here keeps both records atomic and leaves PUT /files as the only
    # writer for new planning entries.
    _ensure_chapter(session, novel_id, number, brief_id=brief.id)

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


def _write_draft(
    session: Session,
    novel_id: int,
    parsed: Any,
    *,
    actor: str,
    number: int | None,
) -> list[str]:
    assert number is not None
    label = draft_path(number)
    data = _require_keys(parsed, DRAFT_FIELDS, label)
    content = _as_text(data["content"], f"{label}.content")
    chapter = _chapter(session, novel_id, number)
    if chapter is None:
        raise DocumentError(f"第 {number} 章正文不存在", status_code=404)

    changed = [] if chapter.content == content else ["content"]
    if actor == ACTOR_AI:
        _require_ai_values(DRAFT_AI_FIELDS, {"content": chapter.content}, {"content": content}, label)
    chapter.content = content
    chapter.word_count = len(content)
    _touch(chapter)
    session.add(chapter)
    return changed


def _write_book(
    session: Session,
    novel_id: int,
    parsed: Any,
    *,
    actor: str,
    path: str,
    label: str,
    shape: str,
    fields: tuple[str, ...],
    ai_fields: tuple[str, ...],
    rows: list[Any],
    model: list[dict[str, Any]],
    make: Any,
) -> list[str]:
    """One writer for every keyed book of records.

    The key is the row id, so a create arrives as `?` and the database assigns it -
    the same rule that keeps 弧 N from being renumbered by a proposal.
    """
    if not isinstance(parsed, list):
        raise DocumentError(f"{path} 必须是「{shape}」的记录列表")

    by_id = {row.id: row for row in rows}
    incoming = [
        _require_keys(row, fields, f"{path} 第 {i + 1} 条") for i, row in enumerate(parsed)
    ]

    if actor == ACTOR_AI:
        resolved, reason = _resolve_ids(
            fields[0],
            [row[fields[0]] for row in model],
            [row.get(fields[0]) for row in incoming],
            surrogate=True,
        )
        if reason:
            raise DocumentError(reason)
        by_key = {row[fields[0]]: row for row in model}
        changed: list[str] = []
        for raw, key in zip(incoming, resolved):
            after = _coerce({**raw, fields[0]: key}, fields, path)
            # Same reason as in `_write_arcs`: `?` is a create, never a reference to a
            # row on file, and the guessed number can collide with one this proposal
            # inserted a step earlier because the id column counts across all books.
            row = None if raw.get(fields[0]) is None else by_id.get(key)
            if row is None:
                row = make(novel_id, after)
                session.add(row)
                session.flush()
                by_id[row.id] = row
                changed.append(f"{row.id}.created")
                targets = [name for name in after if name != fields[0]]
            else:
                targets = _require_ai_values(ai_fields, by_key[key], after, f"{label} {key}")
            for name in targets:
                if getattr(row, name) != after[name]:
                    setattr(row, name, after[name])
                    changed.append(f"{row.id}.{name}")
            _touch(row)
            session.add(row)
        return changed

    changed = []
    seen: set[int] = set()
    for raw in incoming:
        after = _coerce(raw, fields, path)
        key = after[fields[0]]
        if key is not None:
            if key in seen:
                raise DocumentError(f"{label} {key} 出现了两次")
            seen.add(key)
        row = by_id.get(key)
        if row is None:
            if actor == ACTOR_AI or key is not None:
                raise DocumentError(
                    f"{label} {key} 不存在；新建请写成「## {label} ? 标题」，主键由系统分配"
                )
            row = make(novel_id, after)
            session.add(row)
            session.flush()
            by_id[row.id] = row
            changed.append(f"{row.id}.created")
        for name, value in after.items():
            if name == fields[0]:
                continue
            if getattr(row, name) != value:
                setattr(row, name, value)
                changed.append(f"{row.id}.{name}")
        _touch(row)
    return changed


def _make_foreshadow(novel_id: int, after: dict[str, Any]) -> Foreshadow:
    if not after.get("planted_chapter"):
        raise DocumentError("新建伏笔必须写埋设章")
    return Foreshadow(
        novel_id=novel_id,
        title=after["title"] or "未命名伏笔",
        planted_chapter=after["planted_chapter"],
        status=after["status"] or "open",
    )


def _make_setting(novel_id: int, after: dict[str, Any]) -> Setting:
    return Setting(
        novel_id=novel_id,
        name=after["name"] or "未命名设定",
        category=after["category"] or "其他",
    )


def _write_foreshadow(
    session: Session, novel_id: int, parsed: Any, *, actor: str, number: int | None
) -> list[str]:
    rows = _foreshadow_rows(session, novel_id)
    return _write_book(
        session, novel_id, parsed,
        actor=actor, path=FORESHADOW_PATH, label="伏笔", shape="## 伏笔 1 伏笔名",
        fields=FORESHADOW_FIELDS, ai_fields=FORESHADOW_AI_FIELDS,
        rows=rows, model=_foreshadow_model(rows), make=_make_foreshadow,
    )


def _write_worldview(
    session: Session, novel_id: int, parsed: Any, *, actor: str, number: int | None
) -> list[str]:
    rows = _worldview_rows(session, novel_id)
    return _write_book(
        session, novel_id, parsed,
        actor=actor, path=WORLDVIEW_PATH, label="设定", shape="## 设定 1 设定名",
        fields=WORLDVIEW_FIELDS, ai_fields=WORLDVIEW_AI_FIELDS,
        rows=rows, model=_worldview_model(rows), make=_make_setting,
    )


def _write_character(
    session: Session,
    novel_id: int,
    parsed: Any,
    *,
    actor: str,
    number: int | None,
) -> list[str]:
    label = character_path(number) if number is not None else CHARACTER_NEW_PATH
    data = _require_keys(parsed, CHARACTER_FIELDS, label)
    after = _coerce(data, CHARACTER_FIELDS, label)
    name = after["name"].strip()
    if not name:
        raise DocumentError(f"{label} 的「姓名」不能为空", status_code=422)
    after["name"] = name

    same_name = [Character.novel_id == novel_id, Character.name == name]
    if number is not None:
        same_name.append(Character.id != number)
    clash = session.exec(select(Character).where(*same_name)).first()
    if clash is not None:
        raise DocumentError(f"已有同名人物：{name}（写入请走 {character_path(clash.id)}）", status_code=409)

    if number is None:
        person = Character(novel_id=novel_id, name=name)
        for key in CHARACTER_AI_FIELDS:
            setattr(person, key, after[key])
        session.add(person)
        session.flush()
        _touch(person)
        return list(CHARACTER_FIELDS)

    person = session.get(Character, number)
    if person is None or person.novel_id != novel_id:
        raise DocumentError(f"人物 {number} 不存在", status_code=404)

    before = _character_model(person)
    if actor == ACTOR_AI:
        _require_ai_values(CHARACTER_AI_FIELDS, before, after, label)
    changed: list[str] = [key for key, value in after.items() if before[key] != value]
    for key in changed:
        setattr(person, key, after[key])
    if changed:
        _touch(person)
    session.add(person)
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


def character_path_reader(session: Session, novel_id: int):
    """Return ``姓名 -> 该人物的档案路径``，一本书内查一次、缓存住。

    「同名即同人」这条规则的真源是 `_write_character` 那个 409；抽提案的人要问同一件事，
    所以在这儿问，别处不再写一份名字查询。
    """
    cache: dict[str, str | None] = {}

    def person_path(name: str) -> str | None:
        key = (name or "").strip()
        if key not in cache:
            row = session.exec(
                select(Character).where(Character.novel_id == novel_id, Character.name == key)
            ).first()
            cache[key] = character_path(row.id) if row is not None else None
        return cache[key]

    return person_path
