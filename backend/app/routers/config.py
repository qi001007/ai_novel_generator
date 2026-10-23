"""Read and write the LLM connection settings the workbench exposes in /settings."""
import json
import os
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel

from app.db import get_session
from app.models import AppConfig, utc_now
from app.services.agent import (
    DEFAULT_MAX_STEPS,
    DEFAULT_MAX_TOKENS,
    MAX_STEPS_KEY,
    MAX_STEPS_LIMITS,
    MAX_TOKENS_KEY,
    MAX_TOKENS_LIMITS,
    resolve_config,
)
from app.services.llm import (
    DEFAULT_PROVIDER_ID,
    LLMProvider,
    MODEL_KEYS,
    PROVIDERS_KEY,
    ROUTE_PREFIX,
    TASKS,
    resolve_routing,
)

router = APIRouter(prefix="/config", tags=["config"])

# What the UI shows instead of a secret. Echoing this back means "leave it alone".
MASK = "****"
MODEL_CATALOGS_KEY = "llm.model_catalogs"


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


class AgentBudgetOut(SQLModel):
    max_steps: int
    max_tokens: int
    # The page shows what a turn costs by default next to the owner's number, so an
    # edited value never looks like the only possible one.
    default_max_steps: int
    default_max_tokens: int


class AgentBudgetIn(SQLModel):
    max_steps: int | None = None
    max_tokens: int | None = None


class CachedModelCatalog(SQLModel):
    models: list[str]
    fetched_at: str


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
    agent: AgentBudgetOut
    catalogs: dict[str, CachedModelCatalog]


class LlmConfigIn(SQLModel):
    provider: str | None = None
    api_base_url: str | None = None
    api_key: str | None = None
    timeout: float | None = None
    models: dict[str, str] | None = None
    providers: list[LlmProviderIn] | None = None
    routes: dict[str, str] | None = None
    agent: AgentBudgetIn | None = None


class LlmTestIn(SQLModel):
    provider_id: str | None = None
    api_base_url: str | None = None
    api_key: str | None = None
    timeout: float | None = None


class LlmTestResult(SQLModel):
    ok: bool
    detail: str


class LlmModelsOut(SQLModel):
    provider_id: str
    models: list[str]
    detail: str
    fetched_at: str


def _catalogs(session: Session) -> dict[str, CachedModelCatalog]:
    row = session.get(AppConfig, MODEL_CATALOGS_KEY)
    if row is None:
        return {}
    try:
        raw = json.loads(row.value)
        return {
            str(provider_id): CachedModelCatalog.model_validate(value)
            for provider_id, value in raw.items()
            if isinstance(value, dict)
        }
    except (ValueError, TypeError):
        return {}


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


def _models_response(item) -> httpx.Response:
    """Read the provider catalog without running a billable completion."""
    scheme = urlparse(item.api_base_url).scheme.lower()
    proxy = os.environ.get("HTTPS_PROXY" if scheme == "https" else "HTTP_PROXY")
    if proxy and urlparse(proxy).scheme not in {"http", "https"}:
        proxy = None
    with httpx.Client(proxy=proxy, trust_env=False, timeout=item.timeout) as client:
        return client.get(
            item.api_base_url.rstrip("/") + "/models",
            headers={"Authorization": "Bearer " + item.api_key},
        )


def _model_ids(response: httpx.Response) -> list[str]:
    try:
        rows = response.json().get("data", [])
    except (ValueError, AttributeError):
        return []
    if not isinstance(rows, list):
        return []
    return sorted(
        {
            row["id"].strip()
            for row in rows
            if isinstance(row, dict) and isinstance(row.get("id"), str) and row["id"].strip()
        }
    )


def _connection_preview(session: Session, payload: LlmTestIn) -> LLMProvider:
    """Merge a form draft with stored credentials without saving the draft."""
    pid = (payload.provider_id or DEFAULT_PROVIDER_ID).strip()
    saved = next((row for row in resolve_routing(session).providers if row.id == pid), None)
    if saved is None and payload.api_base_url is None:
        raise HTTPException(status_code=404, detail=f"没有这个供应商：{pid}")
    url = payload.api_base_url.strip().rstrip("/") if payload.api_base_url is not None else saved.api_base_url
    try:
        parsed = urlparse(url)
        valid_url = parsed.scheme in {"http", "https"} and bool(parsed.hostname)
        parsed.port  # Reject malformed port numbers before constructing the HTTP client.
    except ValueError:
        valid_url = False
    if not valid_url:
        raise HTTPException(status_code=422, detail="Base URL 必须是完整的 http:// 或 https:// 地址")
    timeout = payload.timeout if payload.timeout is not None else (saved.timeout if saved else 120.0)
    if not 1 <= timeout <= 600:
        raise HTTPException(status_code=422, detail="超时需在 1 到 600 秒之间")
    incoming = (payload.api_key or "").strip()
    key = incoming if incoming and not incoming.startswith(MASK) else (saved.api_key if saved else None)
    return LLMProvider(
        id=pid, name=saved.name if saved else pid,
        provider=saved.provider if saved else "openai_compatible",
        api_base_url=url, api_key=key, timeout=timeout,
    )


@router.get("/llm", response_model=LlmConfigOut)
def read_llm_config(session: Session = Depends(get_session)) -> LlmConfigOut:
    routing = resolve_routing(session)
    settings = routing.global_settings()
    budget = resolve_config(session)
    return LlmConfigOut(
        provider=settings.provider,
        api_base_url=settings.api_base_url,
        timeout=settings.timeout,
        models=dict(settings.models),
        api_key_masked=_mask(settings.api_key),
        api_key_set=bool(settings.api_key),
        configured=routing.is_configured,
        providers=[_provider_out(item, routing.providers) for item in routing.providers],
        routes=dict(routing.routes),
        tasks=list(TASKS),
        agent=AgentBudgetOut(
            max_steps=budget.max_steps,
            max_tokens=budget.max_tokens,
            default_max_steps=DEFAULT_MAX_STEPS,
            default_max_tokens=DEFAULT_MAX_TOKENS,
        ),
        catalogs=_catalogs(session),
    )


