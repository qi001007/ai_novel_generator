"""Retrieve novel-domain context for the chat agent."""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, replace
from json import JSONDecodeError
from typing import Any

from sqlmodel import Session, select

from app.models import (
    ArcPlan,
    Chapter,
    ChapterBrief,
    ChapterSummary,
    Character,
    Foreshadow,
    Novel,
    PlanningBlueprint,
    PlotFeedback,
    Setting,
    TocEntry,
)


DEFAULT_CONTEXT_BUDGET = 6000
MAX_SECTION_CHARS = 1200
_CHAPTER_LIKE_KINDS = {"chapter", "toc", "summary", "brief"}

ALIAS_KINDS: dict[str, tuple[str, ...]] = {
    "blueprint": ("蓝图", "全书蓝图", "主线", "终局", "主题", "a层"),
    "toc": ("目录", "章纲", "b层"),
    "arc": ("剧情弧", "弧", "c层"),
    "brief": ("简报", "单章简报", "d层"),
    "setting": ("设定", "世界观", "力量体系"),
    "character": ("人物", "角色", "主角"),
    "foreshadow": ("伏笔", "坑"),
    "summary": ("摘要", "前情", "梗概"),
    "chapter": ("正文", "章节", "原文"),
    "feedback": ("反馈", "变更记录"),
}

MENTION_KINDS: dict[str, tuple[str, ...]] = {
    "人物": ("character",),
    "角色": ("character",),
    "设定": ("setting",),
    "世界观": ("setting",),
    "伏笔": ("foreshadow",),
    "章节": ("chapter", "toc", "summary", "brief"),
    "正文": ("chapter",),
    "摘要": ("summary",),
    "目录": ("toc",),
    "蓝图": ("blueprint",),
    "弧": ("arc",),
    "简报": ("brief",),
    "反馈": ("feedback",),
}

_MENTION_TOKEN = re.compile(r"@([\w\u4e00-\u9fff:：\-]{1,32})")

MENTION_PREFIX: dict[str, str] = {
    "novel": "作品",
    "blueprint": "蓝图",
    "toc": "目录",
    "arc": "弧",
    "brief": "简报",
    "setting": "设定",
    "character": "人物",
    "foreshadow": "伏笔",
    "summary": "摘要",
    "chapter": "正文",
    "feedback": "反馈",
}
_CHAPTER_REF = re.compile(r"第\s*([0-9]{1,4})\s*章")


@dataclass(frozen=True)
class ContextItem:
    kind: str
    label: str
    text: str
    ref: str = ""
    score: int = 0
    mention: str = ""

    def as_prompt_block(self) -> str:
        return f"【{self.label}】\n{self.text}"

    def as_reference(self) -> dict[str, str]:
        return {
            "kind": self.kind,
            "label": self.label,
            "ref": self.ref,
            "mention": self.mention,
        }


def _mention_for(item: ContextItem) -> str:
    """Build the token that resolve_mentions() maps back onto this exact item."""
    prefix = MENTION_PREFIX.get(item.kind, "")
    if item.kind == "novel":
        return f"@{prefix}"

    if item.kind in _CHAPTER_LIKE_KINDS:
        numbers = sorted(_query_chapter_numbers(item.label))
        if numbers:
            return f"@{prefix}:{numbers[0]}"

    tail = item.ref.rsplit(":", 1)[-1] if ":" in item.ref else ""
    readable = item.label.rsplit(" \u00b7 ", 1)[-1].strip()
    name = readable if readable and " " not in readable else tail
    return f"@{prefix}:{name}" if prefix else f"@{name}"


def _clip(text: str, limit: int = MAX_SECTION_CHARS) -> str:
    cleaned = " ".join((text or "").split())
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit] + "……"


def _grams(text: str) -> set[str]:
    """Character bigrams plus latin words, a segmentation-free match signal."""
    lowered = (text or "").lower()
    words = set(re.findall(r"[a-z0-9]{2,}", lowered))
    cjk = re.findall(r"[\u4e00-\u9fff]", lowered)
    bigrams = {a + b for a, b in zip(cjk, cjk[1:])}
    return words | bigrams


