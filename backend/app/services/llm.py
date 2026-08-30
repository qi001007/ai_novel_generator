import os
import json
import re
from dataclasses import dataclass
from typing import Any, Protocol

import httpx


class LLMError(RuntimeError):
    pass


class LLMUnavailableError(LLMError):
    pass


@dataclass(frozen=True)
class LLMSettings:
    api_base_url: str
    api_key: str | None
    timeout: float
    models: dict[str, str]

    @classmethod
    def from_env(cls) -> "LLMSettings":
        return cls(
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
            },
        )

    @property
    def is_configured(self) -> bool:
        return bool(self.api_key and self.api_base_url)


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

        model = self.settings.models.get(task_type, "").strip()
        if not model:
            raise LLMUnavailableError(f"LLM model for {task_type} is not configured")

        response = self._client.post(
            "/chat/completions",
            json={
                "model": model,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
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
            model=model,
            token_input=int(usage.get("prompt_tokens", 0)),
            token_output=int(usage.get("completion_tokens", 0)),
            cost_estimate=0.0,
        )


def get_llm_client() -> LLMClient:
    return OpenAICompatibleClient(LLMSettings.from_env())


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
