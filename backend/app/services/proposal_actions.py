"""Typed actions and the proposal compiler: field JSON in, reviewable fence out.

Nothing here writes. No session, no HTTP, no disk: an action validates a payload,
renders it through the same Markdown codec the editor shows, and hands back a fence
the human presses 应用 on (DECISIONS D-01 / D-15, UI-BACKLOG 35.6). The path belongs
to the action, never to the payload, so a model cannot name a file it wants written
-- it names a layer and fills that layer's fields.

Why a compiler instead of asking the model for the whole file: measured on the
owner's own screenshots, it writes 第 11-30 章 as a single B-layer entry, drops
收束/状态 from arc records, and proposes settings/characters.md, a path that does not
exist. Each of those costs the owner one click and one red card. Here they are
refused before a card is drawn, and the diagnosis names the fix.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Callable

from app.services import markdown_doc
from app.services.documents import (
    CHARACTER_NEW_PATH,
    DocumentError,
    brief_path,
    validate_structure,
)

FENCE_HEADER = "```markdown @"
# The prefix the model reads as "retry once, differently". The diagnosis itself
# stays prefix-free so run_action is usable outside a tool call too.
DIAG_PREFIX = "动作未通过校验："

_RANGE = re.compile(r"\d+\s*[-–—~～]\s*\d+|\d+\s*(?:到|至)\s*\d+")
_DIGITS = re.compile(r"\d+")
_TOC_RANGE_HINT = (
    "B 层一条只能一章，必须逐章给出（第 11 章、第 12 章……各自一条）。"
    "跨章的规划属于 C 层剧情弧：请改用 update_arcs 提交弧名与起止章，再由 B 层逐章落地。"
)


class ActionError(ValueError):
    """The payload does not match the action's contract. The text reaches the model."""


# --- reading a payload ------------------------------------------------------


def _parse(payload: str | Mapping[str, Any]) -> dict[str, Any]:
    if isinstance(payload, Mapping):
        return dict(payload)
    if isinstance(payload, (str, bytes)):
        raw = payload.decode() if isinstance(payload, bytes) else payload
        try:
            loaded = json.loads(raw or "")
        except ValueError as cause:
            raise ActionError(
                f"payload 不是合法 JSON：{cause}。只放一个 JSON 对象，不要加注释、尾逗号或多余文字"
            ) from cause
        if not isinstance(loaded, Mapping):
            raise ActionError(f"payload 必须是一个 JSON 对象（{{...}}），收到 {type(loaded).__name__}")
        return dict(loaded)
    raise ActionError(f"payload 只能是 JSON 字符串或字典，收到 {type(payload).__name__}")


def _rows(fields: dict[str, Any], key: str, action: str) -> list[dict[str, Any]]:
    raw = fields.get(key)
    if not isinstance(raw, list) or not raw:
        raise ActionError(f"{action} 的「{key}」必须是非空数组，一条一项；收到 {type(raw).__name__}")
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, Mapping):
            raise ActionError(f"{action} 的「{key}」里每一项都得是对象，收到 {type(item).__name__}")
        out.append(dict(item))
    return out


def _keys(record: Mapping[str, Any], allowed: tuple[str, ...], required: tuple[str, ...], label: str) -> None:
    missing = [name for name in required if name not in record]
    if missing:
        raise ActionError(
            f"{label} 缺少字段：{'、'.join(missing)}。必填是 {'、'.join(required)}；"
            "其余字段可以省略，但省略不等于可以改名、加名或把几条并成一条"
        )
    extra = [name for name in record if name not in allowed]
    if extra:
        raise ActionError(f"{label} 有未知字段：{'、'.join(extra)}。可用字段只有 {'、'.join(allowed)}")


def _text(record: Mapping[str, Any], name: str, label: str, *, required: bool = False,
          single_line: bool = False) -> str:
    raw = record.get(name, "")
    if raw is None:
        raw = ""
    if not isinstance(raw, str):
        raise ActionError(f"{label} 的「{name}」必须是文本，收到 {type(raw).__name__}")
    value = raw.strip()
    if required and not value:
        raise ActionError(f"{label} 的「{name}」不能为空")
    if single_line and "\n" in value:
        raise ActionError(f"{label} 的「{name}」只能是一行（它会写进标题行），不接受换行")
    return value


def _prose(record: Mapping[str, Any], name: str, label: str) -> Any:
    """A prose field may arrive as text or as a list of points; both render."""
    raw = record.get(name, "")
    if isinstance(raw, list):
        return [item.strip() for item in (str(value) for value in raw) if item.strip()]
    return _text(record, name, label)