def _chapter_number(item: Any) -> int | None:
    return getattr(item, "chapter_number", None)


def collect_items(session: Session, novel_id: int) -> list[ContextItem]:
    """Enumerate every context block the agent could cite for one novel."""
    items: list[ContextItem] = []

    novel = session.get(Novel, novel_id)
    if novel is not None:
        items.append(
            ContextItem(
                kind="novel",
                label="作品信息",
                ref="novel",
                text=_clip(
                    f"书名《{novel.title}》；目标 {novel.target_chapters} 章；"
                    f"简介：{novel.description or '未填写'}；"
                    f"文风约束：{novel.style_constraints or '未设置'}"
                ),
            )
        )

    blueprint = session.exec(
        select(PlanningBlueprint)
        .where(PlanningBlueprint.novel_id == novel_id)
        .order_by(PlanningBlueprint.version.desc())
    ).first()
    if blueprint is not None:
        segments = (
            ("A 全书蓝图 · 主线", blueprint.main_line),
            ("A 全书蓝图 · 终局", blueprint.ending),
            ("A 全书蓝图 · 核心冲突", blueprint.core_conflicts),
            ("A 全书蓝图 · 主题", blueprint.themes),
            ("A 全书蓝图 · 约束", blueprint.constraints),
        )
        for label, value in segments:
            if value.strip():
                items.append(
                    ContextItem(
                        kind="blueprint",
                        label=label,
                        ref=f"blueprint:{blueprint.id}",
                        text=_clip(value),
                    )
                )

    for entry in session.exec(
        select(TocEntry)
        .where(TocEntry.novel_id == novel_id, TocEntry.is_active == True)  # noqa: E712
        .order_by(TocEntry.chapter_number)
    ).all():
        detail = "；".join(
            part
            for part in (
                _clip(entry.plot_function, 200),
                _clip(entry.notes, 200),
            )
            if part
        )
        items.append(
            ContextItem(
                kind="toc",
                label=f"B 目录 · 第 {entry.chapter_number} 章 {entry.title or '未命名'}",
                ref=f"toc:{entry.id}",
                text=detail or "（仅标题）",
            )
        )

    for arc in session.exec(
        select(ArcPlan)
        .where(ArcPlan.novel_id == novel_id)
        .order_by(ArcPlan.start_chapter)
    ).all():
        items.append(
            ContextItem(
                kind="arc",
                label=f"C 剧情弧 · {arc.title or '未命名'}（{arc.start_chapter}-{arc.end_chapter}）",
                ref=f"arc:{arc.id}",
                text=_clip(
                    "；".join(
                        part
                        for part in (
                            f"目标：{arc.objective}" if arc.objective else "",
                            f"冲突：{arc.conflict}" if arc.conflict else "",
                            f"收束：{arc.resolution}" if arc.resolution else "",
                            f"状态：{arc.status}",
                        )
                        if part
                    )
                ),
            )
        )

    for brief in session.exec(
        select(ChapterBrief)
        .where(ChapterBrief.novel_id == novel_id)
        .order_by(ChapterBrief.chapter_number)
    ).all():
        items.append(
            ContextItem(
                kind="brief",
                label=f"D 简报 · 第 {brief.chapter_number} 章",
                ref=f"brief:{brief.id}",
                text=_clip(
                    "；".join(
                        part
                        for part in (
                            f"目标：{brief.goal}" if brief.goal else "",
                            f"事件：{brief.events}" if brief.events else "",
                            f"视角：{brief.pov}" if brief.pov else "",
                            f"出场：{'、'.join(brief.characters)}" if brief.characters else "",
                            f"冲突：{brief.conflict}" if brief.conflict else "",
                            f"钩子：{brief.hook}" if brief.hook else "",
                            f"必要事实：{'、'.join(brief.required_facts)}"
                            if brief.required_facts
                            else "",
                        )
                        if part
                    )
                ),
            )
        )

    for setting in session.exec(
        select(Setting).where(Setting.novel_id == novel_id).order_by(Setting.category)
    ).all():
        items.append(
            ContextItem(
                kind="setting",
                label=f"设定 · {setting.category}/{setting.name}",
                ref=f"setting:{setting.id}",
                text=_clip(
                    "；".join(
                        part
                        for part in (
                            setting.content,
                            f"当前状态：{setting.current_state}" if setting.current_state else "",
                            "已确认" if setting.is_confirmed else "待确认",
                        )
                        if part
                    )
                ),
            )
        )

    for character in session.exec(
        select(Character).where(Character.novel_id == novel_id).order_by(Character.name)
    ).all():
        relations = "、".join(
            f"{key}→{value}" for key, value in list(character.relationships.items())[:6]
        )
        items.append(
            ContextItem(
                kind="character",
                label=f"人物 · {character.name}",
                ref=f"character:{character.id}",
                text=_clip(
                    "；".join(
                        part
                        for part in (
                            f"级别：{character.level}",
                            f"身份：{character.identity}" if character.identity else "",
                            f"目标：{character.goals}" if character.goals else "",
                            f"行为约束:{character.behavior_constraints}"
                            if character.behavior_constraints
                            else "",
                            f"现状：{character.current_status}" if character.current_status else "",
                            f"关系：{relations}" if relations else "",
                        )
                        if part
                    )
                ),
            )
        )

    for fs in session.exec(
        select(Foreshadow)
        .where(Foreshadow.novel_id == novel_id)
        .order_by(Foreshadow.planted_chapter)
    ).all():
        payoff = fs.payoff_chapter or fs.expected_payoff_chapter
        items.append(
            ContextItem(
                kind="foreshadow",
                label=f"伏笔 · {fs.title}",
                ref=f"foreshadow:{fs.id}",
                text=_clip(
                    f"埋于第 {fs.planted_chapter} 章；"
                    + (f"预计第 {payoff} 章回收；" if payoff else "回收章未定；")
                    + f"状态：{fs.status}；{fs.content}"
                ),
            )
        )

    for summary in session.exec(
        select(ChapterSummary)
        .where(ChapterSummary.novel_id == novel_id)
        .order_by(ChapterSummary.chapter_number)
    ).all():
        items.append(
            ContextItem(
                kind="summary",
                label=f"章摘要 · 第 {summary.chapter_number} 章",
                ref=f"summary:{summary.id}",
                text=_clip(summary.summary) or "（空）",
            )
        )

    for chapter in session.exec(
        select(Chapter)
        .where(Chapter.novel_id == novel_id)
        .order_by(Chapter.chapter_number)
    ).all():
        if not chapter.content.strip():
            continue
        items.append(
            ContextItem(
                kind="chapter",
                label=f"正文 · 第 {chapter.chapter_number} 章 {chapter.title or '未命名'}",
                ref=f"chapter:{chapter.id}",
                text=_clip(chapter.content),
            )
        )

    for fb in session.exec(
        select(PlotFeedback)
        .where(PlotFeedback.novel_id == novel_id)
        .order_by(PlotFeedback.created_at.desc())
    ).all():
        levels = "/".join(fb.impact_levels) or "未分级"
        items.append(
            ContextItem(
                kind="feedback",
                label=f"反馈 · {fb.status}（影响 {levels}）",
                ref=f"feedback:{fb.id}",
                text=_clip(fb.content),
            )
        )

    return [replace(item, mention=_mention_for(item)) for item in items]


