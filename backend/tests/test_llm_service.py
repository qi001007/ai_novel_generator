import httpx
import json

from app.services.llm import LLMSettings, OpenAICompatibleClient


def test_openai_compatible_client_parses_chat_response() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/chat/completions"
        assert request.headers["Authorization"] == "Bearer test-key"
        assert json.loads(request.content)["model"] == "draft-model"

        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "生成的正文"}}],
                "usage": {"prompt_tokens": 12, "completion_tokens": 34},
            },
        )

    client = OpenAICompatibleClient(
        LLMSettings(
            provider="openai_compatible",
            api_base_url="https://llm.test/v1",
            api_key="test-key",
            timeout=1,
            models={"draft": "draft-model"},
        ),
        transport=httpx.MockTransport(handler),
    )

    result = client.complete(
        task_type="draft",
        system="你是小说作者",
        user="写第一章",
    )

    assert result.content == "生成的正文"
    assert result.model == "draft-model"
    assert result.token_input == 12
    assert result.token_output == 34
