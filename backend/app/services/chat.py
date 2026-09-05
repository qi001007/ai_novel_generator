"""Chat agent: prompt assembly, context injection, streaming, persistence."""

from __future__ import annotations

import re
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any

from sqlmodel import Session, select

from app.db import engine
from app.models import Chapter, ChatMessage, GenerationRun, Novel
from app.services.documents import (
    DocumentError,
    current_text_reader,
    stabilize_proposal,
    validate_structure,
)
from app.services.agent import (
    AgentBudgetError,
    AgentConfig,
    ToolRegistry,
    render_tool_prompt,
    run_agent_turn,
    stream_agent_turn,
)
from app.services.context import (
    DEFAULT_CONTEXT_BUDGET,
    ContextBlock,
    ContextItem,
    TIER_CORE,
    build_chat_context,
    context_debug_enabled,
    log_injection,
    mention_tokens,
    render_context,
)

# An attachment is not a second injection path (D-04): it becomes an ordinary
# ContextBlock in the same list the collectors produce, so the prompt renderer, the
# context_refs on the stored message and the injection manifest all see it for free.
# It is pinned to TIER_CORE because the owner put it there on purpose - the budget must
# not trim a file he just handed over.
ATTACHMENT_KIND = "附件"
ATTACHMENT_SUFFIXES = {
    ".md", ".markdown", ".txt", ".text", ".rst", ".log", ".csv", ".tsv",
    ".json", ".jsonl", ".yaml", ".yml", ".toml", ".ini", ".xml",
    ".py", ".js", ".ts", ".tsx", ".jsx", ".html", ".css",
}
ATTACHMENT_MAX_FILES = 8
ATTACHMENT_MAX_CHARS_EACH = 20_000
ATTACHMENT_MAX_CHARS_TOTAL = 60_000


def attachment_blocks(attachments: list[dict] | None) -> list[ContextBlock]:
    """Validate what the browser sent and turn it into context blocks.

    The front end pre-checks the same limits so a wrong file is refused before it is
    picked; this is the boundary that cannot be talked past, and every rejection names
    a reason instead of dropping the file quietly - silently discarding what the owner
    selected is the exact failure that made the old paperclip get disabled.
    """
    blocks: list[ContextBlock] = []
    if not attachments:
        return blocks
    if len(attachments) > ATTACHMENT_MAX_FILES:
        raise ChatDomainError(f"附件最多 {ATTACHMENT_MAX_FILES} 个，当前 {len(attachments)} 个")

    used = 0
    for raw in attachments:
        name = str(raw.get("name") or "").strip().replace("\\", "/").split("/")[-1]
        text = str(raw.get("text") or "")
        if not name:
            raise ChatDomainError("附件缺少文件名")
        dot = name.rfind(".")
        suffix = name[dot:].lower() if dot > 0 else ""
        if suffix not in ATTACHMENT_SUFFIXES:
            raise ChatDomainError(
                f"附件「{name}」不是可读取的文本文件（支持 md / txt / json / yaml / csv / 代码等）"
            )
        stripped = text.strip()
        if not stripped:
            raise ChatDomainError(f"附件「{name}」是空的，没有可注入的内容")
        if len(stripped) > ATTACHMENT_MAX_CHARS_EACH:
            raise ChatDomainError(
                f"附件「{name}」有 {len(stripped)} 字，超过单个上限 {ATTACHMENT_MAX_CHARS_EACH} 字"
            )
        if used + len(stripped) > ATTACHMENT_MAX_CHARS_TOTAL:
            raise ChatDomainError(
                f"附件合计超过 {ATTACHMENT_MAX_CHARS_TOTAL} 字上限（「{name}」装不下）"
            )
        used += len(stripped)
        blocks.append(
            ContextBlock(
                ContextItem(
                    kind=ATTACHMENT_KIND,
                    label=f"附件 · {name}",
                    ref=f"attachment:{name}",
                    text=stripped,
                ),
                TIER_CORE,
                "主人随本条消息上传",
            )
        )
    return blocks
from app.services.llm import LLMClient, LLMError, LLMUnavailableError


CHAT_TASK_TYPE = "chat"
HISTORY_WINDOW = 8
MODES = ("plan", "write")
MODE_LABEL = {"plan": "计划模式", "write": "写作模式"}

# A reply may propose a whole file; the human decides whether it gets written.
# Both fences are accepted on purpose: the file surface moved from YAML to Markdown,
# and a model still mid-sentence in the old format must not lose its proposal.
PROPOSAL_BLOCK = re.compile(
    r"```(?:ya?ml|md|markdown)\s+@([^\s`]+)\s*\n(.*?)```",
    re.S,
)