def mention_tokens(text: str) -> list[str]:
    """Raw @tokens in a message, for UI chips and stored mention metadata."""
    seen: list[str] = []
    for token in _MENTION_TOKEN.findall(text or ""):
        if token not in seen:
            seen.append(token)
    return seen


def resolve_mentions(
    items: list[ContextItem], text: str
) -> tuple[list[ContextItem], list[str]]:
    """Turn @tokens into context items; report the ones with no match."""
    resolved: list[ContextItem] = []
    unknown: list[str] = []

    for token in _MENTION_TOKEN.findall(text or ""):
        kind_filter: tuple[str, ...] | None = None
        name = token
        for separator in (":", "："):
            if separator in token:
                prefix, name = token.split(separator, 1)
                kind_filter = MENTION_KINDS.get(prefix)
                break
        name = name.strip()
        if not name:
            continue

        if name.isdigit():
            # Chapter-style numbers first: "第 5 章" beats "第 15 章" substring hits.
            pool = [
                item
                for item in items
                if item.kind in _CHAPTER_LIKE_KINDS and f"第 {name} 章" in item.label
            ]
            exact = [
                item for item in pool if kind_filter is None or item.kind in kind_filter
            ]
            if not exact:
                exact = [
                    item
                    for item in items
                    if kind_filter is not None
                    and item.kind in kind_filter
                    and item.ref.rsplit(":", 1)[-1] == name
                ]
        else:
            exact = [
                item
                for item in items
                if (kind_filter is None or item.kind in kind_filter)
                and (name in item.label or name == item.ref)
            ]
            if not exact and kind_filter is None:
                exact = [item for item in items if name in item.label]

        if exact:
            resolved.extend(exact[:3])
        else:
            unknown.append(name)

    seen: set[str] = set()
    unique = []
    for item in resolved:
        if item.ref not in seen:
            seen.add(item.ref)
            unique.append(item)
    return unique, unknown


