"""Markdown projection of the four planning layers.

The database owns the values; this module only renders a model to Markdown and
parses it back. Structure rides on the Markdown a reader already skims: a
``## 小节`` heading or a ``- **字段**：`` label is what YAML used to call a key,
and the ``第 N 章`` / ``弧 N`` prefix of a record heading is its primary key.
Everything after that prefix, plus every section body, is content.
"""

from __future__ import annotations

import re
from typing import Any

__all__ = [
    "MarkdownError",
    "INT_FIELDS",
    "OPTIONAL_INT_FIELDS",
    "LIST_FIELDS",
    "BOOL_FIELDS",
    "render",
    "parse",
]


class MarkdownError(Exception):
    """A document whose structure does not match its layer. Never a partial write."""

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


# Field vocabulary, so the parser knows which bullets carry numbers and which
# carry a list. documents.py imports these instead of keeping a second copy.
INT_FIELDS = frozenset({"chapter", "start_chapter", "end_chapter", "planted_chapter"})
OPTIONAL_INT_FIELDS = frozenset(
    {
        "arc",
        "expected_start_chapter",
        "expected_end_chapter",
        "expected_payoff_chapter",
        "payoff_chapter",
        "source_chapter",
        # A book's own key arrives as `?` on a create, so it is an optional int too:
        # left as text it would come back "" and read as "that id does not exist".
        "foreshadow",
        "setting",
    }
)
LIST_FIELDS = frozenset({"characters", "required_facts"})
# 已确认 is a flag: it has to come back typed, or "否" would be stored as true.
BOOL_FIELDS = frozenset({"is_confirmed"})
_TRUE = {"是", "true", "yes", "1"}
_FALSE = {"否", "false", "no", "0"}

# (field, markdown label) in the order a document shows them.
_BLUEPRINT_SECTIONS = (
    ("main_line", "主线"),
    ("ending", "终局"),
    ("core_conflicts", "核心冲突"),
    ("themes", "主题"),
    ("constraints", "约束"),
)
_TOC_BULLETS = (("plot_function", "剧情功能"), ("notes", "备注"))
_ARC_BULLETS = (
    ("start_chapter", "起始章"),
    ("end_chapter", "结束章"),
    ("objective", "目标"),
    ("conflict", "冲突"),
    ("resolution", "收束"),
    ("status", "状态"),
)
_BRIEF_BULLETS = (
    ("chapter", "章节号"),
    ("arc", "所属弧"),
    ("pov", "视角"),
    ("characters", "出场人物"),
    ("status", "状态"),
)
_BRIEF_SECTIONS = (
    ("goal", "目标"),
    ("events", "事件"),
    ("conflict", "冲突"),
    ("hook", "钩子"),
    ("required_facts", "既定事实"),
)

_FORESHADOW_BULLETS = (
    ("planted_chapter", "埋设章"),
    ("expected_payoff_chapter", "预计收章"),
    ("payoff_chapter", "已收章"),
    ("status", "状态"),
    ("content", "内容"),
)
_WORLDVIEW_BULLETS = (
    ("category", "类别"),
    ("is_confirmed", "已确认"),
    ("source_chapter", "来源章"),
    ("current_state", "现况"),
    ("content", "内容"),
)
_CHARACTER_BULLETS = (
    ("name", "姓名"),
    ("level", "分级"),
    ("expected_start_chapter", "起始章"),
    ("expected_end_chapter", "结束章"),
)
_CHARACTER_SECTIONS = (
    ("identity", "身份"),
    ("goals", "目标"),
    ("behavior_constraints", "行为约束"),
    ("current_status", "当前状态"),
)

_TITLES = {
    "foreshadow": "# 伏笔（设定库 · 分册）",
    "worldview": "# 世界观（设定库 · 分册）",
    "blueprint": "# 全书蓝图（A 层 · 长期）",
    "toc": "# 目录（B 层 · 中期）",
    "arcs": "# 剧情弧（C 层）",
    "brief": "# 第 {n} 章简报（D 层 · 单章简报）",
    "draft": "# 第 {n} 章正文",
}
_RULES = {
    "blueprint": "> 五个小节标题是结构标识：只能改正文，不能改标题、不能增删小节。",
    "toc": "> 一条一章。`第 N 章` 是主键：不能改号，也不能靠删条目下线章节。",
    "arcs": "> `弧 N` 是主键；起止章号只由主人调整。",
    "brief": "> 文件名章号即主键。这一页是 `/generate` 的输入，也进对话上下文。",
    "draft": "> 标题是投影结构；标题下方全部是正文内容。",
    "character": "> 文件名人物号即主键：改名不换路径。小节标题与字段名是结构标识，不可增删改名。",
    "foreshadow": "> `伏笔 N` 是主键：不能改号。埋设与收束章号只由主人调整。",
    "worldview": "> `设定 N` 是主键：不能改号，也不能靠删条目下线设定。",
}

