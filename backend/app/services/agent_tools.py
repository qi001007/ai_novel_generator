"""The tools the agent is allowed to reach for.

Every read here goes through the same file layer the human uses, so the agent
cannot grow a second view of the data. There is deliberately no write tool:
a change to planning leaves this loop as a proposal, and only the human pressing
应用 puts it on disk, as actor=ai (DECISIONS D-01 / D-15).
"""

from __future__ import annotations

import re
from collections.abc import Callable

import httpx
from sqlmodel import Session

from app.services.agent import Tool, ToolError, ToolRegistry
from app.services.documents import DocumentError, list_files, read_file

WIKI_ENDPOINT = "https://zh.wikipedia.org/w/api.php"
WIKI_HEADERS = {"User-Agent": "novel-generator/0.1 (writing research lookup)"}
SEARCH_RESULTS = 5
SEARCH_TIMEOUT = 15.0

_TAG = re.compile(r"<[^>]+>")


def _registry_tools(
    session_factory: Callable[[], Session],
    novel_id: int,
    search_transport: httpx.BaseTransport | None = None,
) -> list[Tool]:
    """`search_transport` exists so a test can answer without touching the network."""
    def files() -> str:
        """Every planning and setting document this novel has."""
        with session_factory() as session:
            metas = list_files(session, novel_id)
        if not metas:
            return "这个作品还没有任何规划文件。"
        return "\n".join(f"{meta.path}  ({meta.layer} 层 · {meta.label})" for meta in metas)

    def read(path: str) -> str:
        """One document, exactly as the editor shows it."""
        cleaned = str(path).strip().lstrip("/")
        if not cleaned:
            raise ToolError("read_file 需要 path")
        with session_factory() as session:
            try:
                doc = read_file(session, novel_id, cleaned)
            except DocumentError as cause:
                raise ToolError(f"读不到 {cleaned}：{cause.detail}") from cause
        return f"{doc.path}（{doc.layer} 层 · {doc.label}）\n\n{doc.text}"

    def search(query: str) -> str:
        """Public reference lookup. Answers what the workspace does not hold."""
        needle = str(query).strip()
        if not needle:
            raise ToolError("web_search 需要 query")
        try:
            with httpx.Client(
                timeout=SEARCH_TIMEOUT, headers=WIKI_HEADERS, transport=search_transport
            ) as client:
                response = client.get(
                    WIKI_ENDPOINT,
                    params={
                        "action": "query",
                        "list": "search",
                        "srsearch": needle,
                        "srlimit": SEARCH_RESULTS,
                        "srprop": "snippet",
                        "format": "json",
                    },
                )
        except httpx.HTTPError as cause:
            raise ToolError(f"联网查证失败，网络不可用：{type(cause).__name__}") from cause
        if response.status_code >= 400:
            raise ToolError(f"联网查证失败，上游返回 {response.status_code}")
        hits = response.json().get("query", {}).get("search", []) or []
        if not hits:
            # "nothing found" is a real answer; the model must not fill the hole.
            return f"没有查到与「{needle}」相关的公开条目。需要主人补充资料。"
        lines = [f"「{needle}」的公开资料（中文维基百科，取前 {len(hits)} 条）："]
        for hit in hits:
            snippet = _TAG.sub("", hit.get("snippet", "")).replace("&quot;", chr(34)).strip()
            title = hit.get("title", "")
            lines.append(f"- {title}：{snippet}\n  https://zh.wikipedia.org?curid={hit.get('pageid', '')}")
        return "\n\n".join(lines)

    return [
        Tool(
            name="list_files",
            description="列出这本书所有规划与设定文件的路径，read_file 的 path 从这里取",
            parameters={"type": "object", "properties": {}, "required": []},
            handler=files,
        ),
        Tool(
            name="read_file",
            description="按路径读一份文件的当前全文（A 蓝图 / B 目录 / C 弧 / D 简报 / 设定库）",
            parameters={
                "type": "object",
                "properties": {"path": {"type": "string", "description": "如 arcs.md 或 chapters/0042/brief.md"}},
                "required": ["path"],
            },
            handler=read,
        ),
        Tool(
            name="web_search",
            description="查本书以外的公开资料（当前来源：中文维基百科）。制度、地名、典故、科学事实用它，不要用记忆冒充查证",
            parameters={
                "type": "object",
                "properties": {"query": {"type": "string", "description": "检索词"}},
                "required": ["query"],
            },
            handler=search,
        ),
    ]


def build_registry(
    session_factory: Callable[[], Session],
    novel_id: int,
    *,
    search_transport: httpx.BaseTransport | None = None,
) -> ToolRegistry:
    return ToolRegistry(_registry_tools(session_factory, novel_id, search_transport))