def _str_list(record: Mapping[str, Any], name: str, label: str) -> list[str]:
    raw = record.get(name, [])
    if raw is None:
        raw = []
    if isinstance(raw, str) or not isinstance(raw, (list, tuple)):
        raise ActionError(
            f"{label} 的「{name}」必须是字符串数组（一条一行），不能是一整段文本；收到 {type(raw).__name__}"
        )
    items = [str(value).strip() for value in raw]
    if any(not item for item in items):
        raise ActionError(f"{label} 的「{name}」里有空条目")
    return items


def _positive_int(record: Mapping[str, Any], name: str, label: str, *,
                  required: bool = True) -> int | None:
    raw = record.get(name)
    if raw is None:
        if required:
            raise ActionError(f"{label} 的「{name}」必须给出正整数，字段缺失")
        return None
    if isinstance(raw, bool) or not isinstance(raw, int):
        text = str(raw).strip()
        # A quoted number is a model that means the same thing. Anything else is not a
        # chapter number, and guessing here is how a bad proposal reaches the owner.
        if isinstance(raw, str) and _DIGITS.fullmatch(text):
            raw = text
        else:
            raise ActionError(f"{label} 的「{name}」必须是正整数，收到「{text}」")
    value = int(raw)
    if value < 1:
        raise ActionError(f"{label} 的「{name}」必须从 1 开始，收到 {value}")
    return value


def _reject_range(value: Any, label: str) -> None:
    """One B-layer entry is one chapter. A range means the model meant the C layer."""
    if isinstance(value, str) and _RANGE.search(value):
        raise ActionError(f"{label} 的「number」写成了范围「{value.strip()}」。{_TOC_RANGE_HINT}")


# --- the five actions -------------------------------------------------------

_BLUEPRINT_INPUT = ("main_line", "ending", "core_conflicts", "themes", "constraints")
_TOC_INPUT = ("number", "title", "plot_function", "notes")
_ARC_INPUT = ("title", "start_chapter", "end_chapter", "objective", "conflict", "resolution", "status")
_BRIEF_INPUT = ("chapter_number", "goal", "events", "pov", "characters", "conflict", "hook",
                "required_facts", "status")
_CHARACTER_INPUT = ("name", "level", "expected_start_chapter", "expected_end_chapter",
                    "identity", "goals", "behavior_constraints", "current_status")


def _blueprint(fields: dict[str, Any]) -> tuple[str, str]:
    label = "update_blueprint"
    _keys(fields, _BLUEPRINT_INPUT, _BLUEPRINT_INPUT, label)
    row = {name: _prose(fields, name, label) for name in _BLUEPRINT_INPUT}
    return "blueprint.md", markdown_doc.render("blueprint", row)


def _toc(fields: dict[str, Any]) -> tuple[str, str]:
    _keys(fields, ("chapters",), ("chapters",), "update_toc")
    rows = _rows(fields, "chapters", "update_toc")
    entries: list[dict[str, Any]] = []
    seen: dict[int, int] = {}
    for index, item in enumerate(rows, start=1):
        label = f"update_toc 第 {index} 条"
        _reject_range(item.get("number"), label)
        _keys(item, _TOC_INPUT, _TOC_INPUT, label)
        number = _positive_int(item, "number", label)
        assert number is not None
        if number in seen:
            raise ActionError(
                f"第 {number} 章出现在第 {seen[number]} 条和第 {index} 条。B 层一条一章，重复即拒绝"
            )
        seen[number] = index
        entries.append({
            "chapter": number,
            "title": _text(item, "title", label, required=True, single_line=True),
            "plot_function": _prose(item, "plot_function", label),
            "notes": _prose(item, "notes", label),
        })
    return "toc.md", markdown_doc.render("toc", entries)


def _existing_arcs(existing: Any) -> list[dict[str, Any]]:
    """The caller's copy of what arcs.md already holds: keys, locked range, own wording."""
    if existing is None:
        return []
    if not isinstance(existing, list):
        raise ActionError("update_arcs 的「existing」必须是数组，或整个省略")
    known: list[dict[str, Any]] = []
    for position, item in enumerate(existing, start=1):
        if not isinstance(item, Mapping):
            raise ActionError(f"update_arcs 的「existing」第 {position} 条必须是对象")
        label = f"existing 第 {position} 条"
        known.append({
            "arc": _positive_int(item, "arc", label),
            "start_chapter": _positive_int(item, "start_chapter", label, required=False),
            "end_chapter": _positive_int(item, "end_chapter", label, required=False),
            "resolution": _text(item, "resolution", label),
            "status": _text(item, "status", label),
        })
    return known


