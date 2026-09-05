import os
import json
import re
from pathlib import Path
from dataclasses import dataclass, field, replace
from collections.abc import Iterator
from typing import Any, Protocol

import httpx
from dotenv import load_dotenv
from fastapi import Depends
from sqlmodel import Session, select

from app.db import get_session
from app.models import AppConfig


class LLMError(RuntimeError):
    pass


DOTENV_PATH = Path(__file__).resolve().parents[2] / ".env"


class LLMUnavailableError(LLMError):
    pass


@dataclass(frozen=True)
class LLMSettings:
    provider: str
    api_base_url: str
    api_key: str | None
    timeout: float
    models: dict[str, str]

    @classmethod
    def from_env(cls) -> "LLMSettings":
        load_dotenv(DOTENV_PATH)
        return cls(
            provider=os.getenv("NOVEL_LLM_PROVIDER", "openai_compatible"),
            api_base_url=os.getenv(
                "NOVEL_LLM_API_BASE_URL",
                "https://api.openai.com/v1",
            ).rstrip("/"),
            api_key=os.getenv("NOVEL_LLM_API_KEY"),
            timeout=float(os.getenv("NOVEL_LLM_TIMEOUT", "120")),
            models={
                "draft": os.getenv("NOVEL_LLM_DRAFT_MODEL", ""),
                "review": os.getenv("NOVEL_LLM_REVIEW_MODEL", ""),
                "summary": os.getenv("NOVEL_LLM_SUMMARY_MODEL", ""),
                "chat": os.getenv("NOVEL_LLM_CHAT_MODEL", ""),
            },
        )

    @property
    def is_configured(self) -> bool:
        return bool(
            self.api_key
            and self.api_base_url
            and any(model.strip() for model in self.models.values())
        )

    @property
    def configured_models(self) -> set[str]:
        """Distinct model names this deployment lets a client pick."""
        return {model.strip() for model in self.models.values() if model.strip()}


@dataclass(frozen=True)
class LLMResult:
    content: str
    model: str
    token_input: int
    token_output: int
    cost_estimate: float
    # The message object as it arrived. The agent loop reads `tool_calls` off it for
    # gateways that do have that channel; nothing else is allowed to depend on it.
    raw_message: dict[str, Any] = field(default_factory=dict)


class LLMClient(Protocol):
    settings: LLMSettings

    def complete(self, task_type: str, system: str, user: str) -> LLMResult:
        ...

    def complete_messages(
        self,
        task_type: str,
        messages: list[dict[str, str]],
        model: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        temperature: float | None = None,
    ) -> LLMResult:
        ...

    def stream_messages(
        self,
        task_type: str,
        messages: list[dict[str, str]],
        temperature: float = 0.6,
        usage_out: dict[str, int] | None = None,
        model: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        reasoning_out: list[str] | None = None,
    ) -> Iterator[str]:
        ...


