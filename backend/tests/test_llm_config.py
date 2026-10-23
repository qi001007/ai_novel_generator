"""The /settings model-access surface: read, write, and never leak the key."""
import pytest
import httpx
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _keep_tests_offline(monkeypatch) -> None:
    monkeypatch.setenv("NOVEL_LLM_API_KEY", "")


def test_config_starts_unset(client: TestClient) -> None:
    body = client.get("/api/config/llm").json()
    assert body["api_key_set"] is False
    assert body["api_key_masked"] == ""


@pytest.mark.parametrize("path", ["/api/config/llm/test", "/api/config/llm/models"])
def test_connection_preview_uses_unsaved_fields_without_persisting(client, monkeypatch, path):
    def models_response(item):
        assert item.api_base_url == "https://draft.example/v1"
        assert item.api_key == "draft-test-key"
        assert item.timeout == 45
        return httpx.Response(200, json={"data": [{"id": "preview-model"}]})

    monkeypatch.setattr("app.routers.config._models_response", models_response)
    before = client.get("/api/config/llm").json()
    result = client.post(path, json={
        "provider_id": "default", "api_base_url": "https://draft.example/v1/",
        "api_key": "draft-test-key", "timeout": 45,
    })
    assert result.status_code == 200, result.text
    if path.endswith("/test"):
        assert result.json()["ok"] is True
    else:
        assert result.json()["models"] == ["preview-model"]
    assert client.get("/api/config/llm").json() == before


@pytest.mark.parametrize("path", ["/api/config/llm/test", "/api/config/llm/models"])
def test_new_provider_can_be_checked_before_it_is_saved(client, monkeypatch, path):
    def models_response(item):
        assert item.id == "new-provider"
        assert item.api_key == "new-provider-key"
        return httpx.Response(200, json={"data": [{"id": "new-model"}]})

    monkeypatch.setattr("app.routers.config._models_response", models_response)
    result = client.post(path, json={
        "provider_id": "new-provider", "api_base_url": "https://new.example/v1",
        "api_key": "new-provider-key",
    })
    assert result.status_code == 200
    assert result.json().get("ok", True) is True
    assert len(client.get("/api/config/llm").json()["providers"]) == 1


@pytest.mark.parametrize("key", ["", "****1234", None])
def test_preview_keeps_stored_key_when_the_form_leaves_it_blank(client, monkeypatch, key):
    client.put("/api/config/llm", json={"api_key": "stored-key-1234"})

    def models_response(item):
        assert item.api_key == "stored-key-1234"
        return httpx.Response(200, json={"data": [{"id": "stored-model"}]})

    monkeypatch.setattr("app.routers.config._models_response", models_response)
    result = client.post("/api/config/llm/models", json={"api_key": key})
    assert result.status_code == 200
    assert result.json()["models"] == ["stored-model"]


def test_preview_sends_authorization_and_honors_the_connection_timeout(client, monkeypatch):
    monkeypatch.delenv("HTTPS_PROXY", raising=False)

    def handler(request):
        assert request.url == "https://gateway.example/v1/models"
        assert request.headers["Authorization"] == "Bearer typed-key"
        assert request.extensions["timeout"]["read"] == 42
        return httpx.Response(200, json={"data": [{"id": "model-a"}]})

    real_client = httpx.Client
    monkeypatch.setattr("app.routers.config.httpx.Client", lambda **kwargs: real_client(
        transport=httpx.MockTransport(handler), **kwargs,
    ))
    result = client.post("/api/config/llm/models", json={
        "api_base_url": "https://gateway.example/v1", "api_key": "typed-key", "timeout": 42,
    })
    assert result.status_code == 200
    assert result.json()["models"] == ["model-a"]


@pytest.mark.parametrize("body", [{"data": None}, {"data": 5}, {"data": [{"id": None}]}])
def test_malformed_catalog_is_an_explained_failure_not_a_server_crash(client, monkeypatch, body):
    monkeypatch.setattr("app.routers.config._models_response", lambda item: httpx.Response(200, json=body))
    result = client.post("/api/config/llm/models", json={"api_key": "typed-key"})
    assert result.status_code == 502
    assert "没有返回可选模型" in result.json()["detail"]


