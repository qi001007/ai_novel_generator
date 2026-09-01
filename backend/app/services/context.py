"""Retrieve novel-domain context for the chat agent."""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
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


def build_context(
    session: Session,
    novel_id: int,
    query: str,
    *,
    chapter_id: int | None = None,
    budget: int = DEFAULT_CONTEXT_BUDGET,
) -> tuple[list[ContextItem], list[str]]:
    """Rank context blocks for one turn: always the blueprint, then the rest."""
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

    scored: list[ContextItem] = []
    for item in items:
        score = 0
        if item.kind in {"novel", "blueprint"}:
            score += 40
        if item.ref in mention_refs:
            score += 200
        if item.kind in kinds:
            score += 60
        score += 6 * len(query_grams & _grams(item.label))
        score += min(20, len(query_grams & _grams(item.text)))

        number = _label_chapter_number(item.label)
        if number is not None:
            if number in chapters:
                score += 120
            if focus_chapter is not None and number == focus_chapter:
                score += 80

        if score > 0:
            scored.append(
                ContextItem(
                    kind=item.kind,
                    label=item.label,
                    text=item.text,
                    ref=item.ref,
                    score=score,
                    mention=item.mention,
                )
            )

    scored.sort(key=lambda item: (-item.score, item.label))

    selected: list[ContextItem] = []
    used = 0
    for item in scored:
        if used + len(item.text) > budget and selected:
            continue
        selected.append(item)
        used += len(item.text)
        if used >= budget:
            break
    return selected, unknown


def render_context(items: list[ContextItem]) -> str:
    if not items:
        return "（暂无可引用的作品资料）"
    return "\n\n".join(item.as_prompt_block() for item in items)
