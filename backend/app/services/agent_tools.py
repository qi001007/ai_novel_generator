"""The tools the agent is allowed to reach for.

Every read here goes through the same file layer the human uses, so the agent
cannot grow a second view of the data. There is deliberately no write tool:
a change to planning leaves this loop as a proposal, and only the human pressing
应用 puts it on disk, as actor=ai (DECISIONS D-01 / D-15).
"""

from __future__ import annotations

import re
import json
import time
from threading import Lock
from collections.abc import Callable
from functools import partial
from typing import Any

import httpx
from pydantic_ai import RunContext
from pydantic_ai import Tool as PydanticTool
from pydantic_ai.exceptions import ToolFailed
from sqlmodel import Session

from app.services.agent import Tool, ToolCall, ToolError, ToolRegistry
from app.services.documents import DocumentError, current_text_reader, list_files, read_file
from app.services.markdown_doc import grammar_text
from app.services.proposal_actions import ACTIONS, DIAG_PREFIX, run_action

WIKI_ENDPOINT = "https://zh.wikipedia.org/w/api.php"
WIKIDATA_ENDPOINT = "https://www.wikidata.org/w/api.php"
WIKI_HEADERS = {"User-Agent": "novel-generator/0.1 (writing research lookup)"}
SEARCH_RESULTS = 5
SEARCH_TIMEOUT = 15.0
SEARCH_ATTEMPTS = 2

# Reads a file as it stands right now, or None when this novel does not have it yet.
CurrentText = Callable[[str], str | None]

_TAG = re.compile(r"<[^>]+>")


# --- the five proposal tools ------------------------------------------------
# A typed action, not a file write: a handler compiles JSON into a markdown
# proposal fence and returns it as the tool result, so the change still goes
# through extract_proposals and the owner's 应用 click. A rejected payload comes back
# as readable text instead of an exception - the model gets one retry, and it needs
# to know which field to fix (UI-BACKLOG 35.6).


def _payload_schema() -> dict[str, Any]:
    """One string argument: both the legacy text protocol and the schema need it."""
    return {
        "type": "object",
        "properties": {
            "payload": {
                "type": "string",
                "description": "本动作的 JSON 输入，整段是一个 JSON 字符串；字段与格式见工具说明",
            }
        },
        "required": ["payload"],
    }


def _compile(
    action: str,
    payload: str,
    current: CurrentText | None = None,
) -> str:
    ok, text = run_action(action, payload, current)
    if ok:
        return text
    # A refused action is not a step that worked. ToolError keeps the diagnosis as the
    # content the model reads back (the registry turns it into ok=False + this same text),
    # so the repair round costs what it costs and the owner's trace says 未成功.
    raise ToolError(f"{DIAG_PREFIX}{text}")


def _proposal_tools(current: CurrentText | None = None) -> list[Tool]:
    """The action table is the only source: no action without a tool, no tool without one.

    `current` is the same live document the owner is looking at, so the gate here renders
    the same verdict the preview will: a proposal whose keys do not pair with that file
    (D-39) never becomes a card with a dead 应用 button.
    """
    return [
        Tool(
            name=spec.tool,
            description=spec.description,
            parameters=_payload_schema(),
            handler=partial(_compile, spec.action, current=current),
        )
        for spec in ACTIONS.values()
    ]


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
        """One document, exactly as the editor shows it, plus the field table it must keep."""
        cleaned = str(path).strip().lstrip("/")
        if not cleaned:
            raise ToolError("read_file 需要 path")
        with session_factory() as session:
            try:
                doc = read_file(session, novel_id, cleaned)
            except DocumentError as cause:
                raise ToolError(f"读不到 {cleaned}：{cause.detail}") from cause
        grammar = grammar_text(doc.kind)
        table = f"\n\n本文件写法（字段名以此为准，校验读的就是这张表）：\n{grammar}" if grammar else ""
        return f"{doc.path}（{doc.layer} 层 · {doc.label}）\n\n{doc.text}{table}"

    def current_text(path: str) -> str | None:
        """What the file holds right now; None when this novel does not have it yet."""
        with session_factory() as session:
            return current_text_reader(session, novel_id)(path)

    def search(query: str) -> str:
        """Public reference lookup over Wikipedia and Wikidata, without write access."""
        needle = str(query).strip()
        if not needle:
            raise ToolError("web_search 需要 query")
        sources = (("中文维基百科", WIKI_ENDPOINT), ("Wikidata", WIKIDATA_ENDPOINT))
        entries: list[tuple[str, str, str, str]] = []
        failures: list[str] = []
        with httpx.Client(timeout=SEARCH_TIMEOUT, headers=WIKI_HEADERS, transport=search_transport) as client:
            for source, endpoint in sources:
                response = None
                cause: Exception | None = None
                for attempt in range(SEARCH_ATTEMPTS):
                    try:
                        params = ({
                            "action": "query", "list": "search", "srsearch": needle,
                            "srlimit": SEARCH_RESULTS, "srprop": "snippet", "format": "json",
                        } if source == "中文维基百科" else {
                            "action": "wbsearchentities", "search": needle, "language": "zh",
                            "limit": SEARCH_RESULTS, "format": "json",
                        })
                        response = client.get(endpoint, params=params)
                        if response.status_code < 500:
                            break
                    except httpx.HTTPError as error:
                        cause = error
                    if attempt + 1 < SEARCH_ATTEMPTS:
                        time.sleep(0.05)
                if response is None or response.status_code >= 400:
                    failures.append(f"{source}（{type(cause).__name__ if cause else response.status_code}）")
                    continue
                try:
                    payload = response.json()
                    hits = (payload.get("query", {}).get("search", [])
                            if source == "中文维基百科" else payload.get("search", [])) or []
                except (TypeError, ValueError):
                    failures.append(f"{source}（响应格式错误）")
                    continue
                for hit in hits:
                    title = str(hit.get("title") or hit.get("label") or "").strip()
                    if not title:
                        continue
                    snippet = _TAG.sub("", str(hit.get("snippet") or hit.get("description") or ""))
                    snippet = snippet.replace("&quot;", chr(34)).strip()
                    pageid = hit.get("pageid")
                    url = (f"https://zh.wikipedia.org/?curid={pageid}" if pageid else
                           str(hit.get("concepturi") or f"https://www.wikidata.org/wiki/{hit.get('id', '')}"))
                    entries.append((title.casefold(), source, title, f"{snippet}\n  {url}"))
        unique: list[tuple[str, str, str, str]] = []
        seen_titles: set[str] = set()
        for entry in entries:
            if entry[0] not in seen_titles:
                seen_titles.add(entry[0])
                unique.append(entry)
        if not unique:
            if failures:
                raise ToolError(f"联网查证失败：{'；'.join(failures)}")
            suffix = f"（{'; '.join(failures)}）" if failures else ""
            return f"没有查到与「{needle}」相关的公开条目{suffix}。需要主人补充资料。"
        lines = [f"「{needle}」的公开资料（已合并并去重）："]
        lines.extend(f"- [{source}] {title}：{detail}" for _, source, title, detail in unique)
        if failures:
            lines.append(f"\n部分来源不可用：{'；'.join(failures)}。以上结果仍可供参考。")
        return "\n\n".join(lines)

    return _proposal_tools(current_text) + [
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
            description="查本书以外的公开资料（中文维基百科 + Wikidata），返回标题、摘要和 URL；来源失败会重试，不要用记忆冒充查证",
            parameters={
                "type": "object",
                "properties": {"query": {"type": "string", "description": "检索词"}},
                "required": ["query"],
            },
            handler=search,
        ),
    ]


