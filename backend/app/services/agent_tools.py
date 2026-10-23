"""The tools the agent is allowed to reach for.

Every read here goes through the same file layer the human uses, so the agent
cannot grow a second view of the data. There is deliberately no write tool:
a change to planning leaves this loop as a proposal, and only the human pressing
应用 puts it on disk, as actor=ai (DECISIONS D-01 / D-15).
"""

from __future__ import annotations

import re
import json
import os
import time
from html import unescape
from pathlib import Path
from threading import Lock
from collections.abc import Callable
from functools import partial
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx
from dotenv import load_dotenv
from pydantic_ai import RunContext
from pydantic_ai import Tool as PydanticTool
from pydantic_ai.exceptions import ToolFailed
from fastapi import HTTPException
from pydantic import ValidationError
from sqlmodel import Session, select

from app.application import functions as _registered_functions  # noqa: F401
from app.core.commands import registry as command_registry
from app.models import Chapter, Document, Fact, KnowledgeEntry, Novel, OutlineNode, Review
from app.services.agent import AgentStep, Tool, ToolCall, ToolError, ToolRegistry, ToolResult
from app.services.chapters import ChapterDomainError
from app.services.documents import DocumentError, current_text_reader, list_files, read_file
from app.services.generation import generate_candidate
from app.services.markdown_doc import grammar_text
from app.services.proposal_actions import ACTIONS, DIAG_PREFIX, run_action
from app.services.reviews import build_remediation_report, run_review_workflow

WIKI_ENDPOINT = "https://zh.wikipedia.org/w/api.php"
WIKIDATA_ENDPOINT = "https://www.wikidata.org/w/api.php"
WIKI_HEADERS = {"User-Agent": "novel-generator/0.1 (writing research lookup)"}
SEARCH_DOTENV_PATH = Path(__file__).resolve().parents[2] / ".env"
load_dotenv(SEARCH_DOTENV_PATH)
BING_ENDPOINT = "https://www.bing.com/search"
DUCKDUCKGO_ENDPOINT = "https://html.duckduckgo.com/html/"
BRAVE_ENDPOINT = "https://search.brave.com/search"
YAHOO_ENDPOINT = "https://search.yahoo.com/search"
MOJEEK_ENDPOINT = "https://www.mojeek.com/search"
SEARXNG_ENDPOINT = os.getenv("NOVEL_SEARCH_ENDPOINT", "https://searx.be/search").rstrip("/")
SEARCH_PROXY = os.getenv("NOVEL_SEARCH_PROXY", "").strip() or None
SEARCH_RESULTS = 5
SEARCH_TIMEOUT = 15.0
SEARCH_ATTEMPTS = 2

# Reads a file as it stands right now, or None when this novel does not have it yet.
CurrentText = Callable[[str], str | None]

_TAG = re.compile(r"<[^>]+>")
_BING_RESULT = re.compile(r'<li[^>]+class="[^"]*b_algo[^"]*"[\s\S]*?<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)</a>[\s\S]*?(?:<p[^>]*>([\s\S]*?)</p>)?', re.I)
_DUCK_RESULT = re.compile(r'<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)</a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)</a>', re.I)


