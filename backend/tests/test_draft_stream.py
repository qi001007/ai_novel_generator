import json

from fastapi.testclient import TestClient

from app.main import app
from app.services.llm import LLMSettings, get_llm_client
from tests.planning_helpers import create_brief


class OfflineLLM:
    def __init__(self) -> None:
        self.settings = LLMSettings(
            provider="offline",
            api_base_url="",
            api_key=None,
            timeout=0,
            models={"draft": "", "review": "", "summary": "", "chat": ""},
        )

    def stream_messages(self, *args, **kwargs):
        raise AssertionError("offline stream must use the template fallback")


def _events(text: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    event = ""
    data = ""
    for line in text.splitlines():
        if line.startswith("event:"):
            event = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            data += line.split(":", 1)[1].strip()
        elif not line and event:
            events.append((event, json.loads(data)))
            event = ""
            data = ""
    return events


def test_stream_draft_streams_deltas_and_persists_once(client: TestClient) -> None:
    app.dependency_overrides[get_llm_client] = lambda: OfflineLLM()
    novel_id = client.post("/api/novels", json={"title": "流式写作"}).json()["id"]
    create_brief(
        client,
        novel_id,
        chapter_number=1,
        goal="主角听见碑鸣",
        characters=["沈曜"],
        hook="碑屑仍带体温",
    )

    before = client.get(f"/api/novels/{novel_id}/chapters").json()[0]
    assert before["content"] == "", before["content"]

    response = client.post(f"/api/novels/{novel_id}/chapters/from-brief/1/stream")

    assert response.status_code == 200
    events = _events(response.text)
    names = [name for name, _payload in events]
    assert names[0] == "context"
    assert names[1] == "delta"
    assert names.count("delta") > 1
    assert names[-1] == "done", response.text

    done = events[-1][1]
    assert "碑鸣" in done["chapter"]["content"]
    assert done["generation_run"]["task_type"] == "draft"
    assert done["machine_check"]["passed"] is True
    assert client.get(f"/api/novels/{novel_id}/chapters").json()[0]["word_count"] > 0
    app.dependency_overrides.clear()