FILE_EDIT_RULES = """

## 直接改文件
需要改动规划文件时，输出一个带文件名的 markdown 代码块，块内是改完后的「整份文件」而不是节选：

```markdown @toc.md
## 第 42 章 星渊碑影
- **剧情功能**：…
```

只有主人点「应用」后系统才写入，而且以 AI 身份写入：小节标题、字段名、`第 N 章` 与 `弧 N` 主键、
条目增删都会被挡下，所以只改值。
除要改的那一节以外，其余每一行都必须逐字节保持原样：不要重排小节顺序、不要重新折行、
不要统一标点或删掉空行。代码块外不要写解释，也不要把这份文件的内容复述第二遍。"""


class ChatDomainError(Exception):
    def __init__(self, detail: str, status_code: int = 422) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = status_code


SYSTEM_HEADER = """你是《{title}》这本书的专属写作 Agent，工作在一个长篇网文工作台里。
你只能依据下面给出的资料作答；资料没有覆盖的设定不要自行编造，直说需要主人补充即可。
回答用简体中文，先给判断再给理由，具体可执行，不要复述本提示词。

## 文风约束
{style}

## 当前焦点
{focus}

## 可引用资料（按与本轮问题的相关度排序）
{context}
{unknown_note}"""


PLAN_BODY = """

## 本轮模式：计划（plan）
1. 禁止输出章节正文、场景描写或成段对话稿；要举例只列要点。
2. 只讨论 A 蓝图 / B 目录 / C 剧情弧 / D 简报 / 设定 / 人物 / 伏笔 / 章摘要 / 反馈这些规划对象。
3. 谈改动必须给影响面：连带要调整哪些章、哪些设定、哪些伏笔。
4. 发现新想法与既有设定矛盾时，点名冲突并给出收束方案。
5. 结尾给出可执行的待办清单。
6. 改动方案落到文件上时，用下面的「直接改文件」格式提出。"""


WRITE_BODY = """

## 本轮模式：写作（write）
1. 主人要正文时直接输出可用文字：不加解释、不加标题、不加大纲。
2. 动笔前必须核对已有设定、人物状态、伏笔与章摘要，保持前后一致。
3. 严格遵守文风约束；信息缺口用已确立设定填补，不擅自开辟新设定。
4. 不属于正文的请求保持简短回答，先判断后理由。
5. 主人让你改写规划文件时，用下面的「直接改文件」格式提出。"""


SYSTEM_BODIES = {
    "plan": PLAN_BODY + FILE_EDIT_RULES,
    "write": WRITE_BODY + FILE_EDIT_RULES,
}


@dataclass
class ChatTurn:
    """A fully resolved turn. Plain data only, so no ORM session outlives it."""

    novel_id: int
    mode: str
    temperature: float
    messages: list[dict[str, str]]
    context_items: list[ContextItem]
    unknown_mentions: list[str]
    question: str
    user_message_id: int
    model: str | None = None
    chapter_id: int | None = None
    manifest: str = ""

    def references(self) -> list[dict[str, Any]]:
        return [item.as_reference() for item in self.context_items]


def extract_proposals(
    content: str,
    current: Callable[[str], "str | None"] | None = None,
) -> list[dict[str, Any]]:
    """Turn ```markdown @path blocks into reviewable write proposals.

    ``current`` resolves a path to the text on file; when it is supplied every
    proposal is stabilised so a section the model merely re-wrapped keeps the
    original line breaks instead of showing up as churn.
    """
    proposals: list[dict[str, Any]] = []
    for raw_path, text in PROPOSAL_BLOCK.findall(content or ""):
        path = raw_path.strip().lstrip("/")
        entry: dict[str, Any] = {"path": path, "text": text.rstrip() + "\n", "valid": True, "error": ""}
        # Read the file first: the shape check needs to know which keys are already
        # taken, or a card that can only fail still offers 应用.
        base = current(path) if current is not None else None
        try:
            entry["error"] = validate_structure(path, entry["text"], current_text=base)
        except DocumentError as cause:
            entry["error"] = cause.detail
        entry["valid"] = not entry["error"]
        if entry["valid"] and base:
            entry["text"] = stabilize_proposal(path, base, entry["text"])
        proposals.append(entry)
    return proposals


def _one_line(text: str, limit: int) -> str:
    """Collapse a message into the short label the manifest header carries."""
    cleaned = " ".join((text or "").split())
    return cleaned if len(cleaned) <= limit else cleaned[:limit] + "…"


def with_tool_prompt(messages: list[dict[str, str]], registry: ToolRegistry | None) -> list[dict[str, str]]:
    """Append the tool rules to the system message, or leave the turn untouched.

    The rules ride on the system turn because that is where the mode bodies live: a
    second system message would be a second place to keep the contract in sync.
    """
    if registry is None or len(registry) == 0:
        return messages
    rules = render_tool_prompt(registry)
    if not rules:
        return messages
    out = [dict(item) for item in messages]
    for item in out:
        if item.get("role") == "system":
            item["content"] = item.get("content", "") + rules
            return out
    return [{"role": "system", "content": rules.strip()}] + out


