"""快照、恢复整本书、恢复单份文档。第二十五批批注 5。

这些用例要跑在**文件库**上：内存库没有文件可复制，快照这一环根本不存在，
拿它测「删完之后还能拿回来」就是自欺。所以这里自带一个 tmp_path 上的库。
"""

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine

from app.db import get_session
from app.main import app
from tests.planning_helpers import create_chapter


@pytest.fixture()
def file_client(tmp_path) -> Iterator[TestClient]:
    engine = create_engine(
        f"sqlite:///{(tmp_path / 'live.db').as_posix()}",
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(engine)

    def override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override
    yield TestClient(app)
    app.dependency_overrides.clear()


def _book(client: TestClient, title: str = "观星") -> int:
    novel_id = client.post("/api/novels", json={"title": title}).json()["id"]
    create_chapter(client, novel_id, chapter_number=1, content="雪夜碑鸣。")
    return novel_id


def test_deleting_a_book_leaves_a_snapshot_and_lists_it(file_client: TestClient, tmp_path) -> None:
    novel_id = _book(file_client)

    assert file_client.get("/api/backups").json()["snapshots"] == []
    assert file_client.delete(f"/api/novels/{novel_id}").status_code == 204

    listed = file_client.get("/api/backups").json()["snapshots"]
    assert len(listed) == 1
    assert listed[0]["reason"] == "删除前"
    assert listed[0]["novel_id"] == novel_id
    assert listed[0]["title"] == "观星"
    assert (tmp_path / "backups" / listed[0]["file"]).exists()


def test_restoring_a_whole_book_brings_the_prose_back(file_client: TestClient) -> None:
    novel_id = _book(file_client)
    file_client.delete(f"/api/novels/{novel_id}")
    assert file_client.get("/api/novels").json() == []
    snapshot = file_client.get("/api/backups").json()["snapshots"][0]["file"]

    restored = file_client.post("/api/backups/restore/novel", json={"file": snapshot})

    assert restored.status_code == 200, restored.text
    body = restored.json()["result"]
    assert body["novel_id"] == novel_id and body["title"] == "观星"
    assert body["rows"] > 0
    # 首页读的就是这条 - 恢复之后它必须数得回来（第二十六批批注 2 的根因
    # 是前端本地那份 novels 数组没人重读，后端这条先自证清白）
    assert [item["id"] for item in file_client.get("/api/novels").json()] == [novel_id]
    chapters = file_client.get(f"/api/novels/{novel_id}/chapters").json()
    assert [item["chapter_number"] for item in chapters] == [1]
    assert "雪夜碑鸣。" in chapters[0]["content"]

    # 第二次不许再来一遍：还在书架上就不覆盖
    again = file_client.post("/api/backups/restore/novel", json={"file": snapshot})
    assert again.status_code == 409
    assert "不覆盖" in again.json()["detail"]


def test_restoring_one_document_goes_back_to_its_place(file_client: TestClient) -> None:
    novel_id = _book(file_client)
    snapshot = None
    # 改之前先留一份现场（真实删除路径自己会做；这里手动照同一份口径）
    file_client.put(
        f"/api/novels/{novel_id}/files/chapters/0001/draft.md",
        json={"text": "# 正文\n\n改过的第一版。", "base_revision": None},
    )
    listed = file_client.get("/api/backups").json()["snapshots"]
    assert listed == []  # 改文档不产生快照，只有删除才留

    file_client.delete(f"/api/novels/{novel_id}")
    snapshot = file_client.get("/api/backups").json()["snapshots"][0]["file"]
    file_client.post("/api/backups/restore/novel", json={"file": snapshot})

    docs = file_client.get(f"/api/backups/documents?file={snapshot}").json()
    assert any(item["path"] == "chapters/0001/draft.md" for item in docs)

    back = file_client.post(
        "/api/backups/restore/document",
        json={"file": snapshot, "novel_id": novel_id, "path": "chapters/0001/draft.md", "into": "book"},
    )
    assert back.status_code == 200, back.text
    assert back.json()["result"]["restored"] == "book"
    text = file_client.get(f"/api/novels/{novel_id}/files/chapters/0001/draft.md").json()["text"]
    assert "改过的第一版。" in text


def test_a_document_from_a_missing_book_can_only_go_to_the_directory(file_client: TestClient) -> None:
    novel_id = _book(file_client)
    file_client.delete(f"/api/novels/{novel_id}")
    snapshot = file_client.get("/api/backups").json()["snapshots"][0]["file"]

    refused = file_client.post(
        "/api/backups/restore/document",
        json={"file": snapshot, "novel_id": novel_id, "path": "chapters/0001/draft.md", "into": "book"},
    )
    assert refused.status_code == 409
    assert "已经不在书架上" in refused.json()["detail"]

    nodir = file_client.post(
        "/api/backups/restore/document",
        json={"file": snapshot, "novel_id": novel_id, "path": "chapters/0001/draft.md", "into": "dir"},
    )
    assert nodir.status_code == 409  # 没设导出目录，不假装成功

    out = tmp_export_dir(file_client)
    saved = file_client.post(
        "/api/backups/restore/document",
        json={"file": snapshot, "novel_id": novel_id, "path": "chapters/0001/draft.md", "into": "dir"},
    )
    assert saved.status_code == 200, saved.text
    assert Path(saved.json()["result"]["saved_to"]).exists()
    assert out in saved.json()["result"]["saved_to"]


def test_only_real_snapshot_names_are_accepted(file_client: TestClient) -> None:
    for bad in ["../../etc/passwd", "novel_generator.db", "deleted-20260101-000000.db"]:
        refused = file_client.post("/api/backups/restore/novel", json={"file": bad})
        assert refused.status_code == 400, bad


def tmp_export_dir(client: TestClient) -> str:
    import tempfile

    path = Path(tempfile.mkdtemp(prefix="exports-"))
    client.put("/api/export/settings", json={"dir": str(path)})
    return str(path)
