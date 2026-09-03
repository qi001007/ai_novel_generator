import os
import json
import re
from pathlib import Path
from dataclasses import dataclass, replace
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


class LLMClient(Protocol):
    settings: LLMSettings

    def complete(self, task_type: str, system: str, user: str) -> LLMResult:
        ...

    def complete_messages(
        self,
        task_type: str,
        messages: list[dict[str, str]],
        model: str | None = None,
    ) -> LLMResult:
        ...

    def stream_messages(
        self,
        task_type: str,
        messages: list[dict[str, str]],
        temperature: float = 0.6,
        usage_out: dict[str, int] | None = None,
        model: str | None = None,
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
    ) -> LLMResult:
        resolved = self._resolve_model(task_type, model)
        response = self._client.post(
            "/chat/completions",
            json={
                "model": resolved,
                "messages": messages,
                "temperature": 0.8 if task_type == "draft" else 0.2,
            },
        )
        if response.status_code >= 400:
            raise LLMError(f"LLM request failed with status {response.status_code}")

        data = response.json()
        try:
            content = data["choices"][0]["message"]["content"]
            usage = data.get("usage", {})
        except (KeyError, IndexError, TypeError) as cause:
            raise LLMError("LLM response has an unexpected shape") from cause

        return LLMResult(
            content=content,
            model=resolved,
            token_input=int(usage.get("prompt_tokens", 0)),
            token_output=int(usage.get("completion_tokens", 0)),
            cost_estimate=0.0,
        )

    def stream_messages(
        self,
        task_type: str,
        messages: list[dict[str, str]],
        temperature: float = 0.6,
        usage_out: dict[str, int] | None = None,
        model: str | None = None,
    ) -> Iterator[str]:
        resolved = self._resolve_model(task_type, model)
        with self._client.stream(
            "POST",
            "/chat/completions",
            json={
                "model": resolved,
                "messages": messages,
                "temperature": temperature,
                "stream": True,
                # SCNet returns a trailing usage event only when asked for it.
                "stream_options": {"include_usage": True},
            },
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
}


def stored_overrides(session: Session) -> dict[str, str]:
    return {row.key: row.value for row in session.exec(select(AppConfig)).all()}


def resolve_settings(session: Session) -> LLMSettings:
    """backend/.env seeds the first run; saved rows win from then on."""
    settings = LLMSettings.from_env()
    rows = stored_overrides(session)
    if not rows:
        return settings

    updates: dict[str, Any] = {}
    if "llm.provider" in rows:
        updates["provider"] = rows["llm.provider"]
    if "llm.api_base_url" in rows:
        updates["api_base_url"] = rows["llm.api_base_url"].rstrip("/")
    if "llm.api_key" in rows:
        updates["api_key"] = rows["llm.api_key"] or None
    if rows.get("llm.timeout"):
        try:
            updates["timeout"] = float(rows["llm.timeout"])
        except ValueError:
            pass  # validated on write; a hand-edited row must not brick generation
    models = dict(settings.models)
    touched = False
    for task, key in MODEL_KEYS.items():
        if key in rows:
            models[task] = rows[key]
            touched = True
    if touched:
        updates["models"] = models
    return replace(settings, **updates) if updates else settings


def get_llm_client(session: Session = Depends(get_session)) -> LLMClient:
    return OpenAICompatibleClient(resolve_settings(session))


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