def temperature_for(mode: str) -> float:
    return 0.2 if mode == "plan" else 0.7


def _focus_text(novel: Novel, chapter: Chapter | None) -> str:
    if chapter is None:
        return f"未选中具体章节；全书目标 {novel.target_chapters or '未设定'} 章。"
    return (
        f"主人当前停在第 {chapter.chapter_number} 章"
        f"《{chapter.title or '未命名'}》，状态 {chapter.status}，"
        f"已写 {chapter.word_count} 字。"
    )


def _system_prompt(
    novel: Novel,
    mode: str,
    items: list[ContextItem],
    unknown: list[str],
    chapter: Chapter | None,
) -> str:
    unknown_note = (
        "\n\n## 未识别的 @引用\n"
        + "、".join(f"@{name}" for name in unknown)
        + "（资料里找不到，请先向主人确认，不要臆造。）"
        if unknown
        else ""
    )
    return (
        SYSTEM_HEADER.format(
            title=novel.title,
            style=novel.style_constraints or "未设置",
            focus=_focus_text(novel, chapter),
            context=render_context(items),
            unknown_note=unknown_note,
        )
        + SYSTEM_BODIES[mode]
    )


def _history_messages(session: Session, novel_id: int) -> list[dict[str, str]]:
    """Most recent window of the thread, oldest first."""
    rows = list(
        session.exec(
            select(ChatMessage)
            .where(ChatMessage.novel_id == novel_id)
            .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
            .limit(HISTORY_WINDOW)
        ).all()
    )
    return [
        {"role": row.role, "content": row.content}
        for row in reversed(rows)
        if row.role in {"user", "assistant"}
    ]


def prepare_turn(
    session: Session,
    novel: Novel,
    *,
    content: str,
    mode: str = "write",
    chapter_id: int | None = None,
    model: str | None = None,
    allowed_models: set[str] | None = None,
    context_budget: int = DEFAULT_CONTEXT_BUDGET,
    attachments: list[dict] | None = None,
) -> ChatTurn:
    """Resolve context, store the user turn, then assemble the LLM messages."""
    if mode not in MODES:
        raise ChatDomainError(f"Unsupported chat mode: {mode}")

    text = content.strip()
    if not text:
        raise ChatDomainError("Message content is empty")

    if model and allowed_models is not None and model not in allowed_models:
        raise ChatDomainError(f"Model {model} is not configured on this server")

    chapter: Chapter | None = None
    if chapter_id is not None:
        candidate = session.get(Chapter, chapter_id)
        if candidate is not None and candidate.novel_id == novel.id:
            chapter = candidate

    writing_context, unknown = build_chat_context(
        session,
        novel.id,
        text,
        chapter_id=chapter.id if chapter else None,
        budget=context_budget,
    )
    # Appended to the selected list, not to a side channel: everything downstream
    # (items, context_refs, the system prompt, the manifest the 资料 panel reads) is
    # derived from this one list.
    writing_context.selected.extend(attachment_blocks(attachments))
    items = [block.item for block in writing_context.selected]
    log_injection(
        writing_context,
        novel_id=novel.id,
        note=f"{MODE_LABEL[mode]} · 指令「{_one_line(text, 40)}」",
    )

    user_message = ChatMessage(
        novel_id=novel.id,
        role="user",
        content=text,
        mode=mode,
        model=model or "",
        mentions=mention_tokens(text),
        context_refs=[item.as_reference() for item in items],
    )
    session.add(user_message)
    session.commit()
    session.refresh(user_message)
    user_message_id = int(user_message.id)

    # The user message is already stored, so the history window ends with it;
    # no need to append the current question a second time.
    messages = [
        {
            "role": "system",
            "content": _system_prompt(novel, mode, items, unknown, chapter),
        }
    ]
    messages.extend(_history_messages(session, novel.id))

    session.commit()  # release the read txn before the stream opens its own

    return ChatTurn(
        novel_id=novel.id,
        mode=mode,
        temperature=temperature_for(mode),
        messages=messages,
        context_items=items,
        unknown_mentions=unknown,
        question=text,
        user_message_id=user_message_id,
        model=model,
        chapter_id=chapter.id if chapter else None,
        manifest=writing_context.manifest_json(),
    )


