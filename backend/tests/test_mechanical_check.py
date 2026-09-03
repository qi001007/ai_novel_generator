from fastapi.testclient import TestClient

from tests.planning_helpers import create_chapter


def test_mechanical_check_reports_all_issues(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "机械校验测试"}).json()["id"]
    chapter = create_chapter(
        client, novel_id, content="这段正文太短，还有无聊的敏感词描写。"
    )

    response = client.post(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/machine-check",
        json={
            "min_word_count": 20,
            "max_word_count": 30,
            "forbidden_words": ["无聊"],
            "blacklist": ["敏感词"],
            "required_facts": ["主角", "钥匙"],
        },
    )

    assert response.status_code == 200
    result = response.json()
    assert result["passed"] is False
    assert result["word_count"] == len("这段正文太短，还有无聊的敏感词描写。")
    issue_types = [issue["type"] for issue in result["issues"]]
    assert "word_count" in issue_types
    assert "forbidden_word" in issue_types
    assert "blacklist" in issue_types
    assert "missing_fact" in issue_types


def test_mechanical_check_passes_valid_chapter(client: TestClient) -> None:
    novel_id = client.post("/api/novels", json={"title": "机械校验通过"}).json()["id"]
    chapter = create_chapter(
        client, novel_id, content="主角握住钥匙，走进荒宅。"
    )

    response = client.post(
        f"/api/novels/{novel_id}/chapters/{chapter['id']}/machine-check",
        json={
            "min_word_count": 10,
            "max_word_count": 20,
            "forbidden_words": ["无聊"],
            "blacklist": ["敏感词"],
            "required_facts": ["主角", "钥匙"],
        },
    )

    assert response.status_code == 200
    assert response.json()["passed"] is True
    assert response.json()["issues"] == []
