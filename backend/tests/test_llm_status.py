from fastapi.testclient import TestClient


def test_llm_status_reports_provider_and_model_configuration(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setenv("NOVEL_LLM_PROVIDER", "opencode")
    monkeypatch.setenv("NOVEL_LLM_API_BASE_URL", "https://llm.example.com/v1")
    monkeypatch.setenv("NOVEL_LLM_API_KEY", "test-key")
    monkeypatch.setenv("NOVEL_LLM_DRAFT_MODEL", "draft")
    monkeypatch.setenv("NOVEL_LLM_REVIEW_MODEL", "review")
    monkeypatch.setenv("NOVEL_LLM_SUMMARY_MODEL", "")
    monkeypatch.setenv("NOVEL_LLM_CHAT_MODEL", "")

    response = client.get("/api/llm/status")

    assert response.status_code == 200
    data = response.json()
    assert data["provider"] == "opencode"
    assert data["configured"] is True
    # `image` is a real slot now (第十九批批注 2) - reported as unconfigured rather
    # than hidden, so the settings page can say 「未启用」 instead of inventing a button.
    assert data["models"] == {
        "draft": True,
        "review": True,
        "summary": False,
        "chat": False,
        "image": False,
    }


def test_llm_status_is_not_configured_without_models(
    client: TestClient,
    monkeypatch,
) -> None:
    monkeypatch.setenv("NOVEL_LLM_PROVIDER", "opencode")
    monkeypatch.setenv("NOVEL_LLM_API_BASE_URL", "https://llm.example.com/v1")
    monkeypatch.setenv("NOVEL_LLM_API_KEY", "test-key")
    monkeypatch.setenv("NOVEL_LLM_DRAFT_MODEL", "")
    monkeypatch.setenv("NOVEL_LLM_REVIEW_MODEL", "")
    monkeypatch.setenv("NOVEL_LLM_SUMMARY_MODEL", "")
    monkeypatch.setenv("NOVEL_LLM_CHAT_MODEL", "")

    response = client.get("/api/llm/status")

    assert response.status_code == 200
    data = response.json()
    assert data["configured"] is False
    assert data["models"] == {
        "draft": False,
        "review": False,
        "summary": False,
        "chat": False,
        "image": False,
    }