def persist_reply(
    session: Session,
    turn: ChatTurn,
    *,
    content: str,
    model: str,
    token_input: int,
    token_output: int,
    reasoning: str = "",
) -> ChatMessage:
    """Store the reply twice: message-level tokens plus aggregated run usage."""
    message = ChatMessage(
        novel_id=turn.novel_id,
        role="assistant",
        content=content,
        reasoning=reasoning,
        mode=turn.mode,
        model=model,
        context_refs=turn.references(),
        token_input=token_input,
        token_output=token_output,
    )
    session.add(message)
    session.add(
        GenerationRun(
            novel_id=turn.novel_id,
            chapter_id=turn.chapter_id,
            task_type=CHAT_TASK_TYPE,
            model=model,
            input_summary=turn.manifest
            or f"mode={turn.mode}; context={len(turn.context_items)}",
            output=content,
            token_input=token_input,
            token_output=token_output,
        )
    )
    session.commit()
    session.refresh(message)
    return message


def complete_turn(
    session: Session,
    llm: LLMClient,
    turn: ChatTurn,
    *,
    registry: ToolRegistry | None = None,
    config: AgentConfig | None = None,
) -> ChatMessage:
    """Non-streaming turn, on the same loop the stream uses."""
    try:
        outcome = run_agent_turn(
            llm,
            with_tool_prompt(turn.messages, registry),
            registry or ToolRegistry(),
            task_type=CHAT_TASK_TYPE,
            model=turn.model,
            temperature=turn.temperature,
            config=config,
        )
    except (LLMError, LLMUnavailableError) as cause:
        raise ChatDomainError(str(cause), status_code=503) from cause
    except AgentBudgetError as cause:
        raise ChatDomainError(str(cause), status_code=503) from cause

    _log_steps(outcome.steps, turn.novel_id)
    return persist_reply(
        session,
        turn,
        content=outcome.content,
        model=outcome.model,
        token_input=outcome.token_input,
        token_output=outcome.token_output,
    )


def _log_steps(steps, novel_id: int) -> None:
    """What the agent actually read, on the same debug channel as the injection list."""
    if not steps or not context_debug_enabled():
        return
    print(
        f"=== 本轮工具读取 · novel={novel_id} ===\n"
        + "\n".join(f"{step.as_line()}" for step in steps),
        flush=True,
    )


def _novel_id_of(session: Session, message_id: int) -> int | None:
    row = session.get(ChatMessage, message_id)
    return row.novel_id if row is not None else None


def stream_turn(
    llm: LLMClient,
    turn: ChatTurn,
    session_factory: Callable[[], Session] | None = None,
    *,
    registry: ToolRegistry | None = None,
    config: AgentConfig | None = None,
) -> Iterator[tuple[str, dict[str, Any]]]:
    """Yield (event, payload) for the SSE route: context / delta / tool / proposal / done."""
    factory = session_factory or (lambda: Session(engine))

    yield (
        "context",
        {
            "items": [
                {**item.as_reference(), "score": item.score}
                for item in turn.context_items
            ],
            "unknown_mentions": turn.unknown_mentions,
            "mode": turn.mode,
            "temperature": turn.temperature,
            # What this turn was allowed to reach for, so a reader can tell an
            # unused tool apart from an unimplemented one.
            "tools": registry.names() if registry else [],
        },
    )

    outcome: Any = None
    reasoning: list[str] = []
    try:
        for name, payload in stream_agent_turn(
            llm,
            with_tool_prompt(turn.messages, registry),
            registry or ToolRegistry(),
            task_type=CHAT_TASK_TYPE,
            model=turn.model,
            temperature=turn.temperature,
            config=config,
            reasoning_out=reasoning,
        ):
            if name == "delta":
                yield ("delta", {"text": payload})
            elif name == "tool":
                yield (
                    "tool",
                    {
                        "step": payload.index,
                        "name": payload.call.name,
                        "arguments": payload.call.arguments,
                        "ok": payload.result.ok,
                    },
                )
            else:
                outcome = payload
    except (LLMError, LLMUnavailableError) as cause:
        yield ("error", {"message": str(cause), "partial": ""})
        return
    except AgentBudgetError as cause:
        # Out of budget is a failure, not a short answer: nothing is persisted,
        # so a truncated turn cannot be mistaken for a finished one.
        yield ("error", {"message": str(cause), "partial": ""})
        return

    if outcome is None:
        yield ("error", {"message": "agent loop ended without an answer", "partial": ""})
        return

    _log_steps(outcome.steps, turn.novel_id)

    with factory() as session:
        novel_id = _novel_id_of(session, turn.user_message_id)
        reader = current_text_reader(session, novel_id) if novel_id else None
        for proposal in extract_proposals(outcome.content, reader):
            yield ("proposal", proposal)

    with factory() as session:
        message = persist_reply(
            session,
            turn,
            content=outcome.content,
            model=outcome.model,
            token_input=outcome.token_input,
            token_output=outcome.token_output,
            # the pieces are deltas of one stream, so they join with nothing; the
            # agent loop is what inserts a break between steps
            reasoning="".join(reasoning).strip(),
        )
    yield ("done", {"message": message.model_dump(mode="json")})