def _query_chapter_numbers(text: str) -> set[int]:
    return {int(value) for value in _CHAPTER_REF.findall(text or "")}


def _label_chapter_number(label: str) -> int | None:
    numbers = _query_chapter_numbers(label)
    return next(iter(numbers)) if numbers else None


def _chat_reason(
    item: ContextItem,
    *,
    score: int,
    mention: bool,
    kind_hit: bool,
    number_hit: bool,
    focus_hit: bool,
) -> tuple[int, str]:
    """Tier plus the one-line reason the author reads in the injection manifest."""
    parts: list[str] = []
    tier = TIER_FILL
    if mention:
        parts.append("命中 @引用")
        tier = TIER_CORE
    if item.kind in {"novel", "blueprint"}:
        parts.append("作品与蓝图恒注入")
        tier = TIER_CORE
    if focus_hit:
        parts.append("当前焦点章")
        tier = min(tier, TIER_CONTINUITY)
    if number_hit:
        parts.append("指令点到章号")
        tier = min(tier, TIER_NEARBY)
    if kind_hit:
        parts.append("指令点名这类资料")
        tier = min(tier, TIER_NEARBY)
    if not parts:
        parts.append(f"相关度 {score}")
    return tier, "·".join(parts)


def build_chat_context(
    session: Session,
    novel_id: int,
    query: str,
    *,
    chapter_id: int | None = None,
    budget: int = DEFAULT_CONTEXT_BUDGET,
) -> tuple[WritingContext, list[str]]:
    """Rank context for one chat turn, and report why each block got in.

    The tiers and reasons only *describe* the order the relevance score already
    produced, so the manifest can be read against the reply without the report
    changing what the model sees.
    """
    items = collect_items(session, novel_id)
    mentions, unknown = resolve_mentions(items, query)
    mention_refs = {item.ref for item in mentions}

    query_grams = _grams(query)
    chapters = _query_chapter_numbers(query)
    kinds = {
        kind
        for keyword, kind in (
            (word, kind)
            for kind, words in ALIAS_KINDS.items()
            for word in words
        )
        if keyword in (query or "").lower()
    }

    focus_chapter: int | None = None
    if chapter_id is not None:
        chapter = session.get(Chapter, chapter_id)
        focus_chapter = chapter.chapter_number if chapter else None

    ranked: list[ContextBlock] = []
    for item in items:
        score = 0
        if item.kind in {"novel", "blueprint"}:
            score += 40
        mention_hit = item.ref in mention_refs
        if mention_hit:
            score += 200
        kind_hit = item.kind in kinds
        if kind_hit:
            score += 60
        score += 6 * len(query_grams & _grams(item.label))
        score += min(20, len(query_grams & _grams(item.text)))

        number_hit = False
        focus_hit = False
        number = _label_chapter_number(item.label)
        if number is not None:
            number_hit = number in chapters
            if number_hit:
                score += 120
            if focus_chapter is not None and number == focus_chapter:
                focus_hit = True
                score += 80

        if score <= 0:
            continue
        tier, reason = _chat_reason(
            item,
            score=score,
            mention=mention_hit,
            kind_hit=kind_hit,
            number_hit=number_hit,
            focus_hit=focus_hit,
        )
        ranked.append(
            ContextBlock(
                ContextItem(
                    kind=item.kind,
                    label=item.label,
                    text=item.text,
                    ref=item.ref,
                    score=score,
                    mention=item.mention,
                ),
                tier,
                reason,
            )
        )

    ranked.sort(key=lambda block: (-block.item.score, block.item.label))

    selected: list[ContextBlock] = []
    dropped: list[ContextBlock] = []
    used = 0
    for index, block in enumerate(ranked):
        if used + block.chars > budget and selected:
            block.reason = f"预算不足：已注入 {used} 字 / 预算 {budget} 字"
            dropped.append(block)
            continue
        selected.append(block)
        used += block.chars
        if used >= budget:
            for tail in ranked[index + 1:]:
                tail.reason = f"预算不足：已注入 {used} 字 / 预算 {budget} 字"
                dropped.append(tail)
            break
    return (
        WritingContext(budget=budget, used=used, selected=selected, dropped=dropped),
        unknown,
    )