@pytest.mark.parametrize("response", [
    httpx.Response(200, text="<html>login</html>"),
    httpx.Response(200, json={"error": "wrong endpoint"}),
])
def test_html_success_page_is_not_a_successful_api_connection(client, monkeypatch, response):
    monkeypatch.setattr("app.routers.config._models_response", lambda item: response)
    result = client.post("/api/config/llm/test", json={"api_key": "typed-key"}).json()
    assert result["ok"] is False
    assert "Base URL" in result["detail"]


@pytest.mark.parametrize("changes", [{"api_base_url": "https://other.example/v1"}, {"api_key": "new-key"}])
def test_changing_a_saved_connection_discards_its_old_model_catalog(client, monkeypatch, changes):
    client.put("/api/config/llm", json={"api_key": "old-key"})
    monkeypatch.setattr("app.routers.config._models_response", lambda item: httpx.Response(200, json={"data": [{"id": "old-model"}]}))
    assert client.get("/api/config/llm/models").status_code == 200
    assert "default" in client.get("/api/config/llm").json()["catalogs"]
    result = client.put("/api/config/llm", json=changes)
    assert result.status_code == 200
    assert "default" not in result.json()["catalogs"]


@pytest.mark.parametrize("url", ["https://[", "http://localhost:invalid"])
def test_malformed_draft_url_is_a_validation_error(client, url):
    result = client.post("/api/config/llm/models", json={"api_base_url": url, "api_key": "typed-key"})
    assert result.status_code == 422
    assert "typed-key" not in result.text


def test_form_catalog_refresh_is_cached_only_for_the_saved_connection(client, monkeypatch):
    client.put("/api/config/llm", json={"api_key": "saved-key"})
    monkeypatch.setattr("app.routers.config._models_response", lambda item: httpx.Response(200, json={"data": [{"id": "current-model"}]}))
    result = client.post("/api/config/llm/models", json={"api_key": ""})
    assert result.status_code == 200
    saved = client.get("/api/config/llm").json()
    assert saved["catalogs"]["default"]["models"] == ["current-model"]
    client.post("/api/config/llm/models", json={"api_base_url": "https://other.example/v1"})
    assert client.get("/api/config/llm").json() == saved