_HEADING = re.compile(r"^##\s+(.*)$")
_BULLET = re.compile(r"^-\s+\*\*(.+?)\*\*\s*[：:]\s*(.*)$")
_SUB_BULLET = re.compile(r"^\s{2,}-\s+(.*)$")
_TOP_BULLET = re.compile(r"^-\s+(.*)$")
_CONTINUATION = re.compile(r"^\s{2,}\S.*$")
_TOC_ANCHOR = re.compile(r"^第\s*(\d+)\s*章\s*(.*)$")
_ARC_ANCHOR = re.compile(r"^弧\s*(\d+|\?)\s*(.*)$")
_FORESHADOW_ANCHOR = re.compile(r"^伏笔\s*(\d+|\?)\s*(.*)$")
_WORLDVIEW_ANCHOR = re.compile(r"^设定\s*(\d+|\?)\s*(.*)$")


# Every book of records shares one shape: a keyed `## ` heading plus its bullets.
# toc and arcs keep byte-identical headings so nothing already on file re-wraps.
_RECORD_SPECS = {
    "toc": {
        "label": "toc.md",
        "key": "chapter",
        "title_field": "title",
        "bullets": _TOC_BULLETS,
        "anchor": _TOC_ANCHOR,
        "shape": "## 第 42 章 章名",
        "heading": lambda row: "第 {} 章 {}".format(row.get("chapter"), _text(row.get("title"))).rstrip(),
    },
    "arcs": {
        "label": "arcs.md",
        "key": "arc",
        "title_field": "title",
        "bullets": _ARC_BULLETS,
        "anchor": _ARC_ANCHOR,
        "shape": "## 弧 1 弧名",
        "heading": lambda row: "弧 {} {}".format(
            "?" if row.get("arc") is None else row.get("arc"), _text(row.get("title"))
        ).rstrip(),
    },
    "foreshadow": {
        "label": "foreshadow.md",
        "key": "foreshadow",
        "title_field": "title",
        "bullets": _FORESHADOW_BULLETS,
        "anchor": _FORESHADOW_ANCHOR,
        "shape": "## 伏笔 1 伏笔名",
        "heading": lambda row: "伏笔 {} {}".format(
            "?" if row.get("foreshadow") is None else row.get("foreshadow"),
            _text(row.get("title")),
        ).rstrip(),
    },
    "worldview": {
        "label": "worldview.md",
        "key": "setting",
        "title_field": "name",
        "bullets": _WORLDVIEW_BULLETS,
        "anchor": _WORLDVIEW_ANCHOR,
        "shape": "## 设定 1 设定名",
        "heading": lambda row: "设定 {} {}".format(
            "?" if row.get("setting") is None else row.get("setting"),
            _text(row.get("name")),
        ).rstrip(),
    },
}

_EMPTY = "—"


# --- rendering --------------------------------------------------------------


def _doc(lines: list[str]) -> str:
    return "\n".join(lines).rstrip("\n") + "\n"


def _preamble(kind: str, chapter: int | None) -> list[str]:
    title = _TITLES[kind].format(n=chapter) if chapter is not None else _TITLES[kind]
    return [title, "", _RULES[kind], ""]


def _text(value: Any) -> str:
    if value is None:
        return _EMPTY
    if isinstance(value, bool):
        # A flag reads as 是/否 in the document; "True" would be a foreign language
        # on a page the author edits by hand.
        return "是" if value else "否"
    return str(value)


def _bullet_lines(row: dict[str, Any], spec: tuple[tuple[str, str], ...]) -> list[str]:
    out: list[str] = []
    for name, label in spec:
        value = row.get(name)
        if isinstance(value, list):
            out.append(f"- **{label}**：")
            out.extend(f"  - {item}" for item in value)
            continue
        lines = _text(value).split("\n")
        out.append(f"- **{label}**：{lines[0]}")
        out.extend(f"  {line}" for line in lines[1:])
    return out


def _section_lines(row: dict[str, Any], spec: tuple[tuple[str, str], ...]) -> list[str]:
    out: list[str] = []
    for name, label in spec:
        value = row.get(name)
        out.append(f"## {label}")
        if isinstance(value, list):
            out.extend(f"- {item}" for item in value)
        else:
            body = str(value or "").strip()
            if body:
                out.extend(body.split("\n"))
        out.append("")
    return out