class OpenAICompatibleClient:
    def __init__(
        self,
        settings: LLMSettings,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.settings = settings
        self._client = httpx.Client(
            base_url=settings.api_base_url,
            headers={
                "Authorization": f"Bearer {settings.api_key}",
                "Content-Type": "application/json",
            },
            timeout=settings.timeout,
            transport=transport,
        )

    def complete(self, task_type: str, system: str, user: str) -> LLMResult:
        if not self.settings.is_configured:
            raise LLMUnavailableError("LLM API key is not configured")

        return self.complete_messages(
            task_type,
            [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )

    def complete_messages(
        self,
        task_type: str,
        messages: list[dict[str, str]],
        model: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        temperature: float | None = None,
    ) -> LLMResult:
        resolved = self._resolve_model(task_type, model)
        payload: dict[str, Any] = {
            "model": resolved,
            "messages": messages,
            "temperature": temperature
            if temperature is not None
            else (0.8 if task_type == "draft" else 0.2),
        }
        # Sent when a gateway has the channel; the agent loop does not rely on the
        # answer arriving this way, because this deployment does not use it.
        if tools:
            payload["tools"] = tools
        response = self._client.post("/chat/completions", json=payload)
        if response.status_code >= 400:
            raise LLMError(f"LLM request failed with status {response.status_code}")

        data = response.json()
        try:
            message = data["choices"][0]["message"]
            content = message.get("content")
            usage = data.get("usage", {})
        except (KeyError, IndexError, TypeError, AttributeError) as cause:
            raise LLMError("LLM response has an unexpected shape") from cause

        return LLMResult(
            # A reply that is only a tool call can carry no text at all.
            content=content if isinstance(content, str) else "",
            model=resolved,
            token_input=int(usage.get("prompt_tokens", 0)),
            token_output=int(usage.get("completion_tokens", 0)),
            cost_estimate=0.0,
            raw_message=message if isinstance(message, dict) else {},
        )

    def stream_messages(
        self,
        task_type: str,
        messages: list[dict[str, str]],
        temperature: float = 0.6,
        usage_out: dict[str, int] | None = None,
        model: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        reasoning_out: list[str] | None = None,
    ) -> Iterator[str]:
        resolved = self._resolve_model(task_type, model)
        payload: dict[str, Any] = {
            "model": resolved,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
            # SCNet returns a trailing usage event only when asked for it.
            "stream_options": {"include_usage": True},
        }
        if tools:
            payload["tools"] = tools
        with self._client.stream(
            "POST",
            "/chat/completions",
            json=payload,
        ) as response:
            if response.status_code >= 400:
                response.read()
                raise LLMError(
                    f"LLM stream failed with status {response.status_code}"
                )
            for event in _iter_sse_events(response.iter_lines()):
                usage = event.get("usage")
                if isinstance(usage, dict) and usage_out is not None:
                    usage_out["model"] = resolved
                    usage_out["token_input"] = int(usage.get("prompt_tokens", 0))
                    usage_out["token_output"] = int(usage.get("completion_tokens", 0))

                choices = event.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                content = delta.get("content")
                if isinstance(content, str) and content:
                    yield content
                # A reasoning stream is a second channel of the same response, not an
                # answer: it is collected for the record and never yielded as prose.
                # Both spellings exist across OpenAI-compatible gateways, and the one
                # this deployment runs (MiniMax) uses the first.
                if reasoning_out is not None:
                    thought = delta.get("reasoning_content") or delta.get("reasoning")
                    if isinstance(thought, str) and thought:
                        reasoning_out.append(thought)

    def _resolve_model(self, task_type: str, model: str | None = None) -> str:
        if not self.settings.is_configured:
            raise LLMUnavailableError("LLM API key is not configured")

        if model and model.strip():
            return model.strip()

        model = self.settings.models.get(task_type, "").strip()
        if not model:
            raise LLMUnavailableError(f"LLM model for {task_type} is not configured")
        return model


def _iter_sse_events(lines: Iterator[str]) -> Iterator[dict[str, Any]]:
    """Yield decoded JSON events from an OpenAI-compatible SSE body."""
    for line in lines:
        if not line.startswith("data:"):
            continue

        payload = line[len("data:"):].strip()
        if not payload or payload == "[DONE]":
            continue

        try:
            event = json.loads(payload)
        except ValueError:
            continue

        if isinstance(event, dict):
            yield event


# Stored keys double as the contract between /api/config/llm and this resolver.
MODEL_KEYS = {
    "draft": "llm.model.draft",
    "review": "llm.model.review",
    "summary": "llm.model.summary",
    "chat": "llm.model.chat",
    # 第十九批批注 2: the image slot is reserved with the same shape as the rest, so
    # wiring a real gateway later is a route + a model name, not a new code path.
    "image": "llm.model.image",
}

# 第十九批批注 2: 「我现在可能会同时保存不同的供应商」. A task used to be able to name a
# model but only ever against ONE gateway, so "draft from A, review from B" could not be
# expressed at all. Providers became a list, and each task points at one of them.
PROVIDERS_KEY = "llm.providers"
ROUTE_PREFIX = "llm.route."
DEFAULT_PROVIDER_ID = "default"
TASKS = ("draft", "review", "summary", "chat", "image")


@dataclass(frozen=True)
class LLMProvider:
    id: str
    name: str
    provider: str
    api_base_url: str
    api_key: str | None
    timeout: float


@dataclass(frozen=True)
class LLMRouting:
    """Everything one deployment knows about which gateway answers which task."""

    providers: list[LLMProvider]
    routes: dict[str, str]
    models: dict[str, str]

    def provider_id_for(self, task: str) -> str:
        return self.routes.get(task, DEFAULT_PROVIDER_ID)

    def provider_for(self, task: str) -> LLMProvider:
        wanted = self.provider_id_for(task)
        for item in self.providers:
            if item.id == wanted:
                return item
        return self.providers[0]

    def settings_for(self, task: str) -> LLMSettings:
        item = self.provider_for(task)
        return LLMSettings(
            provider=item.provider,
            api_base_url=item.api_base_url,
            api_key=item.api_key,
            timeout=item.timeout,
            models=dict(self.models),
        )

    def settings_of(self, provider_id: str) -> LLMSettings:
        item = next((row for row in self.providers if row.id == provider_id), self.providers[0])
        return LLMSettings(
            provider=item.provider,
            api_base_url=item.api_base_url,
            api_key=item.api_key,
            timeout=item.timeout,
            models=dict(self.models),
        )

    def global_settings(self) -> LLMSettings:
        """The pre-multi-provider view: the default provider plus every model name.

        /api/llm/status, the configured check and `allowed_models` all read this, so
        adding providers does not change what an existing caller sees.
        """
        return self.settings_of(DEFAULT_PROVIDER_ID)


def _providers_from_rows(rows: dict[str, str], fallback: LLMProvider) -> list[LLMProvider]:
    raw = rows.get(PROVIDERS_KEY)
    providers = [fallback]
    if not raw:
        return providers
    try:
        data = json.loads(raw)
    except ValueError:
        return providers  # a hand-edited row must not brick generation
    if not isinstance(data, list):
        return providers
    for index, item in enumerate(data):
        if not isinstance(item, dict):
            continue
        pid = str(item.get("id") or "").strip()
        if not pid or pid == DEFAULT_PROVIDER_ID:
            continue  # the fallback row is built from the legacy keys, never from here
        providers.append(
            LLMProvider(
                id=pid,
                name=str(item.get("name") or pid).strip() or pid,
                provider=str(item.get("provider") or "openai_compatible"),
                api_base_url=str(item.get("api_base_url") or "").rstrip("/"),
                api_key=str(item.get("api_key") or "") or None,
                timeout=float(item.get("timeout") or fallback.timeout),
            )
        )
        del index
    return providers


def resolve_routing(session: Session) -> LLMRouting:
    """Legacy keys stay authoritative for the default provider.

    Nothing is rewritten on read: an installation that never touched the new UI keeps
    answering exactly as it did before, with one provider named 默认 synthesised from
    `llm.provider / llm.api_base_url / llm.api_key / llm.timeout` (or backend/.env).
    """
    env = LLMSettings.from_env()
    rows = stored_overrides(session)

    def pick(key: str, current: str) -> str:
        return rows[key] if key in rows else current

    base = pick("llm.api_base_url", env.api_base_url).rstrip("/")
    timeout_raw = rows.get("llm.timeout")
    try:
        timeout = float(timeout_raw) if timeout_raw else env.timeout
    except ValueError:
        timeout = env.timeout
    key_value = rows["llm.api_key"] if "llm.api_key" in rows else (env.api_key or "")

    fallback = LLMProvider(
        id=DEFAULT_PROVIDER_ID,
        name="默认",
        provider=pick("llm.provider", env.provider),
        api_base_url=base,
        api_key=key_value or None,
        timeout=timeout,
    )
    models = dict(env.models)
    for task, key in MODEL_KEYS.items():
        if key in rows:
            models[task] = rows[key]
    routes = {task: rows.get(ROUTE_PREFIX + task, DEFAULT_PROVIDER_ID) for task in TASKS}
    return LLMRouting(
        providers=_providers_from_rows(rows, fallback),
        routes=routes,
        models={task: models.get(task, "") for task in TASKS},
    )


def stored_overrides(session: Session) -> dict[str, str]:
    return {row.key: row.value for row in session.exec(select(AppConfig)).all()}


def resolve_settings(session: Session, task: str | None = None) -> LLMSettings:
    """backend/.env seeds the first run; saved rows win from then on.

    With a `task`, the answer is that task's provider (第十九批批注 2). Without one it is
    the default provider - which is exactly what it meant before providers became a list,
    so every existing caller keeps its behaviour.
    """
    routing = resolve_routing(session)
    return routing.settings_for(task) if task else routing.global_settings()


class RoutedLLMClient:
    """One dependency, one gateway per provider, and the task decides who answers.

    `get_llm_client` stays the single FastAPI dependency and `LLMClient` stays the single
    protocol, so draft / review / summary / chat call sites and every test fake that
    overrides the dependency are untouched. Only the object behind the dependency got
    smarter.
    """

    def __init__(self, routing: LLMRouting) -> None:
        self.routing = routing
        self.settings = routing.global_settings()
        # Built eagerly: the request session closes when the response ends, and a stream
        # must not go looking for a provider it did not already have.
        self._clients = {
            item.id: OpenAICompatibleClient(routing.settings_of(item.id))
            for item in routing.providers
        }

    def _for(self, task_type: str) -> "OpenAICompatibleClient":
        return self._clients[self.routing.provider_id_for(task_type)]

    def complete(self, task_type: str, system: str, user: str) -> LLMResult:
        return self._for(task_type).complete(task_type, system, user)

    def complete_messages(
        self,
        task_type: str,
        messages: list[dict[str, str]],
        model: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        temperature: float | None = None,
    ) -> LLMResult:
        return self._for(task_type).complete_messages(
            task_type, messages, model=model, tools=tools, temperature=temperature
        )

    def stream_messages(
        self,
        task_type: str,
        messages: list[dict[str, str]],
        temperature: float = 0.6,
        usage_out: dict[str, int] | None = None,
        model: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        reasoning_out: list[str] | None = None,
    ):
        return self._for(task_type).stream_messages(
            task_type,
            messages,
            temperature=temperature,
            usage_out=usage_out,
            model=model,
            tools=tools,
            reasoning_out=reasoning_out,
        )


def get_llm_client(session: Session = Depends(get_session)) -> LLMClient:
    return RoutedLLMClient(resolve_routing(session))





def parse_json_object(content: str) -> dict[str, Any]:
    stripped = content.strip()
    if stripped.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*|\s*```$", "", stripped, flags=re.I)

    try:
        value = json.loads(stripped)
    except ValueError:
        match = re.search(r"\{.*\}", content, flags=re.S)
        if match is None:
            raise LLMError("LLM did not return a JSON object")
        value = json.loads(match.group(0))

    if not isinstance(value, dict):
        raise LLMError("LLM JSON response is not an object")
    return value
