import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.llm import (
    ImageGenerationResult,
    LLMError,
    LLMSettings,
    OpenAICompatibleClient,
    get_llm_client,
)


def test_openai_compatible_client_generates_one_image() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/images/generations"
        assert request.headers["Authorization"] == "Bearer test-key"
        assert json.loads(request.content) == {
            "model": "qwen-image-3.0-pro",
            "prompt": "雾城上空的观星塔",
            "size": "1024x1024",
            "n": 1,
            "prompt_extend": True,
        }
        return httpx.Response(
            200,
            headers={"x-request-id": "req-image-1"},
            json={
                "data": [{"url": "https://images.example/result.png"}],
                "usage": {"output_image_count": 1},
            },
        )

    client = OpenAICompatibleClient(
        LLMSettings(
            provider="bailian_token_plan",
            api_base_url="https://llm.test/v1",
            api_key="test-key",
            timeout=1,
            models={"image": "qwen-image-3.0-pro"},
        ),
        transport=httpx.MockTransport(handler),
    )

    result = client.generate_image("雾城上空的观星塔")

    assert result.urls == ["https://images.example/result.png"]
    assert result.model == "qwen-image-3.0-pro"
    assert result.request_id == "req-image-1"


def test_image_error_keeps_provider_diagnostics_but_redacts_keys() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            headers={"x-request-id": "req-bad-image"},
            json={
                "code": "invalid_parameter_error",
                "message": "Use another endpoint with sk-do-not-leak-1234",
            },
        )

    client = OpenAICompatibleClient(
        LLMSettings(
            provider="test",
            api_base_url="https://llm.test/v1",
            api_key="test-key",
            timeout=1,
            models={"image": "image-model"},
        ),
        transport=httpx.MockTransport(handler),
    )

    with pytest.raises(LLMError) as caught:
        client.generate_image("test")

    message = str(caught.value)
    assert "invalid_parameter_error" in message
    assert "req-bad-image" in message
    assert "do-not-leak" not in message
    assert "sk-***" in message


class FakeImageClient:
    def generate_image(self, prompt: str, **kwargs) -> ImageGenerationResult:
        assert prompt == "雾城地图"
        assert kwargs["size"] == "1024x1536"
        return ImageGenerationResult(
            model="qwen-image-3.0-pro",
            urls=["https://images.example/map.png"],
            usage={"output_image_count": 1},
            request_id="req-route-1",
        )


def test_image_route_uses_the_configured_provider() -> None:
    app.dependency_overrides[get_llm_client] = lambda: FakeImageClient()
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/images/generations",
                json={"prompt": "雾城地图", "size": "1024x1536"},
            )
    finally:
        app.dependency_overrides.pop(get_llm_client, None)

    assert response.status_code == 200
    assert response.json() == {
        "model": "qwen-image-3.0-pro",
        "urls": ["https://images.example/map.png"],
        "usage": {"output_image_count": 1},
        "request_id": "req-route-1",
        "expires_in_hours": 24,
    }