def render(kind: str, payload: Any, *, chapter: int | None = None) -> str:
    """Render one layer model to Markdown. ``payload`` is a dict or a list of dicts."""
    if kind == "draft":
        body = str(payload.get("content", "") if isinstance(payload, dict) else payload)
        return _doc(_preamble(kind, chapter) + body.split("\n"))
    if kind == "blueprint":
        return _doc(_preamble(kind, chapter) + _section_lines(payload, _BLUEPRINT_SECTIONS))
    if kind == "brief":
        return _doc(
            _preamble(kind, chapter)
            + _bullet_lines(payload, _BRIEF_BULLETS)
            + [""]
            + _section_lines(payload, _BRIEF_SECTIONS)
        )
    if kind == "character":
        # The title carries the display name, not an id, so the preamble helper
        # (which only formats a chapter number) is bypassed here on purpose.
        return _doc(
            [f"# {_text(payload.get('name')) or '未命名人物'}（设定库 · 人物）", "",
             _RULES["character"], ""]
            + _bullet_lines(payload, _CHARACTER_BULLETS)
            + [""]
            + _section_lines(payload, _CHARACTER_SECTIONS)
        )
    if kind in _RECORD_SPECS:
        record = _RECORD_SPECS[kind]
        lines = _preamble(kind, chapter)
        for row in payload:
            lines.append("## " + record["heading"](row))
            lines.extend(_bullet_lines(row, record["bullets"]))
            lines.append("")
        return _doc(lines)
    raise MarkdownError(f"未知的文档层：{kind}")


# --- parsing ----------------------------------------------------------------


def _blocks(text: str) -> list[tuple[str | None, list[str]]]:
    """Split on ``## `` headings. The part before the first one is kept: briefs
    carry their bullets there, and the ``#`` title and ``>`` rule are ignored."""
    out: list[tuple[str | None, list[str]]] = [(None, [])]
    for line in text.split("\n"):
        match = _HEADING.match(line)
        if match:
            out.append((match.group(1).strip(), []))
        else:
            out[-1][1].append(line)
    return out

def _coerce_scalar(name: str, md_label: str, raw: str, label: str) -> Any:
    """A bullet is always text; numbers, flags and absent values come back typed."""
    if raw in ("", _EMPTY):
        return None
    if name in BOOL_FIELDS:
        lowered = raw.strip().lower()
        if lowered in _TRUE:
            return True
        if lowered in _FALSE:
            return False
        raise MarkdownError(f"{label} 的「{md_label}」只能写 是 或 否，收到「{raw}」")
    if name in INT_FIELDS or name in OPTIONAL_INT_FIELDS:
        if not re.fullmatch(r"-?\d+", raw):
            raise MarkdownError(f"{label} 的「{md_label}」必须是整数，收到「{raw}」")
        return int(raw)
    return raw


def _fail(label: str, missing: list[str], extra: list[str]) -> None:
    """Quiet unless something actually is missing or unexpected."""
    if not missing and not extra:
        return
    parts = []
    if missing:
        parts.append("缺少 " + "、".join(missing))
    if extra:
        parts.append("多出 " + "、".join(extra))
    raise MarkdownError(f"{label} 的小节标题与字段名是结构标识，不可增删改名：" + "；".join(parts))


def _read_bullets(lines: list[str], spec: tuple[tuple[str, str], ...], label: str) -> dict[str, Any]:
    wanted = dict(spec)
    by_label = {text: name for name, text in spec}
    found: dict[str, Any] = {}
    index = 0
    while index < len(lines):
        match = _BULLET.match(lines[index])
        if not match:
            index += 1
            continue
        name = by_label.get(match.group(1).strip())
        if name is None:
            _fail(label, [], [match.group(1).strip()])
        if name in found:
            _fail(label, [], [match.group(1).strip()])
        index += 1
        if name in LIST_FIELDS:
            items = []
            while index < len(lines) and (sub := _SUB_BULLET.match(lines[index])):
                items.append(sub.group(1).strip())
                index += 1
            found[name] = items
            continue
        body = [match.group(2)]
        while index < len(lines) and (more := _CONTINUATION.match(lines[index])):
            body.append(more.group(0).strip())
            index += 1
        joined = "\n".join(body).strip()
        found[name] = _coerce_scalar(name, match.group(1).strip(), joined, label)
    _fail(label, [text for name, text in wanted.items() if name not in found], [])
    return found