def build_context(
    session: Session,
    novel_id: int,
    query: str,
    *,
    chapter_id: int | None = None,
    budget: int = DEFAULT_CONTEXT_BUDGET,
) -> tuple[list[ContextItem], list[str]]:
    """Back-compatible view of :func:`build_chat_context`: same order, no report."""
    ctx, unknown = build_chat_context(
        session, novel_id, query, chapter_id=chapter_id, budget=budget
    )
    return [block.item for block in ctx.selected], unknown


def render_context(items: list[ContextItem]) -> str:
    if not items:
        return "（暂无可引用的作品资料）"
    return "\n\n".join(item.as_prompt_block() for item in items)

# --- writing context (PRD 4.1 / 6.1) -------------------------------------
#
# Draft generation used to pick four objects by hand (novel / blueprint / arc / brief)
# and silently ignored every other fact the workbench stores, so a chapter could be
# written without a single open foreshadow or the end of the previous chapter. Chat
# already ranked the full item pool. Both now read `collect_items()`; only the ordering
# rule differs: chat sorts by question relevance, writing by these fixed tiers.

WRITING_CONTEXT_BUDGET = 12000
PREVIOUS_CHAPTER_TAIL_CHARS = 600
TOC_NEIGHBOURHOOD = 3
RECENT_SUMMARY_CHAPTERS = 5
CLOSED_FORESHADOW_STATUSES = {"resolved", "closed", "dropped", "已回收"}

TIER_CORE = 1  # never trimmed, even when it overflows the budget
TIER_CONTINUITY = 2  # previous arc / previous chapter glue
TIER_NEARBY = 3  # neighbourhood index and settings
TIER_FILL = 4  # everything else, first to go

TIER_NAMES = {
    TIER_CORE: "必注入",
    TIER_CONTINUITY: "连续性",
    TIER_NEARBY: "邻域",
    TIER_FILL: "填充",
}

WRITING_KIND_ORDER = {
    "novel": 0,
    "blueprint": 1,
    "brief": 2,
    "arc": 3,
    "chapter": 4,
    "character": 5,
    "foreshadow": 6,
    "toc": 7,
    "summary": 8,
    "setting": 9,
    "feedback": 10,
}


@dataclass
class ContextBlock:
    """One candidate injection, tagged with the tier that decided its fate."""

    item: ContextItem
    tier: int
    reason: str = ""

    @property
    def chars(self) -> int:
        return len(self.item.text)

    def as_manifest(self, index: int | None = None) -> dict[str, Any]:
        entry: dict[str, Any] = {
            "kind": self.item.kind,
            "label": self.item.label,
            "ref": self.item.ref,
            "tier": TIER_NAMES[self.tier],
            "chars": self.chars,
            "injected": index is not None,
        }
        if index is not None:
            entry["index"] = index
        if self.reason:
            entry["reason"] = self.reason
        return entry