def _html_results(source: str, html: str) -> list[dict[str, str]]:
    pattern = _BING_RESULT if source == "Bing" else _DUCK_RESULT
    results: list[dict[str, str]] = []
    for raw_url, title, snippet in pattern.findall(html):
        url = unescape(raw_url)
        if url.startswith("//"):
            url = f"https:{url}"
        parsed = urlparse(url)
        if source == "DuckDuckGo" and parsed.hostname == "duckduckgo.com" and parsed.path == "/l/":
            url = parse_qs(parsed.query).get("uddg", [""])[0]
        # An ad-tracking redirect is not a source the model may cite.
        if not url.startswith("http") or urlparse(url).hostname in {"www.bing.com", "bing.com"}:
            continue
        clean_title = _TAG.sub("", title).strip()
        if clean_title:
            results.append({"url": url, "title": clean_title, "content": _TAG.sub("", snippet or "").strip()})
    return results


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
    novel_id: int | None,
    search_transport: httpx.BaseTransport | None = None,
    current_chapter_id: int | None = None,
) -> list[Tool]:
    """`search_transport` exists so a test can answer without touching the network."""
    def novels() -> str:
        with session_factory() as session:
            rows = session.exec(select(Novel).where(Novel.archived == False).order_by(Novel.updated_at.desc())).all()  # noqa: E712
        return json.dumps(
            {
                "status": "success",
                "summary": f"读取到 {len(rows)} 部作品",
                "next_actions": ["需要操作已有作品时读取它的 workspace"],
                "artifacts": {"novels": [row.model_dump(mode="json") for row in rows]},
            },
            ensure_ascii=False,
        )

    def workspace(target_novel_id: int) -> str:
        with session_factory() as session:
            novel = session.get(Novel, target_novel_id)
            if novel is None or novel.archived:
                raise ToolError("作品不存在或已归档")
            outline = session.exec(select(OutlineNode).where(OutlineNode.novel_id == target_novel_id, OutlineNode.status != "retired").order_by(OutlineNode.position)).all()
            documents = session.exec(select(Document).where(Document.novel_id == target_novel_id, Document.status != "retired").order_by(Document.path)).all()
            knowledge = session.exec(select(KnowledgeEntry).where(KnowledgeEntry.novel_id == target_novel_id, KnowledgeEntry.status != "retired").order_by(KnowledgeEntry.kind, KnowledgeEntry.name)).all()
            facts = session.exec(select(Fact).where(Fact.novel_id == target_novel_id, Fact.status != "retired").order_by(Fact.id)).all()
        return json.dumps(
            {
                "status": "success",
                "summary": f"已读取《{novel.title}》工作区",
                "next_actions": ["根据主人指令选择具体平台函数"],
                "artifacts": {
                    "novel": novel.model_dump(mode="json"),
                    "outline": [row.model_dump(mode="json") for row in outline],
                    "documents": [row.model_dump(mode="json") for row in documents],
                    "knowledge": [row.model_dump(mode="json") for row in knowledge],
                    "facts": [row.model_dump(mode="json") for row in facts],
                },
            },
            ensure_ascii=False,
        )

    def chapter_row(session: Session, chapter_id: int | None, chapter_number: int | None) -> Chapter:
        if chapter_id is None and chapter_number is None:
            chapter_id = current_chapter_id
        if chapter_id is not None:
            row = session.get(Chapter, chapter_id)
        elif chapter_number is not None:
            row = session.exec(
                select(Chapter).where(
                    Chapter.novel_id == novel_id,
                    Chapter.chapter_number == chapter_number,
                )
            ).first()
        else:
            raise ToolError("需要 chapter_id 或 chapter_number")
        if row is None or row.novel_id != novel_id:
            raise ToolError("这一章不存在，先用 read_workspace 确认章节")
        return row

    def generate_chapter(
        chapter_id: int | None = None,
        chapter_number: int | None = None,
        request: str = "",
    ) -> str:
        """用当前已发布的正文生成流程产出一份候选，不直接覆盖工作稿。"""
        with session_factory() as session:
            chapter = chapter_row(session, chapter_id, chapter_number)
            job = generate_candidate(session, chapter, str(request or "").strip())
            chapter_id_value = chapter.id
            chapter_number_value = chapter.chapter_number
            job_id = job.id
            job_status = job.status
            job_error = job.error
            content = job.result.get("content", "")
            token_input = job.result.get("token_input", 0)
            token_output = job.result.get("token_output", 0)
        return json.dumps(
            {
                "status": job_status,
                "summary": (
                    f"第 {chapter_number_value} 章候选已生成，共 {len(content)} 字，等待主人接受"
                    if job_status == "completed"
                    else f"生成失败：{job_error}"
                ),
                "artifacts": {
                    "candidate_id": job_id,
                    "chapter_id": chapter_id_value,
                    "chapter_number": chapter_number_value,
                    "token_input": token_input,
                    "token_output": token_output,
                    "content": content,
                },
            },
            ensure_ascii=False,
        )

    def review_chapter(chapter_id: int | None = None, chapter_number: int | None = None) -> str:
        """运行当前 AI 自检流程，返回结构化问题并落一份审稿记录。"""
        with session_factory() as session:
            chapter = chapter_row(session, chapter_id, chapter_number)
            try:
                review = run_review_workflow(session, novel_id, chapter)
            except ChapterDomainError as cause:
                raise ToolError(f"AI 自检失败：{cause.detail}") from cause
            chapter_number_value = chapter.chapter_number
            review_id = review.id
            decision = review.decision
            suggestions = review.evidence.get("suggestions") or []
        return json.dumps(
            {
                "status": "success",
                "summary": f"第 {chapter_number_value} 章质检完成：{len(suggestions)} 个问题（review #{review_id}）",
                "artifacts": {
                    "review_id": review_id,
                    "decision": decision,
                    "issues": suggestions,
                    "next_actions": ["需要整改清单时调用 remediation_report"],
                },
            },
            ensure_ascii=False,
        )

    def remediation_report(chapter_id: int | None = None, chapter_number: int | None = None) -> str:
        """把该章最近一次 AI 质检结果整理成可保存的 Markdown 整改报告。"""
        with session_factory() as session:
            chapter = chapter_row(session, chapter_id, chapter_number)
            review = session.exec(
                select(Review).where(
                    Review.novel_id == novel_id,
                    Review.chapter_id == chapter.id,
                ).order_by(Review.id.desc())
            ).first()
            if review is None:
                raise ToolError("这一章还没有质检记录，先运行 AI 自检")
            markdown, filename = build_remediation_report(review, chapter)
        return json.dumps(
            {
                "status": "success",
                "summary": f"已生成整改报告 {filename}",
                "artifacts": {"filename": filename, "markdown": markdown},
            },
            ensure_ascii=False,
        )

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
        """Read-only lookup with ordered public-search failover and knowledge-base fallbacks."""
        needle = str(query).strip()
        if not needle:
            raise ToolError("web_search 需要 query")
        public_sources = (
            ("Bing", BING_ENDPOINT), ("DuckDuckGo", DUCKDUCKGO_ENDPOINT),
            ("Brave", BRAVE_ENDPOINT), ("Yahoo", YAHOO_ENDPOINT), ("Mojeek", MOJEEK_ENDPOINT),
            ("SearXNG", SEARXNG_ENDPOINT), ("中文维基百科", WIKI_ENDPOINT), ("Wikidata", WIKIDATA_ENDPOINT),
        )
        # Tests inject a transport for the old JSON providers; live calls exercise the
        # public-page fallback chain above without ever reaching the test network.
        sources = public_sources if search_transport is None else (("SearXNG", SEARXNG_ENDPOINT), ("中文维基百科", WIKI_ENDPOINT), ("Wikidata", WIKIDATA_ENDPOINT))
        entries: list[tuple[str, str, str, str]] = []
        failures: list[str] = []
        with httpx.Client(timeout=SEARCH_TIMEOUT, headers={**WIKI_HEADERS, "Accept-Language": "zh-CN,zh;q=0.9"}, transport=search_transport, proxy=None if search_transport else SEARCH_PROXY, follow_redirects=True) as client:
            for source, endpoint in sources:
                response = None
                cause: Exception | None = None
                for attempt in range(SEARCH_ATTEMPTS):
                    try:
                        params = ({"q": needle} if source in {"Bing", "DuckDuckGo", "Brave", "Mojeek"} else {"p": needle} if source == "Yahoo" else {
                            "q": needle, "format": "json", "language": "zh-CN", "categories": "general",
                        } if source == "SearXNG" else {
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
                    payload = None if source in {"Bing", "DuckDuckGo", "Brave", "Yahoo", "Mojeek"} else response.json()
                    hits = (
                        _html_results(source, response.text) if source in {"Bing", "DuckDuckGo"} else
                        [] if source in {"Brave", "Yahoo", "Mojeek"} else
                        payload.get("results", []) if source == "SearXNG" else
                        payload.get("query", {}).get("search", []) if source == "中文维基百科" else
                        payload.get("search", [])
                    ) or []
                except (TypeError, ValueError):
                    failures.append(f"{source}（响应格式错误）")
                    continue
                for hit in hits:
                    title = str(hit.get("title") or hit.get("label") or "").strip()
                    if not title:
                        continue
                    snippet = _TAG.sub("", str(hit.get("content") or hit.get("snippet") or hit.get("description") or ""))
                    snippet = snippet.replace("&quot;", chr(34)).strip()
                    pageid = hit.get("pageid")
                    url = (str(hit.get("url") or "") if source in {"Bing", "DuckDuckGo", "SearXNG"} else f"https://zh.wikipedia.org/?curid={pageid}" if pageid else
                           str(hit.get("concepturi") or f"https://www.wikidata.org/wiki/{hit.get('id', '')}"))
                    if not url:
                        continue
                    entries.append((title.casefold(), source, title, f"{snippet}\n  {url}"))
                # A usable source ends the fallthrough chain. The next public page is only
                # contacted when this one failed or produced no parseable result.
                if entries and search_transport is None:
                    break
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
        lines = [f"「{needle}」的公开资料（公共搜索页按 Bing → DuckDuckGo → Brave → Yahoo → Mojeek → SearXNG 的顺序降级，已合并并去重）："]
        lines.extend(f"- [{source}] {title}：{detail}" for _, source, title, detail in unique)
        if failures:
            lines.append(f"\n部分来源不可用：{'；'.join(failures)}。以上结果仍可供参考。")
        return "\n\n".join(lines)

    def function_catalog() -> str:
        """The same callable catalogue used by page buttons and Workflow nodes."""
        functions = command_registry.list()
        return json.dumps({
            "status": "success",
            "summary": f"平台当前提供 {len(functions)} 个函数",
            "next_actions": ["选择最具体的函数；写入前先核对参数 Schema"],
            "artifacts": {"functions": functions},
        }, ensure_ascii=False)

    def preview_command(name: str, payload: str) -> str:
        """Validate one platform command and return its real diff without writing."""
        try:
            decoded = json.loads(payload or "{}")
            if not isinstance(decoded, dict):
                raise ToolError("payload 必须是 JSON 对象")
            with session_factory() as session:
                result = command_registry.preview(session, name.strip(), decoded)
            return json.dumps({
                "status": "success",
                "summary": f"已预览 {name.strip()}，尚未写入",
                "next_actions": ["低风险操作可执行；高风险操作必须等待主人确认"],
                "artifacts": {"preview": result},
                "preview": result,
            }, ensure_ascii=False)
        except (ValueError, ValidationError, HTTPException) as cause:
            detail = getattr(cause, "detail", None) or str(cause)
            raise ToolError(f"命令预览失败：{detail}") from cause

    def execute_command(name: str, payload: str, idempotency_key: str) -> str:
        """Execute only low-risk commands; high-risk changes stay deferred for UI approval."""
        try:
            decoded = json.loads(payload or "{}")
            if not isinstance(decoded, dict):
                raise ToolError("payload 必须是 JSON 对象")
            with session_factory() as session:
                preview = command_registry.preview(session, name.strip(), decoded)
                if preview["requires_confirmation"]:
                    return json.dumps(
                        {
                            "status": "warning",
                            "state": "confirmation_required",
                            "summary": f"{name.strip()} 是高风险操作，尚未写入",
                            "next_actions": ["向主人展示 preview 差异并等待批准或拒绝"],
                            "artifacts": {},
                            "command": name.strip(),
                            "preview": preview,
                        },
                        ensure_ascii=False,
                    )
                operation = command_registry.execute(
                    session,
                    name.strip(),
                    decoded,
                    idempotency_key=idempotency_key.strip(),
                    actor="agent",
                    approved=False,
                )
            return json.dumps(
                {
                    "status": "success",
                    "state": "executed",
                    "summary": f"已执行 {name.strip()}",
                    "next_actions": ["读取相关 workspace 确认页面资产已变化"],
                    "artifacts": {"operation_id": operation.id, "novel_id": operation.novel_id},
                    "operation": operation.model_dump(mode="json"),
                },
                ensure_ascii=False,
            )
        except (ValueError, ValidationError, HTTPException) as cause:
            detail = getattr(cause, "detail", None) or str(cause)
            raise ToolError(f"命令执行失败：{detail}") from cause

    common_tools = [
        Tool(
            name="list_novels",
            description="列出未归档作品及其 ID；在启动页或目标作品不明确时先调用",
            parameters={"type": "object", "properties": {}, "required": []},
            handler=novels,
        ),
        Tool(
            name="read_workspace",
            description="按 novel_id 读取新核心中的作品、结构、文档、知识与事实",
            parameters={
                "type": "object",
                "properties": {"target_novel_id": {"type": "integer", "description": "作品 ID"}},
                "required": ["target_novel_id"],
            },
            handler=workspace,
        ),
        Tool(
            name="web_search",
            description="查平台以外的公开资料，返回标题、摘要和原始 URL；只读，不要用记忆冒充查证",
            parameters={
                "type": "object",
                "properties": {"query": {"type": "string", "description": "检索词"}},
                "required": ["query"],
            },
            handler=search,
        ),
        Tool(
            name="list_platform_functions",
            description="读取页面、Agent 与 Workflow 共用的平台函数目录，包括参数 Schema、风险、预览和撤销能力",
            parameters={"type": "object", "properties": {}, "required": []},
            handler=function_catalog,
        ),
        Tool(
            name="preview_platform_command",
            description="预览一个平台函数的影响范围与差异，不写入数据；高风险操作必须先调用它",
            parameters={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "函数目录中的命令名，如 document.update"},
                    "payload": {"type": "string", "description": "命令输入的 JSON 对象字符串"},
                },
                "required": ["name", "payload"],
            },
            handler=preview_command,
        ),
        Tool(
            name="execute_platform_command",
            description="通过统一命令处理器执行低风险平台函数并留下 Operation；高风险命令只返回待确认差异",
            parameters={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "函数目录中的命令名"},
                    "payload": {"type": "string", "description": "命令输入的 JSON 对象字符串"},
                    "idempotency_key": {"type": "string", "description": "本次意图的唯一幂等键"},
                },
                "required": ["name", "payload", "idempotency_key"],
            },
            handler=execute_command,
        ),
    ]
    if novel_id is None:
        return common_tools
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
            name="generate_chapter",
            description="用当前已发布的正文生成流程为指定章生成候选正文；只产候选，不覆盖工作稿",
            parameters={
                "type": "object",
                "properties": {
                    "chapter_id": {"type": "integer", "description": "章节 ID；留空即当前打开章节，不要再追问"},
                    "chapter_number": {"type": "integer", "description": "章节序号，二选一"},
                    "request": {"type": "string", "description": "本次写作要求，可留空"},
                },
                "required": [],
            },
            handler=generate_chapter,
        ),
        Tool(
            name="review_chapter",
            description="运行当前 AI 自检流程，返回该章的结构化问题并保存审稿记录",
            parameters={
                "type": "object",
                "properties": {
                    "chapter_id": {"type": "integer", "description": "章节 ID；留空即当前打开章节，不要再追问"},
                    "chapter_number": {"type": "integer", "description": "章节序号，二选一"},
                },
                "required": [],
            },
            handler=review_chapter,
        ),
        Tool(
            name="remediation_report",
            description="把该章最近一次 AI 质检结果整理成 Markdown 整改报告",
            parameters={
                "type": "object",
                "properties": {
                    "chapter_id": {"type": "integer", "description": "章节 ID；留空即当前打开章节，不要再追问"},
                    "chapter_number": {"type": "integer", "description": "章节序号，二选一"},
                },
                "required": [],
            },
            handler=remediation_report,
        ),
    ] + common_tools


