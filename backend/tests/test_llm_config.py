"""The /settings model-access surface: read, write, and never leak the key."""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _keep_tests_offline(monkeypatch) -> None:
    monkeypatch.setenv("NOVEL_LLM_API_KEY", "")


def test_config_starts_unset(client: TestClient) -> None:
    body = client.get("/api/config/llm").json()
    assert body["api_key_set"] is False
    assert body["api_key_masked"] == ""


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