def _arcs(fields: dict[str, Any]) -> tuple[str, str]:
    _keys(fields, ("arcs", "existing"), ("arcs",), "update_arcs")
    rows = _rows(fields, "arcs", "update_arcs")
    known = _existing_arcs(fields.get("existing"))
    entries: list[dict[str, Any]] = []
    for index, item in enumerate(rows):
        label = f"update_arcs 第 {index + 1} 条"
        _keys(item, _ARC_INPUT, ("title", "start_chapter", "end_chapter"), label)
        old = known[index] if index < len(known) else None
        if known:
            # Past the end of the book there is no key to copy, and `弧 ?` is the file
            # layer's own way of saying "assign this one".
            arc = old["arc"] if old else None
        else:
            # Nothing to match against: number by input order, from 1.
            arc = index + 1
        start = _positive_int(item, "start_chapter", label)
        end = _positive_int(item, "end_chapter", label)
        assert start is not None and end is not None
        if end < start:
            raise ActionError(f"{label} 的结束章 {end} 早于起始章 {start}")
        if old and old["arc"] is not None:
            for field, heading, value in (("start_chapter", "起始章", start),
                                          ("end_chapter", "结束章", end)):
                pinned = old[field]
                if pinned is not None and pinned != value:
                    raise ActionError(
                        f"弧 {old['arc']} 的「{heading}」文件里是 {pinned}，提案给了 {value}。"
                        "起止章只由主人调整，编译器不替主人挪范围：请照抄文件里的起止章，"
                        "要挪范围请先让主人在界面上定。"
                        "如果你其实是要新增一条弧，那是 `arcs` 少写了条目："
                        "把已有各弧一并列进 `arcs`（按文件里的顺序），新弧追加在末尾"
                    )
        entries.append({
            "arc": arc,
            "title": _text(item, "title", label, required=True, single_line=True),
            "start_chapter": start,
            "end_chapter": end,
            "objective": _prose(item, "objective", label),
            "conflict": _prose(item, "conflict", label),
            # An omitted field falls back to what the file already holds, then to the
            # table default; rendering it blank would quietly overwrite the owner's text.
            "resolution": _text(item, "resolution", label) or (old["resolution"] if old else ""),
            "status": _text(item, "status", label) or (old["status"] if old else "") or "planned",
        })
    return "arcs.md", markdown_doc.render("arcs", entries)


def _chapter_brief(fields: dict[str, Any]) -> tuple[str, str]:
    label = "upsert_chapter_brief"
    _keys(fields, _BRIEF_INPUT, ("chapter_number", "goal"), label)
    number = _positive_int(fields, "chapter_number", label)
    assert number is not None
    row = {
        "chapter": number,
        # 所属弧 is not an AI-writable field, so the proposal keeps it unset.
        "arc": None,
        "goal": _text(fields, "goal", label, required=True),
        "events": _prose(fields, "events", label),
        "pov": _text(fields, "pov", label),
        "characters": _str_list(fields, "characters", label),
        "conflict": _text(fields, "conflict", label),
        "hook": _text(fields, "hook", label),
        "required_facts": _str_list(fields, "required_facts", label),
        "status": _text(fields, "status", label) or "draft",
    }
    return brief_path(number), markdown_doc.render("brief", row, chapter=number)


def _character(fields: dict[str, Any]) -> tuple[str, str]:
    label = "create_character"
    _keys(fields, _CHARACTER_INPUT, ("name",), label)
    row = {
        "name": _text(fields, "name", label, required=True, single_line=True),
        "level": _text(fields, "level", label) or "supporting",
        "expected_start_chapter": _positive_int(fields, "expected_start_chapter", label, required=False),
        "expected_end_chapter": _positive_int(fields, "expected_end_chapter", label, required=False),
        "identity": _text(fields, "identity", label),
        "goals": _text(fields, "goals", label),
        "behavior_constraints": _text(fields, "behavior_constraints", label),
        "current_status": _text(fields, "current_status", label),
    }
    # The id is assigned by the file layer when 应用 is pressed, which is why this and
    # only this path exists: settings/characters.md is not a document and never was.
    return CHARACTER_NEW_PATH, markdown_doc.render("character", row)


@dataclass(frozen=True)
class ActionSpec:
    """One action: the tool that offers it, and how to turn a payload into a file."""

    action: str
    tool: str
    path: str
    fields: str
    rules: str
    build: Callable[[dict[str, Any]], tuple[str, str]]

    @property
    def description(self) -> str:
        return (
            f"{self.tool}：把结构化字段编译成 {self.path} 的提案块，交主人点应用；"
            "不写库、不落盘、不发请求。"
            f"payload 是一个 JSON 字符串：{self.fields}。{self.rules}"
        )