def test_saving_a_key_returns_only_a_mask(client: TestClient) -> None:
    saved = client.put(
        "/api/config/llm",
        json={
            "api_base_url": "https://gateway.example/v1/",
            "api_key": "sk-secret-value-9876",
            "models": {"draft": "Model-A"},
        },
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    # the tail is enough to recognise it; the middle must never come back
    assert body["api_key_masked"] == "****9876"
    assert "secret" not in body["api_key_masked"]
    assert body["api_key_set"] is True
    assert body["api_base_url"] == "https://gateway.example/v1"
    assert body["models"]["draft"] == "Model-A"
    assert body["configured"] is True

    again = client.get("/api/config/llm").json()
    assert again["api_key_masked"] == "****9876"
    assert "secret" not in str(again)


def test_echoing_the_mask_keeps_the_real_key(client: TestClient) -> None:
    client.put("/api/config/llm", json={"api_key": "sk-another-1234"})
    body = client.put("/api/config/llm", json={"api_key": "****1234", "timeout": 30}).json()
    assert body["api_key_masked"] == "****1234"
    assert body["timeout"] == 30


def test_stored_values_beat_the_environment(client: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("NOVEL_LLM_API_KEY", "env-key-abcd")
    from app.services.llm import LLMSettings

    assert LLMSettings.from_env().api_key == "env-key-abcd"
    client.put("/api/config/llm", json={"api_key": "db-key-wxyz"})
    assert client.get("/api/config/llm").json()["api_key_masked"] == "****wxyz"


def test_bad_input_is_rejected(client: TestClient) -> None:
    bad_url = client.put("/api/config/llm", json={"api_base_url": "ftp://x"})
    assert bad_url.status_code == 422
    bad_timeout = client.put("/api/config/llm", json={"timeout": 9999})
    assert bad_timeout.status_code == 422


def test_connection_check_needs_a_key_and_never_calls_a_model(client: TestClient) -> None:
    result = client.post("/api/config/llm/test").json()
    assert result["ok"] is False
    assert "缺少" in result["detail"]


def test_connection_check_ignores_an_unsupported_all_proxy(
    client: TestClient,
    monkeypatch,
) -> None:
    client.put(
        "/api/config/llm",
        json={
            "api_base_url": "https://gateway.example/v1",
            "api_key": "test-key",
            "models": {"chat": "chat-model"},
        },
    )
    monkeypatch.setenv("ALL_PROXY", "socks5h://127.0.0.1:7890")
    monkeypatch.delenv("HTTPS_PROXY", raising=False)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/models"
        return httpx.Response(200, json={"data": []})

    real_client = httpx.Client
    monkeypatch.setattr(
        "app.routers.config.httpx.Client",
        lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs),
    )

    result = client.post("/api/config/llm/test").json()

    assert result == {"ok": True, "detail": "「默认」连接正常（HTTP 200）"}


def test_model_catalog_lists_live_ids_without_a_generation(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.delenv("HTTPS_PROXY", raising=False)
    client.put(
        "/api/config/llm",
        json={
            "api_base_url": "https://gateway.example/v1",
            "api_key": "test-key",
            "models": {"chat": "qwen-light"},
        },
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        assert request.url.path == "/v1/models"
        return httpx.Response(
            200,
            json={"data": [{"id": "qwen-light"}, {"id": "qwen-pro"}, {"id": "qwen-light"}]},
        )

    real_client = httpx.Client
    monkeypatch.setattr(
        "app.routers.config.httpx.Client",
        lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs),
    )

    result = client.get("/api/config/llm/models?provider_id=default")

    assert result.status_code == 200, result.text
    body = result.json()
    assert body["fetched_at"]
    assert {key: value for key, value in body.items() if key != "fetched_at"} == {
        "provider_id": "default",
        "models": ["qwen-light", "qwen-pro"],
        "detail": "已获取 2 个模型，未发起生成请求",
    }


def test_the_agent_budget_ships_at_the_measured_default(client: TestClient) -> None:
    """One message may use several model/tool steps; it is not a question count."""
    agent = client.get("/api/config/llm").json()["agent"]
    assert agent["max_steps"] == 20
    assert agent["max_tokens"] == 60_000
    assert agent["default_max_steps"] == 20
    assert agent["default_max_tokens"] == 60_000


def test_the_owner_can_raise_both_ceilings_and_the_page_reads_them_back(client: TestClient) -> None:
    saved = client.put(
        "/api/config/llm", json={"agent": {"max_steps": 9, "max_tokens": 120_000}}
    ).json()
    assert saved["agent"]["max_steps"] == 9
    assert saved["agent"]["max_tokens"] == 120_000
    # 只改一个数时另一个不能被抹回默认值——页面每次整块提交
    again = client.put("/api/config/llm", json={"agent": {"max_tokens": 45_000}}).json()
    assert again["agent"]["max_tokens"] == 45_000
    assert again["agent"]["max_steps"] == 9


def test_a_ceiling_the_loop_could_not_run_on_is_refused(client: TestClient) -> None:
    too_small = client.put("/api/config/llm", json={"agent": {"max_steps": 0}})
    assert too_small.status_code == 422
    assert "1 到 64" in too_small.text
    too_big = client.put("/api/config/llm", json={"agent": {"max_tokens": 500}})
    assert too_big.status_code == 422
    assert "1000 到 1000000" in too_big.text
    # 被拒的那次不落库，主人看到的还是原来那一档
    agent = client.get("/api/config/llm").json()["agent"]
    assert agent["max_steps"] == 20 and agent["max_tokens"] == 60_000


def test_a_hand_edited_row_that_is_not_a_number_falls_back(db_engine) -> None:
    """一行坏数据不能把对话闸死，同 llm.* 那些行的规矩。"""
    from sqlmodel import Session

    from app.models import AppConfig
    from app.services.agent import DEFAULT_MAX_TOKENS, MAX_TOKENS_LIMITS, resolve_config

    with Session(db_engine) as session:
        assert resolve_config(session).max_tokens == DEFAULT_MAX_TOKENS

        def store(value: str) -> None:
            row = session.get(AppConfig, "agent.max_tokens")
            if row is None:
                row = AppConfig(key="agent.max_tokens", value=value)
            else:
                row.value = value
            session.add(row)
            session.commit()

        store("很多")
        assert resolve_config(session).max_tokens == DEFAULT_MAX_TOKENS
        store("999999999")
        assert resolve_config(session).max_tokens == MAX_TOKENS_LIMITS[1]
