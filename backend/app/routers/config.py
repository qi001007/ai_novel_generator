"""Read and write the LLM connection settings the workbench exposes in /settings."""
import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel

from app.db import get_session
from app.models import AppConfig, utc_now
from app.services.llm import MODEL_KEYS, resolve_settings

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


class LlmConfigOut(SQLModel):
    provider: str
    api_base_url: str
    timeout: float
    models: dict[str, str]
    api_key_masked: str
    api_key_set: bool
    configured: bool


class LlmConfigIn(SQLModel):
    provider: str | None = None
    api_base_url: str | None = None
    api_key: str | None = None
    timeout: float | None = None
    models: dict[str, str] | None = None


class LlmTestResult(SQLModel):
    ok: bool
    detail: str


@router.get("/llm", response_model=LlmConfigOut)
def read_llm_config(session: Session = Depends(get_session)) -> LlmConfigOut:
    settings = resolve_settings(session)
    return LlmConfigOut(
        provider=settings.provider,
        api_base_url=settings.api_base_url,
        timeout=settings.timeout,
        models=dict(settings.models),
        api_key_masked=_mask(settings.api_key),
        api_key_set=bool(settings.api_key),
        configured=settings.is_configured,
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
    session.commit()
    return read_llm_config(session)


@router.post("/llm/test", response_model=LlmTestResult)
def test_llm_config(session: Session = Depends(get_session)) -> LlmTestResult:
    """Check the endpoint answers without spending a single token.

    Hits GET /models, which every OpenAI-compatible gateway serves, instead of running a
    completion: a connection test that bills the owner is not a connection test.
    """
    settings = resolve_settings(session)
    if not settings.api_base_url or not settings.api_key:
        return LlmTestResult(ok=False, detail="缺少 Base URL 或 API Key，无法测试")
    try:
        response = httpx.get(
            settings.api_base_url.rstrip("/") + "/models",
            headers={"Authorization": "Bearer " + settings.api_key},
            timeout=15.0,
        )
    except httpx.HTTPError as cause:
        return LlmTestResult(ok=False, detail="连不上：" + type(cause).__name__)
    if response.status_code >= 400:
        return LlmTestResult(ok=False, detail="网关返回 HTTP %d" % response.status_code)
    return LlmTestResult(ok=True, detail="连接正常（HTTP %d）" % response.status_code)