@dataclass
class WritingContext:
    """Everything one draft call sees, plus what the budget cut away."""

    budget: int
    used: int
    selected: list[ContextBlock]
    dropped: list[ContextBlock]

    def manifest(self) -> dict[str, Any]:
        return {
            "budget": self.budget,
            "used": self.used,
            "blocks": [
                *[block.as_manifest(i) for i, block in enumerate(self.selected, start=1)],
                *[block.as_manifest() for block in self.dropped],
            ],
        }

    def manifest_json(self) -> str:
        return json.dumps(self.manifest(), ensure_ascii=False)


def _chapter_refs(rows: list[Any], prefix: str) -> set[str]:
    return {f"{prefix}:{row.id}" for row in rows}


def _open_foreshadow_refs(session: Session, novel_id: int) -> set[str]:
    rows = session.exec(
        select(Foreshadow).where(Foreshadow.novel_id == novel_id)
    ).all()
    return {
        f"foreshadow:{row.id}"
        for row in rows
        if row.status.strip().lower() not in CLOSED_FORESHADOW_STATUSES
    }


def _arc_refs_for_chapter(
    session: Session, novel_id: int, chapter_number: int
) -> tuple[set[str], set[str]]:
    """Current arc (contains the chapter) and the arc that just closed before it."""
    rows = session.exec(
        select(ArcPlan).where(ArcPlan.novel_id == novel_id).order_by(ArcPlan.start_chapter)
    ).all()
    current = {
        f"arc:{row.id}" for row in rows if row.start_chapter <= chapter_number <= row.end_chapter
    }
    earlier = [row for row in rows if row.end_chapter < chapter_number]
    previous = {f"arc:{earlier[-1].id}"} if earlier else set()
    return current, previous


def _previous_chapter_tail(
    session: Session, novel_id: int, chapter_number: int
) -> ContextItem | None:
    row = session.exec(
        select(Chapter)
        .where(Chapter.novel_id == novel_id, Chapter.chapter_number < chapter_number)
        .order_by(Chapter.chapter_number.desc())
    ).first()
    if row is None or not row.content.strip():
        return None
    collapsed = " ".join(row.content.split())
    return ContextItem(
        kind="chapter",
        label=f"上一章结尾 · 第 {row.chapter_number} 章",
        ref=f"chapter_tail:{row.id}",
        text=collapsed[-PREVIOUS_CHAPTER_TAIL_CHARS:],
    )


