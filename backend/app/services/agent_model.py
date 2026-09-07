"""The gateway dialect as a Pydantic AI model.

This adapter owns the scnet/MiniMax wire quirks. The agent loop stays framework
owned; OpenAICompatibleClient remains the only HTTP client for model calls.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from pydantic_ai import ModelResponse, ToolCallPart, TextPart
from pydantic_ai.messages import ModelMessage, ModelRequest, ModelResponseStreamEvent
from pydantic_ai.models import Model, ModelRequestParameters, StreamedResponse
from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import RequestUsage

from app.services.agent import (
    ToolCall,
    parse_call_blocks,
    parse_native_calls,
    releasable_len,
)


def _content_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if value is None:
        return ""
    if isinstance(value, dict):
        import json

        return json.dumps(value, ensure_ascii=False)
    return "\n".join(str(item) for item in value)


def to_wire_messages(messages: list[ModelMessage]) -> list[dict[str, str]]:
    """Translate framework history into the same flat messages legacy sends.

    Tool calls are deliberately omitted: the old loop stripped its own control
    markers from history and fed results back as labelled user turns. This gateway
    does not keep OpenAI tool-call ids across rounds, so preserving that shape is
    also the compatibility surface.
    """
    wire: list[dict[str, str]] = []
    for message in messages:
        if isinstance(message, dict):
            wire.append({"role": str(message.get("role")), "content": str(message.get("content", ""))})
            continue
        if isinstance(message, ModelResponse):
            text = " ".join(
                part.content for part in message.parts if isinstance(part, TextPart)
            ).strip()
            wire.append({"role": "assistant", "content": text})
            continue

        assert isinstance(message, ModelRequest)
        for part in message.parts:
            kind = getattr(part, "part_kind", "")
            if kind == "system":
                wire.append({"role": "system", "content": part.content})
            elif kind in {"user-prompt", "instruction"}:
                wire.append({"role": "user", "content": _content_text(getattr(part, "content", ""))})
            elif kind == "tool-return":
                state = "结果" if part.outcome == "success" else "未成功"
                content = _content_text(part.content)
                wire.append(
                    {
                        "role": "user",
                        "content": f"【工具 {part.tool_name}{state}】\n{content}",
                    }
                )
            elif kind == "retry-prompt":
                wire.append(
                    {
                        "role": "user",
                        "content": f"【工具 {getattr(part, 'tool_name', '') or 'unknown'} 未成功】\n"
                        f"{_content_text(part.content)}",
                    }
                )
    return wire


def _tool_specs(model_request_parameters: ModelRequestParameters) -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters_json_schema,
            },
        }
        for tool in model_request_parameters.declared_function_tools
    ]


def _response_parts(content: str, raw_message: dict[str, Any]) -> tuple[list[TextPart | ToolCallPart], list[ToolCall]]:
    visible, calls = parse_call_blocks(content)
    calls.extend(parse_native_calls({"tool_calls": raw_message}))
    parts: list[TextPart | ToolCallPart] = []
    visible = visible.strip()
    if visible:
        parts.append(TextPart(visible))
    for index, call in enumerate(calls):
        parts.append(
            ToolCallPart(
                call.name,
                args=call.arguments,
                tool_call_id=f"gateway-call-{index}",
            )
        )
    return parts, calls


@dataclass
class GatewayStreamedResponse(StreamedResponse):
    """A real framework stream, fed by the existing SSE-aware HTTP client."""

    llm: Any
    task_type: str
    messages: list[ModelMessage]
    model_settings: ModelSettings | None
    model_request_parameters: ModelRequestParameters
    model_name_value: str
    temperature: float

    async def _get_event_iterator(self) -> AsyncIterator[ModelResponseStreamEvent]:
        usage: dict[str, Any] = {}
        native: list[dict[str, Any]] = []
        content = ""
        released = 0
        block_found = False
        chunks = self.llm.stream_messages(
            self.task_type,
            to_wire_messages(self.messages),
            temperature=self.temperature,
            usage_out=usage,
            model=self.model_name_value or None,
            tools=_tool_specs(self.model_request_parameters),
            channels=True,
            tool_calls_out=native,
        )
        for kind, chunk in chunks:
            if kind == "reasoning":
                for event in self._parts_manager.handle_thinking_delta(
                    vendor_part_id="gateway-thinking", content=chunk
                ):
                    yield event
            elif kind == "content":
                content += chunk
                visible, found = parse_call_blocks(content)
                if found:
                    block_found = True
                    continue
                safe = releasable_len(visible)
                if safe > released:
                    delta = visible[released:safe]
                    released = safe
                    if delta:
                        for event in self._parts_manager.handle_text_delta(
                            vendor_part_id="gateway-text", content=delta
                        ):
                            yield event

        calls: list[ToolCall] = parse_native_calls({"tool_calls": native})
        if not calls:
            visible, found = parse_call_blocks(content)
            calls = found
        if not block_found:
            visible, _ = parse_call_blocks(content)
            if len(visible) > released:
                delta = visible[released:]
                released = len(visible)
                if delta:
                    for event in self._parts_manager.handle_text_delta(
                        vendor_part_id="gateway-text", content=delta
                    ):
                        yield event
        for index, call in enumerate(calls):
            yield self._parts_manager.handle_tool_call_part(
                vendor_part_id=f"gateway-call-{index}",
                tool_name=call.name,
                args=call.arguments,
                tool_call_id=f"gateway-stream-call-{index}",
            )
        self._usage = RequestUsage(
            input_tokens=int(usage.get("token_input", 0)),
            output_tokens=int(usage.get("token_output", 0)),
        )
        self.finish_reason = "tool_call" if calls else "stop"

    @property
    def model_name(self) -> str:
        return self.model_name_value

    @property
    def provider_name(self) -> str:
        return "openai-compatible"

    @property
    def provider_url(self) -> str | None:
        settings = getattr(self.llm, "settings", None)
        return str(getattr(settings, "api_base_url", "") or "") or None

    @property
    def timestamp(self) -> datetime:
        return datetime.now(timezone.utc)

    async def close_stream(self) -> None:
        return None


class GatewayChatModel(Model):
    """Wrap OpenAICompatibleClient without replacing its provider routing."""

    def __init__(self, llm: Any, *, task_type: str = "chat") -> None:
        self.llm = llm
        self.task_type = task_type
        # The adapter itself emits ThinkingPart deltas; without this profile the
        # framework treats the bridge as a non-thinking model.
        super().__init__(profile={"supports_thinking": True})

    @property
    def model_name(self) -> str:
        settings = getattr(self.llm, "settings", None)
        return str(getattr(settings, "models", {}).get(self.task_type, "") or "gateway")

    @property
    def system(self) -> str:
        return "openai-compatible"

    async def request(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
    ) -> ModelResponse:
        model_settings, model_request_parameters = self.prepare_request(
            model_settings, model_request_parameters
        )
        settings = model_settings or {}
        answer = self.llm.complete_messages(
            self.task_type,
            to_wire_messages(messages),
            model=self.model_name or None,
            tools=_tool_specs(model_request_parameters),
            temperature=float(settings.get("temperature", 0.2)),
        )
        parts, calls = _response_parts(answer.content, answer.raw_message)
        return ModelResponse(
            parts,
            usage=RequestUsage(
                input_tokens=answer.token_input,
                output_tokens=answer.token_output,
            ),
            model_name=answer.model or self.model_name,
            provider_name=self.system,
            provider_url=getattr(getattr(self.llm, "settings", None), "api_base_url", None),
            finish_reason="tool_call" if calls else "stop",
        )

    @asynccontextmanager
    async def request_stream(
        self,
        messages: list[ModelMessage],
        model_settings: ModelSettings | None,
        model_request_parameters: ModelRequestParameters,
        _run_context: Any = None,
    ):
        model_settings, model_request_parameters = self.prepare_request(
            model_settings, model_request_parameters
        )
        yield GatewayStreamedResponse(
            llm=self.llm,
            task_type=self.task_type,
            messages=messages,
            model_settings=model_settings,
            model_request_parameters=model_request_parameters,
            model_name_value=self.model_name,
            temperature=float((model_settings or {}).get("temperature", 0.2)),
        )