@router.put("/llm", response_model=LlmConfigOut)
def write_llm_config(
    payload: LlmConfigIn,
    session: Session = Depends(get_session),
) -> LlmConfigOut:
    before = {item.id: (item.api_base_url, item.api_key) for item in resolve_routing(session).providers}
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
    if payload.agent is not None:
        _write_agent_budget(session, payload.agent)
    session.flush()
    after = {item.id: (item.api_base_url, item.api_key) for item in resolve_routing(session).providers}
    catalogs = _catalogs(session)
    retained = {
        pid: catalog.model_dump(mode="json") for pid, catalog in catalogs.items()
        if pid in after and before.get(pid) == after[pid]
    }
    if set(retained) != set(catalogs):
        _store(session, MODEL_CATALOGS_KEY, json.dumps(retained, ensure_ascii=False))
    session.commit()
    return read_llm_config(session)


def _write_agent_budget(session: Session, payload: AgentBudgetIn) -> None:
    """Store the turn ceilings, refusing a number the loop could not run on.

    The accepted range is the resolver's own guard rail, so the page never offers a
    value that silently comes back as the default.
    """
    for key, label, value, limits in (
        (MAX_STEPS_KEY, "内部步骤", payload.max_steps, MAX_STEPS_LIMITS),
        (MAX_TOKENS_KEY, "token", payload.max_tokens, MAX_TOKENS_LIMITS),
    ):
        if value is None:
            continue
        if not limits[0] <= value <= limits[1]:
            raise HTTPException(
                status_code=422,
                detail=f"对话 Agent {label}上限需在 {limits[0]} 到 {limits[1]} 之间",
            )
        _store(session, key, str(value))


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

    Uses GET /models when supported instead of running a billable completion.
    A successful catalog check does not guarantee that generation is available.

    With several providers saved, "is it working" is a question about a specific one, so
    the body may name it; no body still means the default provider, which is what the
    page did before providers became a list.
    """
    try:
        item = _connection_preview(session, payload or LlmTestIn())
    except HTTPException as cause:
        return LlmTestResult(ok=False, detail=str(cause.detail))
    if not item.api_base_url or not item.api_key:
        return LlmTestResult(ok=False, detail=f"供应商「{item.name}」缺少 Base URL 或 API Key，无法测试")
    try:
        response = _models_response(item)
    except (httpx.HTTPError, ValueError) as cause:
        return LlmTestResult(ok=False, detail=f"「{item.name}」连不上：" + type(cause).__name__)
    if response.status_code >= 400:
        return LlmTestResult(ok=False, detail=f"「{item.name}」网关返回 HTTP {response.status_code}")
    data = _catalog_data(response)
    if data is None or not isinstance(data.get("data"), list):
        return LlmTestResult(ok=False, detail=f"「{item.name}」返回的不是模型接口 JSON，请检查 Base URL")
    return LlmTestResult(ok=True, detail=f"「{item.name}」连接正常（HTTP {response.status_code}）")


def _catalog_data(response: httpx.Response) -> dict | None:
    try:
        data = response.json()
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


@router.post("/llm/models", response_model=LlmModelsOut)
def preview_llm_models(payload: LlmTestIn, session: Session = Depends(get_session)) -> LlmModelsOut:
    item = _connection_preview(session, payload)
    result = _list_models(item)
    saved = next((row for row in resolve_routing(session).providers if row.id == item.id), None)
    if saved and (saved.api_base_url, saved.api_key) == (item.api_base_url, item.api_key):
        _cache_models(session, result)
    return result


@router.get("/llm/models", response_model=LlmModelsOut)
def list_llm_models(
    provider_id: str = DEFAULT_PROVIDER_ID,
    session: Session = Depends(get_session),
) -> LlmModelsOut:
    """Return the provider's live model IDs without making a generation request."""
    item = next((row for row in resolve_routing(session).providers if row.id == provider_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail=f"没有这个供应商：{provider_id}")
    result = _list_models(item)
    _cache_models(session, result)
    return result


def _cache_models(session: Session, result: LlmModelsOut) -> None:
    catalogs = {key: value.model_dump(mode="json") for key, value in _catalogs(session).items()}
    catalogs[result.provider_id] = {"models": result.models, "fetched_at": result.fetched_at}
    _store(session, MODEL_CATALOGS_KEY, json.dumps(catalogs, ensure_ascii=False))
    session.commit()


def _list_models(item: LLMProvider) -> LlmModelsOut:
    if not item.api_base_url or not item.api_key:
        raise HTTPException(status_code=422, detail=f"供应商「{item.name}」缺少 Base URL 或 API Key")
    try:
        response = _models_response(item)
    except (httpx.HTTPError, ValueError) as cause:
        raise HTTPException(
            status_code=502,
            detail=f"「{item.name}」模型列表读取失败：{type(cause).__name__}",
        ) from cause
    if response.status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"「{item.name}」模型网关返回 HTTP {response.status_code}",
        )
    models = _model_ids(response)
    if not models:
        raise HTTPException(status_code=502, detail=f"「{item.name}」没有返回可选模型")
    fetched_at = utc_now().isoformat()
    return LlmModelsOut(
        provider_id=item.id,
        models=models,
        detail=f"已获取 {len(models)} 个模型，未发起生成请求",
        fetched_at=fetched_at,
    )