def framework_tools_from_registry(registry: ToolRegistry, timings: dict[str, int]) -> list[PydanticTool]:
    """Hand the same registry to the framework instead of writing the tools twice.

    The signature is generated because that is the only way the framework gets a schema to
    check arguments against; the registry stays the single place the read-only boundary is
    written down, so a tool that appears here cannot be readable there. Two things ride
    along with every call: the elapsed time, recorded against the framework's
    `tool_call_id` so the trace can say what this step cost, and the registry's own failure
    text - a failure comes back as `ToolFailed`, which the model reads as a normal failed
    result and adapts to, exactly like the legacy loop handed it `ok=False`.
    """
    converted: list[PydanticTool] = []
    seen: set[tuple[str, str]] = set()
    seen_lock = Lock()
    for tool in registry.tools():
        properties = tool.parameters.get("properties", {})
        type_names: dict[str, str] = {}
        for name, spec in properties.items():
            kind = spec.get("type", "string")
            type_names[name] = {"string": "str", "integer": "int", "number": "float", "boolean": "bool"}.get(
                kind, "Any"
            )
        declared = ", ".join(f"{name}: {type_names[name]}" for name in properties)
        forwarded = ", ".join(f"{name}={name}" for name in properties)
        invoke = partial(
            _invoke_registry_tool,
            timings=timings,
            registry=registry,
            name=tool.name,
            seen=seen,
            seen_lock=seen_lock,
        )
        parameters = "ctx: _RunContext" + ((", " + declared) if declared else "")
        arguments = "ctx" + ((", " + forwarded) if forwarded else "")
        source = f"def _dynamic_tool({parameters}):\n"
        source += f"    return _invoke({arguments})\n"
        namespace: dict[str, Any] = {"_RunContext": RunContext, "_invoke": invoke}
        exec(compile(source, f"<agent-tool:{tool.name}>", "exec"), namespace)  # noqa: S102
        handler = namespace["_dynamic_tool"]
        handler.__name__ = tool.name
        handler.__qualname__ = f"agent_tool.{tool.name}"
        converted.append(PydanticTool(handler, name=tool.name, description=tool.description))
    return converted


def _invoke_registry_tool(
    ctx: Any,
    *,
    timings: dict[str, int],
    registry: ToolRegistry,
    name: str,
    seen: set[tuple[str, str]],
    seen_lock: Lock,
    **arguments: Any,
) -> str:
    """One tool call, run through the registry, timed while it ran."""
    started = time.perf_counter()
    try:
        signature = (name, json.dumps(arguments, ensure_ascii=False, sort_keys=True))
        with seen_lock:
            if signature in seen:
                return "这份内容本轮已经给过你了，不必再查。请基于已有资料直接回答。"
            seen.add(signature)
        result = registry.run(ToolCall(name=name, arguments=arguments))
    finally:
        timings[ctx.tool_call_id] = round((time.perf_counter() - started) * 1000)
    if not result.ok:
        raise ToolFailed(result.content)
    return result.content


def build_registry(
    session_factory: Callable[[], Session],
    novel_id: int,
    *,
    search_transport: httpx.BaseTransport | None = None,
) -> ToolRegistry:
    return ToolRegistry(_registry_tools(session_factory, novel_id, search_transport))
