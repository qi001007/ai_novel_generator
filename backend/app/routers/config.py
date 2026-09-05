"""Read and write the LLM connection settings the workbench exposes in /settings."""
import json

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel

from app.db import get_session
from app.models import AppConfig, utc_now
from app.services.llm import (
    DEFAULT_PROVIDER_ID,
    MODEL_KEYS,
    PROVIDERS_KEY,
    ROUTE_PREFIX,
    TASKS,
    resolve_routing,
)

router = APIRouter(prefix="/config", tags=["config"])

# What the UI shows instead of a secret. Echoing this back means "leave it alone".
MASK = "****"


def _store(session: Session, key: str, value: str) -> None:
    row = session.get(AppConfig, key)
    if row is None:
        row = AppConfig(key=key, value=value)
    else:
        row.value = value
    row.updated_at = utc_now()
    session.add(row)


def _mask(key: str | None) -> str:
    if not key:
        return ""
    return MASK + key[-4:] if len(key) > 4 else MASK


class LlmProviderOut(SQLModel):
    id: str
    name: str
    provider: str
    api_base_url: str
    api_key_masked: str
    api_key_set: bool
    # The default row is the one the legacy single-provider keys describe; it is always
    # present and is edited through the flat fields below, so an installation that never
    # opens the new UI keeps working untouched.
    is_default: bool = False


class LlmProviderIn(SQLModel):
    id: str
    name: str | None = None
    provider: str = "openai_compatible"
    api_base_url: str = ""
    api_key: str | None = None
    timeout: float | None = None


class LlmConfigOut(SQLModel):
    provider: str
    api_base_url: str
    timeout: float
    models: dict[str, str]
    api_key_masked: str
    api_key_set: bool
    configured: bool
    providers: list[LlmProviderOut]
    routes: dict[str, str]
    tasks: list[str]


class LlmConfigIn(SQLModel):
    provider: str | None = None
    api_base_url: str | None = None
    api_key: str | None = None
    timeout: float | None = None
    models: dict[str, str] | None = None
    providers: list[LlmProviderIn] | None = None
    routes: dict[str, str] | None = None


class LlmTestIn(SQLModel):
    provider_id: str | None = None


class LlmTestResult(SQLModel):
    ok: bool
    detail: str


def _provider_out(item, providers: list) -> LlmProviderOut:
    return LlmProviderOut(
        id=item.id,
        name=item.name,
        provider=item.provider,
        api_base_url=item.api_base_url,
        api_key_masked=_mask(item.api_key),
        api_key_set=bool(item.api_key),
        is_default=item.id == DEFAULT_PROVIDER_ID,
    )


@router.get("/llm", response_model=LlmConfigOut)
def read_llm_config(session: Session = Depends(get_session)) -> LlmConfigOut:
    routing = resolve_routing(session)
    settings = routing.global_settings()
    return LlmConfigOut(
        provider=settings.provider,
        api_base_url=settings.api_base_url,
        timeout=settings.timeout,
        models=dict(settings.models),
        api_key_masked=_mask(settings.api_key),
        api_key_set=bool(settings.api_key),
        configured=settings.is_configured,
        providers=[_provider_out(item, routing.providers) for item in routing.providers],
        routes=dict(routing.routes),
        tasks=list(TASKS),
    )


@router.put("/llm", response_model=LlmConfigOut)
def write_llm_config(
    payload: LlmConfigIn,
    session: Session = Depends(get_session),
) -> LlmConfigOut:
    if payload.api_base_url is not None:
        url = payload.api_base_url.strip()
        if url and not url.startswith(("http://", "https://")):
            raise HTTPException(status_code=422, detail="Base URL 必须以 http:// 或 https:// 开头")
        _store(session, "llm.api_base_url", url.rstrip("/"))
    if payload.provider is not None:
        _store(session, "llm.provider", payload.provider.strip())
    if payload.timeout is not None:
        if not 1 <= payload.timeout <= 600:
            raise HTTPException(status_code=422, detail="超时需在 1 到 600 秒之间")
        _store(session, "llm.timeout", str(payload.timeout))
    if payload.api_key is not None:
        # The UI only ever holds a mask, so a masked echo must not overwrite the real key.
        incoming = payload.api_key.strip()
        if incoming and not incoming.startswith(MASK):
            _store(session, "llm.api_key", incoming)
    for task, key in MODEL_KEYS.items():
        value = (payload.models or {}).get(task)
        if value is not None:
            _store(session, key, value.strip())
    if payload.providers is not None:
        _store(session, PROVIDERS_KEY, _validate_providers(payload.providers, session))
    if payload.routes is not None:
        _write_routes(session, payload.routes)
    session.commit()
    return read_llm_config(session)