def build_writing_context(
    session: Session,
    novel_id: int,
    chapter_number: int,
    *,
    brief_id: int | None = None,
    budget: int = WRITING_CONTEXT_BUDGET,
) -> WritingContext:
    """Assemble the sliding writing window for one chapter (PRD 4.1)."""
    brief = session.get(ChapterBrief, brief_id) if brief_id is not None else None
    if brief is None:
        brief = session.exec(
            select(ChapterBrief).where(
                ChapterBrief.novel_id == novel_id,
                ChapterBrief.chapter_number == chapter_number,
            )
        ).first()

    cast = {name.strip() for name in (brief.characters if brief else []) if name.strip()}
    cast_refs = _chapter_refs(
        [row for row in session.exec(select(Character).where(Character.novel_id == novel_id)).all() if row.name in cast],
        "character",
    )
    current_arcs, previous_arcs = _arc_refs_for_chapter(session, novel_id, chapter_number)
    open_foreshadows = _open_foreshadow_refs(session, novel_id)
    brief_ref = f"brief:{brief.id}" if brief and brief.id is not None else ""

    def tier_of(item: ContextItem) -> int:
        number = _label_chapter_number(item.label)
        if item.kind in {"novel", "blueprint"}:
            return TIER_CORE
        if item.kind == "brief":
            return TIER_CORE if item.ref == brief_ref else TIER_NEARBY
        if item.ref in open_foreshadows or item.ref in cast_refs:
            return TIER_CORE
        if item.ref in current_arcs:
            return TIER_CORE
        if item.ref in previous_arcs or item.ref.startswith("chapter_tail:"):
            return TIER_CONTINUITY
        if item.kind == "toc" and number is not None and abs(number - chapter_number) <= TOC_NEIGHBOURHOOD:
            return TIER_NEARBY
        if item.kind == "summary" and number is not None and 0 < chapter_number - number <= RECENT_SUMMARY_CHAPTERS:
            return TIER_NEARBY
        if item.kind == "setting":
            return TIER_NEARBY
        return TIER_FILL

    pool = collect_items(session, novel_id)
    tail = _previous_chapter_tail(session, novel_id, chapter_number)
    if tail is not None:
        pool = [*pool, tail]

    # The previous chapter arrives once as its ending; letting its full text in as
    # well would pay for the same prose twice (REQUIREMENTS 10.2, 兼顾成本).
    tail_ref = tail.ref.split(":")[1] if tail is not None else ""
    duplicated = [
        block
        for block in (
            ContextBlock(item, tier_of(item))
            for item in pool
            if item.ref == f"chapter:{tail_ref}"
        )
    ]
    for block in duplicated:
        block.reason = "与已注入的上一章结尾重复"
    pool = [item for item in pool if item.ref != f"chapter:{tail_ref}"]

    blocks = [ContextBlock(item, tier_of(item)) for item in pool]
    blocks.sort(key=lambda block: (block.tier, WRITING_KIND_ORDER.get(block.item.kind, 99), block.item.label))

    selected: list[ContextBlock] = []
    dropped: list[ContextBlock] = []
    used = 0
    for block in blocks:
        if block.tier == TIER_CORE or used + block.chars <= budget:
            selected.append(block)
            used += block.chars
            continue
        block.reason = f"预算不足：已注入 {used} 字 / 预算 {budget} 字"
        dropped.append(block)

    if used > budget:
        for block in selected:
            if block.tier == TIER_CORE:
                block.reason = f"必注入，超出预算 {used - budget} 字仍保留"

    return WritingContext(
        budget=budget,
        used=used,
        selected=selected,
        dropped=[*dropped, *duplicated],
    )


# --- injection manifest observability (REQUIREMENTS 10.3) -----------------

CONTEXT_DEBUG_ENV = "NOVEL_CONTEXT_DEBUG"


def context_debug_enabled() -> bool:
    return os.getenv(CONTEXT_DEBUG_ENV, "").strip().lower() in {"1", "true", "yes", "on"}


def injection_report(
    ctx: WritingContext,
    *,
    novel_id: int,
    chapter_number: int | None = None,
    note: str = "",
) -> str:
    """The injection manifest as the author reads it in the server terminal."""
    subject = note or f"第 {chapter_number} 章"
    lines = [
        f"=== 注入上下文清单 · novel={novel_id} {subject} · "
        f"{ctx.used}/{ctx.budget} 字 ==="
    ]
    for index, block in enumerate(ctx.selected, start=1):
        note = f"（{block.reason}）" if block.reason else ""
        lines.append(
            f"{index:>2}. [{TIER_NAMES[block.tier]}] {block.item.kind:<10} "
            f"{block.chars:>5} 字  {block.item.label}{note}"
        )
    for block in ctx.dropped:
        lines.append(
            f" --. [{TIER_NAMES[block.tier]}] {block.item.kind:<10} "
            f"{block.chars:>5} 字  未注入：{block.item.label}（{block.reason}）"
        )
    return "\n".join(lines)


def log_injection(
    ctx: WritingContext,
    *,
    novel_id: int,
    chapter_number: int | None = None,
    note: str = "",
) -> None:
    """Print every block one call injects, so the author can prune or add."""
    if not context_debug_enabled():
        return
    print(
        injection_report(
            ctx, novel_id=novel_id, chapter_number=chapter_number, note=note
        ),
        flush=True,
    )


def parse_context_manifest(text: str) -> dict[str, Any] | None:
    """Read a stored manifest; older runs kept a plain-text marker instead."""
    if not text or not text.lstrip().startswith("{"):
        return None
    try:
        data = json.loads(text)
    except JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None
