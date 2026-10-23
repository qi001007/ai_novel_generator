"""Masked image editing through DashScope's native async image2image API.

The submit call is billable and is attempted exactly once. Polling and the
later image download are free and may be retried by their callers.
"""

from __future__ import annotations

import base64
import os
import re
import time
from dataclasses import dataclass, field
from io import BytesIO
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import Depends
from PIL import Image
from sqlmodel import Session

from app.db import get_session
from app.services.llm import resolve_routing

MAX_PAYLOAD_BYTES = 10_000_000
DEFAULT_IMAGE_EDIT_MODEL = "wanx2.1-imageedit"
TOKEN_PATTERN = re.compile(r"sk-[A-Za-z0-9._-]+")
SUBMIT_PATH = "/api/v1/services/aigc/image2image/image-synthesis"
STATUS_PATH = "/api/v1/tasks/{task_id}"
FAILED_STATES = {"FAILED", "CANCELED", "UNKNOWN"}


class MaskedEditUnavailable(Exception):
    """The edit provider is not configured; callers should surface 409."""


class MaskedEditError(Exception):
    """The provider rejected or failed the edit; callers should surface 502."""


@dataclass(frozen=True)
class MaskedEditResult:
    image_url: str
    model: str
    request_id: str
    usage: dict[str, Any] = field(default_factory=dict)


def _safe_message(value: Any, limit: int = 240) -> str:
    text = " ".join(str(value or "").split())
    return TOKEN_PATTERN.sub("sk-***", text)[:limit]


def _proxy_for(base_url: str) -> str | None:
    scheme = urlparse(base_url).scheme.lower()
    name = "HTTPS_PROXY" if scheme == "https" else "HTTP_PROXY"
    proxy = os.environ.get(name) or os.environ.get(name.lower())
    if proxy and urlparse(proxy).scheme not in {"http", "https"}:
        return None
    return proxy


def _origin(api_base_url: str) -> str:
    parsed = urlparse(api_base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise MaskedEditUnavailable("扩图供应商 Base URL 不合法")
    return f"{parsed.scheme}://{parsed.netloc}"


def _encode_jpeg(image: Image.Image, quality: int) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=quality)
    return buffer.getvalue()


def data_url(image_bytes: bytes, *, max_bytes: int | None = None) -> str:
    limit = MAX_PAYLOAD_BYTES if max_bytes is None else max_bytes
    try:
        image = Image.open(BytesIO(image_bytes)).convert("RGB")
    except OSError as cause:
        raise MaskedEditError("底图无法解析") from cause
    for quality in (92, 85, 78):
        encoded = base64.b64encode(_encode_jpeg(image, quality)).decode("ascii")
        url = f"data:image/jpeg;base64,{encoded}"
        if len(url) <= limit:
            return url
    raise MaskedEditError(f"底图压缩后仍超过供应商 {limit} 字节上限")


def png_data_url(image_bytes: bytes, *, max_bytes: int | None = None) -> str:
    limit = MAX_PAYLOAD_BYTES if max_bytes is None else max_bytes
    encoded = base64.b64encode(image_bytes).decode("ascii")
    url = f"data:image/png;base64,{encoded}"
    if len(url) > limit:
        raise MaskedEditError(f"遮罩超过供应商 {limit} 字节上限")
    return url