def _validate_providers(items: list[LlmProviderIn], session: Session) -> str:
    """Store the non-default providers as one JSON row.

    The default provider is deliberately not in here - it is the legacy
    `llm.provider / api_base_url / api_key / timeout` quartet, so the two never fight
    over the same secret.
    """
    seen: set[str] = set()
    stored: list[dict[str, object]] = []
    for item in items:
        pid = item.id.strip()
        if not pid:
            raise HTTPException(status_code=422, detail="供应商缺少 id")
        if pid == DEFAULT_PROVIDER_ID:
            continue
        if pid in seen:
            raise HTTPException(status_code=422, detail=f"供应商 id 重复：{pid}")
        seen.add(pid)
        url = item.api_base_url.strip().rstrip("/")
        if url and not url.startswith(("http://", "https://")):
            raise HTTPException(
                status_code=422, detail=f"供应商「{item.name or pid}」的 Base URL 必须以 http:// 或 https:// 开头"
            )
        if item.timeout is not None and not 1 <= item.timeout <= 600:
            raise HTTPException(status_code=422, detail=f"供应商「{item.name or pid}」超时需在 1 到 600 秒之间")
        existing = next((row for row in resolve_routing(session).providers if row.id == pid), None)
        api_key = (item.api_key or "").strip()
        if not api_key or api_key.startswith(MASK):
            # same echo-the-mask rule as the flat field: a masked value means "keep it"
            api_key = existing.api_key if existing else ""
        if item.timeout is None:
            timeout = existing.timeout if existing else 120.0
        else:
            timeout = float(item.timeout)
        stored.append(
            {
                "id": pid,
                "name": (item.name or "").strip() or pid,
                "provider": item.provider.strip() or "openai_compatible",
                "api_base_url": url or (existing.api_base_url if existing else ""),
                "api_key": api_key,
                "timeout": timeout,
            }
        )
    return json.dumps(stored, ensure_ascii=False)


def _write_routes(session: Session, routes: dict[str, str]) -> None:
    known = {item.id for item in resolve_routing(session).providers}
    for task, provider_id in routes.items():
        if task not in TASKS:
            raise HTTPException(status_code=422, detail=f"没有这个任务：{task}")
        pid = (provider_id or DEFAULT_PROVIDER_ID).strip() or DEFAULT_PROVIDER_ID
        if pid not in known:
            raise HTTPException(status_code=422, detail=f"「{task}」指向的供应商不存在：{pid}")
        _store(session, ROUTE_PREFIX + task, pid)


@router.post("/llm/test", response_model=LlmTestResult)
def test_llm_config(
    payload: LlmTestIn | None = None,
    session: Session = Depends(get_session),
) -> LlmTestResult:
    """Check one gateway answers without spending a single token.

    Hits GET /models, which every OpenAI-compatible gateway serves, instead of running a
    completion: a connection test that bills the owner is not a connection test.

    With several providers saved, "is it working" is a question about a specific one, so
    the body may name it; no body still means the default provider, which is what the
    page did before providers became a list.
    """
    routing = resolve_routing(session)
    provider_id = (payload.provider_id if payload else None) or DEFAULT_PROVIDER_ID
    item = next((row for row in routing.providers if row.id == provider_id), None)
    if item is None:
        return LlmTestResult(ok=False, detail=f"没有这个供应商：{provider_id}")
    if not item.api_base_url or not item.api_key:
        return LlmTestResult(ok=False, detail=f"供应商「{item.name}」缺少 Base URL 或 API Key，无法测试")
    try:
        response = httpx.get(
            item.api_base_url.rstrip("/") + "/models",
            headers={"Authorization": "Bearer " + item.api_key},
            timeout=15.0,
        )
    except httpx.HTTPError as cause:
        return LlmTestResult(ok=False, detail=f"「{item.name}」连不上：" + type(cause).__name__)
    if response.status_code >= 400:
        return LlmTestResult(ok=False, detail=f"「{item.name}」网关返回 HTTP {response.status_code}")
    return LlmTestResult(ok=True, detail=f"「{item.name}」连接正常（HTTP {response.status_code}）")
