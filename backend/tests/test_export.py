"""导出正文：全书、单章、只读性。第二十四批新功能。

导出是**读**。这些测试里最重要的一条是最后那条 - 它证明导出没有偷偷写库，
因为「四层规划只有一条写入口」（D-01）是红线，多一个出口就是多一个事故源。
"""

from fastapi.testclient import TestClient

from tests.planning_helpers import create_chapter


def _novel(client: TestClient, title: str = "观星") -> int:
    return client.post("/api/novels", json={"title": title}).json()["id"]


def test_book_export_skips_chapters_without_prose(client: TestClient) -> None:
    novel_id = _novel(client)
    create_chapter(client, novel_id, chapter_number=1, content="第一段的碑。")
    create_chapter(client, novel_id, chapter_number=2, content="第二段的雪。")
    create_chapter(client, novel_id, chapter_number=3)  # 有简报、没正文

    response = client.get(f"/api/novels/{novel_id}/export?format=txt")

    assert response.status_code == 200, response.text
    body = response.text
    assert body.index("第1章") < body.index("第2章")
    assert "第3章" not in body
    assert "第一段的碑。" in body and "第二段的雪。" in body
    # 空行分隔：起点一类平台吃的是纯文本，不留 markdown 记号
    assert "# " not in body


def test_chapter_export_keeps_markdown_headings(client: TestClient) -> None:
    novel_id = _novel(client)
    create_chapter(client, novel_id, chapter_number=4, content="碑下的名字。")

    response = client.get(
        f"/api/novels/{novel_id}/export?scope=chapter&chapter_number=4&format=md"
    )

    assert response.status_code == 200, response.text
    assert response.text.startswith("# 第4章\n\n碑下的名字。")
    assert "filename*=UTF-8''" in response.headers["content-disposition"]
    assert "_0004.md" in response.headers["content-disposition"] or "%E7%AC%AC0004%E7%AB%A0.md" in response.headers["content-disposition"]


def test_export_reports_why_it_refused(client: TestClient) -> None:
    novel_id = _novel(client)
    assert client.get(f"/api/novels/{novel_id}/export").status_code == 404
    create_chapter(client, novel_id, chapter_number=1)
    # 有章无正文：给一个 409，而不是让人下载一个 0 字节文件
    refused = client.get(f"/api/novels/{novel_id}/export?scope=chapter&chapter_number=1")
    assert refused.status_code == 409
    assert client.get(f"/api/novels/{novel_id}/export?scope=chapter&chapter_number=99").status_code == 404
    assert client.get(f"/api/novels/{novel_id}/export?format=docx").status_code == 400
    assert client.get("/api/novels/9999/export").status_code == 404


def test_export_writes_nothing(client: TestClient) -> None:
    novel_id = _novel(client)
    create_chapter(client, novel_id, chapter_number=1, content="不许被导出改动。")
    before = client.get(f"/api/novels/{novel_id}/chapters").json()

    assert client.get(f"/api/novels/{novel_id}/export?format=md").status_code == 200
    assert (
        client.get(f"/api/novels/{novel_id}/export?scope=chapter&chapter_number=1&format=txt").status_code
        == 200
    )

    after = client.get(f"/api/novels/{novel_id}/chapters").json()
    assert after == before