class DashScopeMaskedEditClient:
    def __init__(
        self,
        *,
        api_base_url: str,
        api_key: str | None,
        model: str,
        timeout: float = 180,
        transport: httpx.BaseTransport | None = None,
        poll_interval: float = 2.0,
        poll_timeout: float = 300.0,
    ) -> None:
        self.api_key = (api_key or "").strip()
        self.model = model
        self.poll_interval = poll_interval
        self.poll_timeout = poll_timeout
        self._client = httpx.Client(
            base_url=_origin(api_base_url),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            timeout=timeout,
            transport=transport,
            proxy=None if transport is not None else _proxy_for(api_base_url),
            trust_env=False,
        )

    def close(self) -> None:
        self._client.close()

    def edit(self, *, image: bytes, mask: bytes, prompt: str) -> MaskedEditResult:
        if not self.api_key:
            raise MaskedEditUnavailable("扩图模型未配置 API Key")
        payload = {
            "model": self.model,
            "input": {
                "function": "description_edit_with_mask",
                "prompt": prompt,
                "base_image_url": data_url(image),
                "mask_image_url": png_data_url(mask),
            },
            "parameters": {"n": 1},
        }
        try:
            response = self._client.post(
                SUBMIT_PATH, json=payload, headers={"X-DashScope-Async": "enable"}
            )
        except httpx.HTTPError as cause:
            raise MaskedEditError(f"扩图请求没有发出去：{cause}") from cause
        if response.status_code >= 400:
            raise self._failure(response)

        data = response.json()
        output = data.get("output") if isinstance(data, dict) else None
        task_id = str((output or {}).get("task_id") or "").strip()
        if not task_id:
            raise MaskedEditError("供应商没有返回扩图任务编号")
        request_id = response.headers.get("x-request-id", "")

        deadline = time.monotonic() + self.poll_timeout
        network_errors = 0
        while True:
            if time.monotonic() > deadline:
                raise MaskedEditError(
                    f"扩图任务超时（task_id={task_id}, request_id={request_id or 'unknown'}）"
                )
            try:
                polled = self._client.get(STATUS_PATH.format(task_id=task_id))
            except httpx.HTTPError:
                network_errors += 1
                if network_errors >= 3:
                    raise MaskedEditError(
                        f"扩图任务轮询失败（task_id={task_id}）"
                    ) from None
                time.sleep(self.poll_interval)
                continue
            network_errors = 0
            if polled.status_code >= 400:
                raise self._failure(polled)

            body = polled.json()
            state = (body.get("output") or {}) if isinstance(body, dict) else {}
            status = str(state.get("task_status") or "").upper()
            if status == "SUCCEEDED":
                results = state.get("results") or []
                url = ""
                if results and isinstance(results[0], dict):
                    url = str(results[0].get("url") or "").strip()
                if not url:
                    raise MaskedEditError("扩图任务成功但没有返回图片地址")
                usage = state.get("usage") or body.get("usage") or {}
                return MaskedEditResult(
                    image_url=url,
                    model=self.model,
                    request_id=request_id,
                    usage=usage if isinstance(usage, dict) else {},
                )
            if status in FAILED_STATES:
                code = _safe_message(state.get("code"))
                message = _safe_message(state.get("message"))
                detail = " · ".join(part for part in (code, message) if part)
                raise MaskedEditError(
                    f"扩图任务失败：{detail or status}"
                    f"（task_id={task_id}, request_id={request_id or 'unknown'}）"
                )
            time.sleep(self.poll_interval)

    @staticmethod
    def _failure(response: httpx.Response) -> MaskedEditError:
        detail = ""
        try:
            failure = response.json()
        except ValueError:
            failure = None
        if isinstance(failure, dict):
            code = _safe_message(failure.get("code"))
            message = _safe_message(failure.get("message"))
            body = " · ".join(part for part in (code, message) if part)
            if body:
                detail = f": {body}"
        request_id = response.headers.get("x-request-id", "")
        if request_id:
            detail += f" (request_id={request_id})"
        return MaskedEditError(
            f"扩图请求失败（HTTP {response.status_code}）{detail}"
        )


def get_masked_edit_client(
    session: Session = Depends(get_session),
) -> DashScopeMaskedEditClient:
    routing = resolve_routing(session)
    provider = routing.provider_for("image_edit")
    return DashScopeMaskedEditClient(
        api_base_url=provider.api_base_url,
        api_key=provider.api_key,
        model=routing.models.get("image_edit") or DEFAULT_IMAGE_EDIT_MODEL,
        timeout=provider.timeout,
    )
