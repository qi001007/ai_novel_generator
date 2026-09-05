"""Multiple providers and per-task routing (第十九批批注 2).

The owner: 「我现在可能会同时保存不同的供应商…正文生成、审稿、章摘要这些功能，我可能会采用
不同供应商的不同模型」, plus a reserved slot for image generation.
"""

from fastapi.testclient import TestClient

from app.models import AppConfig
from app.services.llm import RoutedLLMClient, resolve_routing, resolve_settings
from sqlmodel import Session, select


def _put(client: TestClient, body: dict) -> dict:
    response = client.put("/api/config/llm", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_a_legacy_install_still_reads_as_one_default_provider(client: TestClient) -> None:
    data = _put(
        client,
        {
            "api_base_url": "https://a.example/v1",
            "api_key": "secret-key-9999",
            "models": {"draft": "Model-A", "review": "Model-A"},
        },
    )
    assert [item["id"] for item in data["providers"]] == ["default"]
    assert data["providers"][0]["is_default"] is True
    assert data["providers"][0]["api_key_masked"] == "****9999"
    assert data["providers"][0]["api_key_masked"] != "secret-key-9999"
    assert all(value == "default" for value in data["routes"].values())
    # the reserved image slot is reported, not hidden
    assert "image" in data["tasks"] and "image" in data["models"]


def test_two_providers_route_different_tasks(client: TestClient, db_engine) -> None:
    _put(
        client,
        {
            "api_base_url": "https://a.example/v1",
            "api_key": "key-aaaa-1111",
            "models": {"draft": "Model-A", "review": "Model-B", "summary": "Model-B"},
            "providers": [
                {
                    "id": "b",
                    "name": "B 家",
                    "provider": "openai_compatible",
                    "api_base_url": "https://b.example/v1",
                    "api_key": "key-bbbb-2222",
                    "timeout": 60,
                }
            ],
            "routes": {"review": "b", "summary": "b"},
        },
    )

    with Session(db_engine) as session:
        # draft stays on the default gateway, review and summary move to B
        assert resolve_settings(session, "draft").api_base_url == "https://a.example/v1"
        assert resolve_settings(session, "review").api_base_url == "https://b.example/v1"
        assert resolve_settings(session, "summary").api_base_url == "https://b.example/v1"
        # and the no-task view keeps meaning the default provider, as it always did
        assert resolve_settings(session).api_base_url == "https://a.example/v1"

        client_obj = RoutedLLMClient(resolve_routing(session))
        assert client_obj._for("draft").settings.api_base_url == "https://a.example/v1"
        assert client_obj._for("review").settings.api_base_url == "https://b.example/v1"
        # the status view is unchanged in shape, so /api/llm/status needs no edit
        assert client_obj.settings.api_base_url == "https://a.example/v1"


def test_the_secret_of_a_second_provider_is_never_echoed(client: TestClient, db_engine) -> None:
    data = _put(
        client,
        {
            "providers": [
                {
                    "id": "b",
                    "name": "B 家",
                    "api_base_url": "https://b.example/v1",
                    "api_key": "super-secret-4242",
                }
            ]
        },
    )
    row = next(item for item in data["providers"] if item["id"] == "b")
    assert row["api_key_masked"] == "****4242"
    assert row["api_key_set"] is True
    assert "super-secret" not in client.get("/api/config/llm").text

    # sending the mask back must not overwrite the real key
    again = _put(client, {"providers": [dict(row, api_key="****4242", name="B 家改名")]})
    moved = next(item for item in again["providers"] if item["id"] == "b")
    assert moved["name"] == "B 家改名"
    assert moved["api_key_masked"] == "****4242"
    with Session(db_engine) as session:
        stored = next(p for p in resolve_routing(session).providers if p.id == "b")
        assert stored.api_key == "super-secret-4242"


def test_a_route_to_a_missing_provider_is_refused(client: TestClient) -> None:
    response = client.put("/api/config/llm", json={"routes": {"draft": "ghost"}})
    assert response.status_code == 422
    assert "ghost" in response.json()["detail"]


def test_an_unknown_task_and_a_duplicate_id_are_both_refused(client: TestClient) -> None:
    assert client.put("/api/config/llm", json={"routes": {"teleport": "default"}}).status_code == 422
    bad = client.put(
        "/api/config/llm",
        json={
            "providers": [
                {"id": "x", "api_base_url": "https://x.example/v1"},
                {"id": "x", "api_base_url": "https://y.example/v1"},
            ]
        },
    )
    assert bad.status_code == 422
    assert "重复" in bad.json()["detail"]


def test_a_provider_url_is_validated_the_same_way_as_the_default(client: TestClient) -> None:
    response = client.put(
        "/api/config/llm",
        json={"providers": [{"id": "b", "api_base_url": "ftp://nope"}]},
    )
    assert response.status_code == 422
    assert "http://" in response.json()["detail"]


def test_the_connection_test_targets_one_named_provider(client: TestClient) -> None:
    _put(client, {"providers": [{"id": "b", "name": "B 家", "api_base_url": "https://b.invalid/v1"}]})
    result = client.post("/api/config/llm/test", json={"provider_id": "b"}).json()
    assert result["ok"] is False
    assert "B 家" in result["detail"]
    missing = client.post("/api/config/llm/test", json={"provider_id": "ghost"}).json()
    assert missing["ok"] is False
    assert "ghost" in missing["detail"]


def test_removing_every_extra_provider_leaves_the_default_working(client: TestClient, db_engine) -> None:
    _put(
        client,
        {
            "api_base_url": "https://a.example/v1",
            "api_key": "key-aaaa-1111",
            "models": {"draft": "Model-A"},
            "providers": [{"id": "b", "api_base_url": "https://b.example/v1", "api_key": "k-2222"}],
            "routes": {"draft": "b"},
        },
    )
    _put(client, {"providers": [], "routes": {"draft": "default"}})
    with Session(db_engine) as session:
        assert resolve_settings(session, "draft").api_base_url == "https://a.example/v1"
        rows = session.exec(select(AppConfig).where(AppConfig.key == "llm.route.draft")).all()
        assert rows[0].value == "default"
