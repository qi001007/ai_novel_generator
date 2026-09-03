import pytest
from fastapi.testclient import TestClient

from tests.planning_helpers import create_brief


@pytest.fixture(autouse=True)
def _force_unconfigured_llm(monkeypatch) -> None:
    """Ensure the test uses the deterministic fallback, not a real LLM API."""
    monkeypatch.setenv("NOVEL_LLM_API_KEY", "")


def test_generate_chapter_from_brief(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "生成流程测试"}).json()["id"]
    brief = create_brief(
        client,
        novel_id,
        chapter_number=1,
        goal="主角觉醒天赋",
        events="主角在地下密室中看见祖传玉佩发光。",
        pov="主角",
        characters=["主角"],
        conflict="天赋觉醒引来暗处窥视。",
        hook="密室石门缓缓开启。",
        required_facts=["主角"],
    )

    response = client.post(
        f"/api/novels/{novel_id}/chapters/from-brief/{brief['id']}",
    )

    assert response.status_code == 201
    data = response.json()
    assert data["chapter"]["brief_id"] == brief["id"]
    assert data["chapter"]["chapter_number"] == 1
    assert "主角觉醒天赋" in data["chapter"]["content"]
    assert "密室石门缓缓开启。" in data["chapter"]["content"]
    assert data["machine_check"]["passed"] is True
    assert data["generation_run"]["task_type"] == "draft"
    assert data["generation_run"]["chapter_id"] == data["chapter"]["id"]