def framework_tools_from_registry(
    registry: ToolRegistry,
    timings: dict[str, int],
    step_sink: list[AgentStep] | None = None,
) -> list[PydanticTool]:
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
            step_sink=step_sink,
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
    step_sink: list[AgentStep] | None,
    **arguments: Any,
) -> str:
    """One tool call, run through the registry, timed while it ran."""
    started = time.perf_counter()
    call = ToolCall(name=name, arguments=arguments)
    signature = (name, json.dumps(arguments, ensure_ascii=False, sort_keys=True))
    with seen_lock:
        duplicate = signature in seen
        seen.add(signature)
    result = (
        ToolResult(
            call=call,
            content="这份内容本轮已经给过你了，不必再查。请基于已有资料直接回答。",
            ok=True,
        )
        if duplicate
        else registry.run(call)
    )
    elapsed = round((time.perf_counter() - started) * 1000)
    timings[ctx.tool_call_id] = elapsed
    if step_sink is not None:
        with seen_lock:
            step_sink.append(
                AgentStep(
                    index=len(step_sink) + 1,
                    call=call,
                    result=result,
                    ms=elapsed,
                )
            )
    if not result.ok:
        raise ToolFailed(result.content)
    return result.content


def build_registry(
    session_factory: Callable[[], Session],
    novel_id: int | None,
    *,
    search_transport: httpx.BaseTransport | None = None,
    current_chapter_id: int | None = None,
) -> ToolRegistry:
    return ToolRegistry(
        _registry_tools(session_factory, novel_id, search_transport, current_chapter_id)
    )