def _read_sections(blocks, spec, label):
    by_label = {text: name for name, text in spec}
    found: dict[str, str] = {}
    for heading, body in blocks:
        if heading is None:
            continue
        name = by_label.get(heading)
        if name is None:
            _fail(label, [], [heading])
        if name in found:
            _fail(label, [], [heading])
        body_text = "\n".join(body).strip()
        if name in LIST_FIELDS:
            items = [m.group(1).strip() for line in body if (m := _TOP_BULLET.match(line))
                     and line.startswith("- ")]
            stray = [line for line in body if line.strip()
                     and not line.startswith(("- ", "  "))]
            if stray:
                raise MarkdownError(
                    f"{label} 的「{heading}」是列表小节，只能写「- 条目」，收到「{stray[0]}」"
                )
            found[name] = items
        else:
            found[name] = body_text
    _fail(label, [text for name, text in spec if name not in found], [])
    return found


def _merge(target: dict[str, Any], extra: dict[str, Any]) -> dict[str, Any]:
    target.update(extra)
    return target


def parse(kind: str, text: str, *, chapter: int | None = None) -> Any:
    """Parse Markdown back into the same shape the YAML parser produced."""
    blocks = _blocks(text)
    if kind == "draft":
        # Draft prose may legitimately contain Markdown headings. Unlike the
        # planning codecs, its body is not split into semantic sections.
        lines = text.split("\n")
        start = 0
        while start < len(lines) and not lines[start].strip():
            start += 1
        # Drop only the generated preamble, not headings inside the prose.
        if start < len(lines) and lines[start].startswith("# "):
            start += 1
        while start < len(lines) and not lines[start].strip():
            start += 1
        if start < len(lines) and lines[start].startswith(">"):
            start += 1
        while start < len(lines) and not lines[start].strip():
            start += 1
        body = lines[start:]
        return {"content": "\n".join(body).strip()}
    if kind == "blueprint":
        return _read_sections(blocks, _BLUEPRINT_SECTIONS, "blueprint.md")
    if kind == "brief":
        label = f"briefs/{chapter:04d}.md" if chapter else "单章简报"
        row = _read_bullets(blocks[0][1] or [], _BRIEF_BULLETS, label)
        _merge(row, _read_sections(blocks[1:], _BRIEF_SECTIONS, label))
        return row
    if kind == "character":
        row = _read_bullets(blocks[0][1] or [], _CHARACTER_BULLETS, "人物档案")
        _merge(row, _read_sections(blocks[1:], _CHARACTER_SECTIONS, "人物档案"))
        return row
    if kind in _RECORD_SPECS:
        record = _RECORD_SPECS[kind]
        records = []
        for heading, body in blocks[1:]:
            match = record["anchor"].match(heading or "")
            if not match:
                raise MarkdownError(
                    f"标题「{heading}」不是记录：{record['label']} 要写成「{record['shape']}」"
                )
            head, tail = match.groups()
            row: dict[str, Any] = {
                record["key"]: None if head == "?" else int(head),
                record["title_field"]: tail.strip(),
            }
            _merge(row, _read_bullets(body, record["bullets"], f"「{heading}」"))
            records.append(row)
        return records
    raise MarkdownError(f"未知的文档层：{kind}")


# --- proposal stabilisation -------------------------------------------------

def _fold(value: Any) -> Any:
    """Fold whitespace so a re-wrapped sentence compares equal to the original."""
    if isinstance(value, list):
        return [_fold(item) for item in value]
    if isinstance(value, dict):
        return {key: _fold(item) for key, item in value.items()}
    if value is None:
        return ""
    # Drop whitespace entirely: these documents are Chinese, and re-wrapping a
    # sentence joins two hanzi with no separator, so a single space would still
    # read as a change.
    return "".join(str(value).split())


def _keep_untouched(current: Any, proposed: Any) -> Any:
    """Take the proposed value only where it really differs from the current one."""
    if isinstance(current, dict) and isinstance(proposed, dict):
        merged = dict(current)
        for key, value in proposed.items():
            if key not in current:
                continue  # 结构键锁死，不接受新增
            if _fold(current[key]) == _fold(value):
                continue  # 只是重新折行 -> 保留文件自己的换行
            merged[key] = value
        return merged
    if isinstance(current, list) and isinstance(proposed, list) and len(current) == len(proposed):
        return [_keep_untouched(old, new) for old, new in zip(current, proposed)]
    return proposed


def stabilize(kind: str, current_text: str, proposed_text: str, *, chapter: int | None = None) -> str:
    """Rebuild a proposal so untouched values keep the current file's own wrapping.

    The model is asked to leave every other line byte-identical and does not obey,
    which turns a one-value edit into a 47-line churn on the review card.  Here the
    proposal is parsed, folded against the file it would overwrite, and rendered
    again through the same codec, so reflow cannot escape the section that changed.
    """
    try:
        base = parse(kind, current_text, chapter=chapter)
        offered = parse(kind, proposed_text, chapter=chapter)
        return render(kind, _keep_untouched(base, offered), chapter=chapter)
    except Exception:
        return proposed_text