ACTIONS: dict[str, ActionSpec] = {
    spec.action: spec
    for spec in (
        ActionSpec(
            action="update_blueprint",
            tool="propose_blueprint",
            path="blueprint.md",
            fields='{"main_line":"…","ending":"…","core_conflicts":"…","themes":"…","constraints":"…"}',
            rules="五个键都要给：这是一份整文件提案，漏一个就等于把那一节清空；正文可以改，小节名不能改。",
            build=_blueprint,
        ),
        ActionSpec(
            action="update_toc",
            tool="propose_toc",
            path="toc.md",
            fields='{"chapters":[{"number":1,"title":"章名","plot_function":"剧情功能","notes":"备注"}]}',
            rules="B 层必须逐章：每条只有 number（正整数）加 title/plot_function/notes 四个字段，"
                  "缺任一字段即拒绝，「第 11-30 章」这种范围条目也直接拒绝（那是 C 层，走 update_arcs）。",
            build=_toc,
        ),
        ActionSpec(
            action="update_arcs",
            tool="propose_arcs",
            path="arcs.md",
            fields='{"arcs":[{"title":"弧名","start_chapter":1,"end_chapter":5,"objective":"…",'
                   '"conflict":"…","resolution":"…","status":"planned"}],'
                   '"existing":[{"arc":4,"start_chapter":1,"end_chapter":5,"resolution":"…","status":"planned"}]}',
            rules="`arcs` 是**全量**：arcs.md 里已有的每一条弧都要按文件里的顺序写进来，新弧追加在末尾。"
                  "只把新弧放进 `arcs`、已有弧只写进 `existing`，会被当成删掉了条目。"
                  "title 与起止章必填，目标/冲突/收束/状态可省略（省略就照 existing 回填，不会写成空）。"
                  "不得猜弧号：把每弧的 arc 与起止章照抄进 existing，"
                  "编译器按它定位主键，起止章与文件不一致会被拒绝；整本书还没有弧时省略 existing，"
                  "按输入顺序从 1 编号。",
            build=_arcs,
        ),
        ActionSpec(
            action="upsert_chapter_brief",
            tool="propose_chapter_brief",
            path="chapters/NNNN/brief.md",
            fields='{"chapter_number":1,"goal":"本章目标","events":"…","pov":"…","characters":["…"],'
                   '"conflict":"…","hook":"…","required_facts":["…"],"status":"draft"}',
            rules="goal 必填，其余可省略留空；characters 与 required_facts 是字符串数组，"
                  "既定事实要能在新章正文里逐字找到，别填整句。章号由 chapter_number 渲染成四位，"
                  "路径不是你写的。",
            build=_chapter_brief,
        ),
        ActionSpec(
            action="create_character",
            tool="propose_character",
            path=CHARACTER_NEW_PATH,
            fields='{"name":"姓名","level":"supporting","expected_start_chapter":1,'
                   '"identity":"…","goals":"…","behavior_constraints":"…","current_status":"…"}',
            rules="name 必填；新建人物只能产出这一份提案，人物号由系统分配——"
                  "不存在 settings/characters.md 这个文件，往那儿提会被挡下。",
            build=_character,
        ),
    )
}


def _gate(path: str, body: str, current_text: str | None = None) -> None:
    """Never hand out a fence the file layer would refuse once 应用 is pressed.

    ``current_text`` is what the file holds right now: without it the primary-key
    pairing (D-39: may append, may not delete or renumber) cannot be judged here, and
    a tool would promise a card the preview then refuses.
    """
    try:
        reason = validate_structure(path, body, current_text=current_text)
    except DocumentError as cause:
        reason = cause.detail
    if reason:
        raise ActionError(f"渲染出的 {path} 提案不被文件层接受：{reason}")


def run_action(
    name: str,
    payload: str | Mapping[str, Any],
    current: Callable[[str], str | None] | None = None,
) -> tuple[bool, str]:
    """Compile one typed action: True gives a proposal fence, False gives a diagnosis."""
    spec = ACTIONS.get(str(name).strip())
    if spec is None:
        return False, f"没有这个动作：{name}。可用的是 {'、'.join(sorted(ACTIONS))}"
    try:
        path, body = spec.build(_parse(payload))
        _gate(path, body, current(path) if current is not None else None)
    except ActionError as cause:
        return False, str(cause)
    return True, f"{FENCE_HEADER}{path}\n{body.rstrip()}\n```"
