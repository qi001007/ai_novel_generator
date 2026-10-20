"""Deterministic context selection for the rebuild data model."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session, select

from app.models import Document, Fact, KnowledgeEntry, Novel, OutlineNode
from app.models import ChapterBrief
from app.services.context import _workflow_items, collect_items


@dataclass(frozen=True)
class Candidate:
    key: str
    source: str
    title: str
    content: str
    score: int
    reason: str
    required: bool = False

    @property
    def estimated_tokens(self) -> int:
        return max(1, (len(self.content) + 3) // 4)


def _words(value: str) -> set[str]:
    compact = "".join(value.lower().split())
    return {compact[index : index + 2] for index in range(max(0, len(compact) - 1))}


def _document_candidate(document: Document, *, score: int, reason: str, required: bool = False) -> Candidate:
    return Candidate(
        key=f"document:{document.id}",
        source=document.kind,
        title=document.title or document.path,
        content=document.content,
        score=score,
        reason=reason,
        required=required,
    )


def build_context_preview(
    session: Session,
    *,
    novel_id: int,
    task_type: str,
    token_budget: int,
    outline_node_id: int | None = None,
    query: str = "",
    policy: dict[str, Any] | None = None,
    chapter_number: int | None = None,
) -> dict[str, Any]:
    novel = session.get(Novel, novel_id)
    if novel is None:
        raise HTTPException(status_code=404, detail="Novel not found")

    # The restored books still live in the verified projection tables. A workflow
    # policy must therefore select from collect_items(), the same single pool used by
    # the editor, until those rows are migrated to Document/KnowledgeEntry. Crucially,
    # the policy comes from the immutable workflow version, never from a current
    # default row.
    if policy is not None and chapter_number is not None:
        pool = collect_items(session, novel_id)
        brief = session.exec(
            select(ChapterBrief).where(
                ChapterBrief.novel_id == novel_id,
                ChapterBrief.chapter_number == chapter_number,
            )
        ).first()
        selected_pool, missing = _workflow_items(
            pool,
            policy,
            chapter_number=chapter_number,
            brief=brief,
        )
        budget = max(100, int(policy.get("budget", token_budget)))
        selected: list[dict[str, Any]] = []
        excluded: list[dict[str, Any]] = []
        used = 0
        selected_refs = {item.ref for item in selected_pool}
        for item in selected_pool:
            estimated = max(1, (len(item.text) + 3) // 4)
            remaining = budget - used
            if remaining <= 0:
                excluded.append({"key": item.ref, "source": item.kind, "title": item.label, "reason": "Token 预算已用完"})
                continue
            text = item.text
            reason = "命中当前 Workflow 的动态上下文策略"
            if estimated > remaining:
                text = text[: remaining * 4]
                estimated = max(1, (len(text) + 3) // 4)
                reason += "；按预算截断"
            selected.append({
                "key": item.ref,
                "source": item.kind,
                "title": item.label,
                "content": text,
                "reason": reason,
                "required": item.kind in {"novel", "blueprint", "brief"},
                "estimated_tokens": estimated,
            })
            used += estimated
        for item in pool:
            if item.ref not in selected_refs:
                excluded.append({"key": item.ref, "source": item.kind, "title": item.label, "reason": "未命中当前 Workflow 策略"})
        return {
            "novel_id": novel_id,
            "task_type": task_type,
            "token_budget": budget,
            "estimated_tokens": used,
            "selected": selected,
            "excluded": excluded,
            "missing_characters": missing,
        }

    documents = session.exec(
        select(Document).where(Document.novel_id == novel_id, Document.status != "retired")
    ).all()
    nodes = session.exec(
        select(OutlineNode).where(OutlineNode.novel_id == novel_id, OutlineNode.status != "retired")
    ).all()
    knowledge = session.exec(
        select(KnowledgeEntry).where(KnowledgeEntry.novel_id == novel_id, KnowledgeEntry.status != "retired")
    ).all()
    facts = session.exec(select(Fact).where(Fact.novel_id == novel_id, Fact.status != "retired")).all()

    node_by_id = {node.id: node for node in nodes}
    current = node_by_id.get(outline_node_id)
    if outline_node_id is not None and current is None:
        raise HTTPException(status_code=404, detail="Outline node not found")

    candidates: dict[str, Candidate] = {}
    for document in documents:
        if document.kind == "mainline":
            item = _document_candidate(document, score=1000, reason="作品核心是必选锚点", required=True)
            candidates[item.key] = item

    if current is not None:
        path_parts = [current.title]
        parent = node_by_id.get(current.parent_id)
        if parent is not None:
            path_parts.insert(0, parent.title)
        path = Candidate(
            key=f"outline:{current.id}",
            source="outline_path",
            title="当前结构路径",
            content=" / ".join(path_parts),
            score=1000,
            reason="当前结构路径是必选锚点",
            required=True,
        )
        candidates[path.key] = path
        for document in documents:
            if document.outline_node_id == current.id and document.kind == "chapter_plan":
                item = _document_candidate(document, score=1000, reason="当前章节规划是必选锚点", required=True)
                candidates[item.key] = item
            if parent is not None and document.outline_node_id == parent.id and document.kind == "volume_plan":
                item = _document_candidate(document, score=1000, reason="当前卷目标是必选锚点", required=True)
                candidates[item.key] = item

        siblings = sorted(
            [node for node in nodes if node.parent_id == current.parent_id and node.kind == "chapter"],
            key=lambda node: (node.position, node.id or 0),
        )
        current_index = next((index for index, node in enumerate(siblings) if node.id == current.id), None)
        if current_index is not None and current_index > 0:
            previous = siblings[current_index - 1]
            for document in documents:
                if document.outline_node_id == previous.id and document.kind == "draft":
                    item = Candidate(
                        key=f"document:{document.id}",
                        source="previous_chapter",
                        title=document.title or previous.title,
                        content=document.content[-6000:],
                        score=950,
                        reason="上一章结尾负责承接",
                        required=True,
                    )
                    candidates[item.key] = item

        if current_index is not None:
            for index, sibling in enumerate(siblings):
                distance = abs(index - current_index)
                if distance == 0 or distance > 3:
                    continue
                for document in documents:
                    if document.outline_node_id == sibling.id and document.kind in {"chapter_plan", "draft"}:
                        item = _document_candidate(
                            document,
                            score=700 - distance * 100,
                            reason=f"与当前章节相距 {distance} 章",
                        )
                        candidates[item.key] = item

    reference_text = " ".join(
        [query, task_type, current.title if current else ""]
        + [candidate.content for candidate in candidates.values() if candidate.required]
    )
    reference_words = _words(reference_text)
    for entry in knowledge:
        explicit = entry.name in reference_text
        overlap = len(_words(entry.name + entry.content[:1000]) & reference_words)
        score = 850 if explicit else 300 + min(overlap, 20) * 10
        candidate = Candidate(
            key=f"knowledge:{entry.id}",
            source=entry.kind,
            title=entry.name,
            content=entry.content,
            score=score,
            reason="被任务或锚点明确提及" if explicit else "与当前任务存在名称或文本关联",
        )
        candidates[candidate.key] = candidate

    excluded: list[dict[str, Any]] = []
    for fact in facts:
        title = f"{fact.subject} · {fact.predicate}"
        if fact.status != "approved":
            excluded.append(
                {
                    "key": f"fact:{fact.id}",
                    "source": "fact",
                    "title": title,
                    "reason": "事实尚未审批，不得进入稳定上下文",
                }
            )
            continue
        explicit = fact.subject in reference_text or fact.value in reference_text
        candidate = Candidate(
            key=f"fact:{fact.id}",
            source="approved_fact",
            title=title,
            content=f"{fact.subject} {fact.predicate} {fact.value}",
            score=900 if explicit else 500,
            reason="已审批事实且被明确提及" if explicit else "已审批稳定事实",
        )
        candidates[candidate.key] = candidate

    ordered = sorted(candidates.values(), key=lambda item: (-int(item.required), -item.score, item.key))
    selected: list[dict[str, Any]] = []
    used_tokens = 0
    for candidate in ordered:
        remaining = token_budget - used_tokens
        if remaining <= 0:
            excluded.append(
                {"key": candidate.key, "source": candidate.source, "title": candidate.title, "reason": "Token 预算已用完"}
            )
            continue
        content = candidate.content
        estimated = candidate.estimated_tokens
        reason = candidate.reason
        if estimated > remaining:
            if not candidate.required:
                excluded.append(
                    {"key": candidate.key, "source": candidate.source, "title": candidate.title, "reason": "超出剩余 Token 预算"}
                )
                continue
            content = content[: remaining * 4]
            estimated = max(1, (len(content) + 3) // 4)
            reason += "；为满足总预算已截断"
        selected.append(
            {
                "key": candidate.key,
                "source": candidate.source,
                "title": candidate.title,
                "content": content,
                "reason": reason,
                "required": candidate.required,
                "estimated_tokens": estimated,
            }
        )
        used_tokens += estimated

    return {
        "novel_id": novel_id,
        "task_type": task_type,
        "token_budget": token_budget,
        "estimated_tokens": used_tokens,
        "selected": selected,
        "excluded": sorted(excluded, key=lambda item: item["key"]),
    }
