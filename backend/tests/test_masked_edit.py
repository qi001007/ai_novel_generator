"""wanx2.1-imageedit 遮罩重绘客户端：一次付费提交，免费轮询，绝不自动重试付费请求。"""

from __future__ import annotations

import base64
import json
from io import BytesIO

import httpx
import pytest
from PIL import Image

from app.services import image_edit


def _png(width: int = 512, height: int = 512, color=(20, 30, 40)) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, format="PNG")
    return buffer.getvalue()


def _client(handler, **overrides) -> image_edit.DashScopeMaskedEditClient:
    settings = {
        "api_base_url": "https://dashscope.example.com/v1",
        "api_key": "test-key",
        "model": "wanx2.1-imageedit",
        "timeout": 5,
        "poll_interval": 0,
        "poll_timeout": 10,
    }
    settings.update(overrides)
    return image_edit.DashScopeMaskedEditClient(
        transport=httpx.MockTransport(handler), **settings
    )


def test_submits_one_paid_mask_task_then_polls_to_success() -> None:
    calls: list[httpx.Request] = []
    polls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal polls
        calls.append(request)
        if request.method == "POST":
            assert request.url.path == "/api/v1/services/aigc/image2image/image-synthesis"
            assert request.headers["X-DashScope-Async"] == "enable"
            assert request.headers["Authorization"] == "Bearer test-key"
            body = json.loads(request.content)
            assert body["model"] == "wanx2.1-imageedit"
            assert body["input"]["function"] == "description_edit_with_mask"
            assert body["input"]["prompt"] == "只补全白色遮罩区域"
            assert body["parameters"] == {"n": 1}
            assert body["input"]["base_image_url"].startswith("data:image/jpeg;base64,")
            assert body["input"]["mask_image_url"].startswith("data:image/png;base64,")
            return httpx.Response(
                200,
                headers={"x-request-id": "req-edit-1"},
                json={"output": {"task_id": "task-1", "task_status": "PENDING"}},
            )
        polls += 1
        assert request.url.path == "/api/v1/tasks/task-1"
        if polls == 1:
            return httpx.Response(200, json={"output": {"task_status": "RUNNING"}})
        return httpx.Response(
            200,
            json={
                "output": {
                    "task_status": "SUCCEEDED",
                    "results": [{"url": "https://images.example/expanded.png"}],
                    "usage": {"image_count": 1},
                }
            },
        )

    result = _client(handler).edit(
        image=_png(), mask=_png(color=(0, 0, 0)), prompt="只补全白色遮罩区域"
    )

    assert result.image_url == "https://images.example/expanded.png"
    assert result.model == "wanx2.1-imageedit"
    assert result.request_id == "req-edit-1"
    assert result.usage == {"image_count": 1}
    assert sum(1 for call in calls if call.method == "POST") == 1
    assert polls == 2


def test_failed_task_keeps_provider_diagnostics_but_redacts_keys() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"output": {"task_id": "task-bad"}})
        return httpx.Response(
            200,
            json={
                "output": {
                    "task_status": "FAILED",
                    "code": "InvalidParameter",
                    "message": "mask rejected for sk-do-not-leak-1234",
                }
            },
        )

    with pytest.raises(image_edit.MaskedEditError) as caught:
        _client(handler).edit(image=_png(), mask=_png(), prompt="补全")

    message = str(caught.value)
    assert "InvalidParameter" in message
    assert "sk-***" in message
    assert "do-not-leak" not in message


def test_missing_key_is_unavailable_before_any_http_call() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        raise AssertionError("must not reach the network without a key")

    client = _client(handler, api_key="")

    with pytest.raises(image_edit.MaskedEditUnavailable):
        client.edit(image=_png(), mask=_png(), prompt="补全")


def test_server_error_is_not_retried() -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(
            500,
            headers={"x-request-id": "req-down"},
            json={"code": "InternalError", "message": "upstream exploded"},
        )

    with pytest.raises(image_edit.MaskedEditError) as caught:
        _client(handler).edit(image=_png(), mask=_png(), prompt="补全")

    assert len(calls) == 1
    assert "500" in str(caught.value)
    assert "req-down" in str(caught.value)


def test_oversized_payload_is_rejected_before_submit(monkeypatch) -> None:
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return httpx.Response(200, json={"output": {"task_id": "task-1"}})

    monkeypatch.setattr(image_edit, "MAX_PAYLOAD_BYTES", 100)

    with pytest.raises(image_edit.MaskedEditError) as caught:
        _client(handler).edit(image=_png(), mask=_png(), prompt="补全")

    assert calls == []
    assert "上限" in str(caught.value)


def test_missing_result_url_is_an_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            return httpx.Response(200, json={"output": {"task_id": "task-empty"}})
        return httpx.Response(
            200, json={"output": {"task_status": "SUCCEEDED", "results": []}}
        )

    with pytest.raises(image_edit.MaskedEditError) as caught:
        _client(handler).edit(image=_png(), mask=_png(), prompt="补全")

    assert "图片地址" in str(caught.value)


def test_data_url_encodes_the_same_pixels_as_jpeg() -> None:
    url = image_edit.data_url(_png(64, 64, (1, 2, 3)), max_bytes=10_000_000)

    assert url.startswith("data:image/jpeg;base64,")
    raw = base64.b64decode(url.split(",", 1)[1])
    decoded = Image.open(BytesIO(raw)).convert("RGB")
    assert decoded.size == (64, 64)
    assert all(abs(a - b) <= 2 for a, b in zip(decoded.getpixel((0, 0)), (1, 2, 3)))


def test_mask_data_url_keeps_white_and_black_exact() -> None:
    mask = _png(64, 64, (255, 255, 255))
    url = image_edit.png_data_url(mask, max_bytes=10_000_000)

    assert url.startswith("data:image/png;base64,")
    raw = base64.b64decode(url.split(",", 1)[1])
    decoded = Image.open(BytesIO(raw)).convert("L")
    assert decoded.getpixel((0, 0)) == 255
