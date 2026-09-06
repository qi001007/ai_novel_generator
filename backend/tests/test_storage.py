"""导出目录与「保存到磁盘」。第二十五批批注 3。

这一页测的是**磁盘**，不是数据库：导出仍然是读，写库那条口一次都不许被碰到。
"""

from pathlib import Path

from fastapi.testclient import TestClient

from tests.planning_helpers import create_chapter


def _novel(client: TestClient) -> int:
    return client.post("/api/novels", json={"title": "导出目录"}).json()["id"]


def test_export_dir_roundtrip_and_rejects_relative_paths(client: TestClient, tmp_path) -> None:
    assert client.get("/api/export/settings").json() == {"export_dir": ""}

    refused = client.put("/api/export/settings", json={"dir": "novel-exports"})
    assert refused.status_code == 400
    assert "绝对路径" in refused.json()["detail"]

    saved = client.put("/api/export/settings", json={"dir": str(tmp_path)})
    assert saved.status_code == 200, saved.text
    assert client.get("/api/export/settings").json()["export_dir"] == str(tmp_path)

    # 清空是允许的：清完就回到「用浏览器下载」
    client.put("/api/export/settings", json={"dir": ""})
    assert client.get("/api/export/settings").json()["export_dir"] == ""


def test_saving_an_export_refuses_without_a_directory(client: TestClient) -> None:
    novel_id = _novel(client)
    create_chapter(client, novel_id, chapter_number=1, content="雪。")

    refused = client.post(f"/api/novels/{novel_id}/export/save", json={"format": "txt"})
    assert refused.status_code == 409
    assert "还没有设置导出目录" in refused.json()["detail"]


def test_saving_an_export_writes_the_file_it_names(client: TestClient, tmp_path) -> None:
    novel_id = _novel(client)
    create_chapter(client, novel_id, chapter_number=1, content="雪夜碑鸣。")
    client.put("/api/export/settings", json={"dir": str(tmp_path)})

    saved = client.post(f"/api/novels/{novel_id}/export/save", json={"format": "txt"})
    assert saved.status_code == 200, saved.text
    path = Path(saved.json()["saved_to"])
    assert path.parent == tmp_path
    assert path.name == "导出目录_全书.txt"
    assert path.read_text(encoding="utf-8").startswith("第1章")

    one = client.post(
        f"/api/novels/{novel_id}/export/save",
        json={"scope": "chapter", "chapter_number": 1, "format": "md"},
    )
    assert one.status_code == 200, one.text
    assert Path(one.json()["saved_to"]).read_text(encoding="utf-8").startswith("# 第1章")


def test_saving_a_document_uses_its_own_label(client: TestClient, tmp_path) -> None:
    novel_id = _novel(client)
    client.put("/api/export/settings", json={"dir": str(tmp_path)})

    saved = client.post(
        f"/api/novels/{novel_id}/export/save",
        json={"document_path": "blueprint.md"},
    )
    assert saved.status_code == 200, saved.text
    path = Path(saved.json()["saved_to"])
    assert path.name.endswith("全书蓝图.md")
    # 与投影读到的一模一样：保存这条路不许偷偷改内容
    projection = client.get(f"/api/novels/{novel_id}/files/blueprint.md").json()["text"]
    assert path.read_text(encoding="utf-8") == projection


def test_saving_an_export_writes_nothing_to_the_database(client: TestClient, tmp_path) -> None:
    novel_id = _novel(client)
    create_chapter(client, novel_id, chapter_number=1, content="不许被导出改动。")
    client.put("/api/export/settings", json={"dir": str(tmp_path)})
    before = client.get(f"/api/novels/{novel_id}/chapters").json()

    assert client.post(f"/api/novels/{novel_id}/export/save", json={"format": "md"}).status_code == 200

    assert client.get(f"/api/novels/{novel_id}/chapters").json() == before
