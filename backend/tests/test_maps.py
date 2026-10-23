"""M-02 基础地图库：单图生成、本机落盘、版本确认与删除级联。

生图在这里始终用假供应商：真实图片调用要按 V-08 单独批准费用。
"""

from __future__ import annotations

import http.server
import threading
from collections.abc import Iterator
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlmodel import Session, SQLModel, create_engine, select

from app.db import get_session
from app.main import app
from app.models import ArcPlan, ChapterBrief, MapTile, PlanningBlueprint
from app.services import map_canvas
from app.services import maps as maps_service
from app.services.image_edit import (
    MaskedEditResult,
    MaskedEditUnavailable,
    get_masked_edit_client,
)
from app.services.llm import (
    ImageGenerationResult,
    LLMError,
    LLMUnavailableError,
    get_llm_client,
)

IMAGE_BYTES = b"\x89PNG\r\n\x1a\nmap-image"


class FakeImageLLM:
    def __init__(self, *, unavailable: bool = False) -> None:
        self.unavailable = unavailable
        self.calls: list[tuple[str, dict]] = []
        self.billing_calls = 0

    def generate_image(self, prompt: str, **kwargs) -> ImageGenerationResult:
        self.calls.append((prompt, kwargs))
        if self.unavailable:
            raise LLMUnavailableError("LLM model for image is not configured")
        self.billing_calls += 1
        return ImageGenerationResult(
            model="qwen-image-3.0-pro",
            urls=["https://images.example/map-temp.png"],
            usage={"output_image_count": 1},
            request_id="req-map-1",
        )


class FakeMaskedEdit:
    """A real HTTP-shaped edit provider stand-in: it only ever fills the whole canvas.

    The service pastes the parent back outside the mask, so the test can tell exact
    preservation apart from a provider that redrew everything.
    """

    def __init__(self, downloads: dict[str, tuple[bytes, str]]) -> None:
        self.downloads = downloads
        self.calls: list[dict] = []
        self.override_size: tuple[int, int] | None = None
        self.unavailable = False

    def edit(self, *, image: bytes, mask: bytes, prompt: str) -> MaskedEditResult:
        self.calls.append({"image": image, "mask": mask, "prompt": prompt})
        if self.unavailable:
            raise MaskedEditUnavailable("扩图模型未配置")
        source = Image.open(BytesIO(image)).convert("RGB")
        size = self.override_size or source.size
        generated = Image.new("RGB", size, (200, 0, 0))
        buffer = BytesIO()
        generated.save(buffer, format="PNG")
        self.downloads["next"] = (buffer.getvalue(), "png")
        return MaskedEditResult(
            image_url=f"https://images.example/edit-{len(self.calls)}.png",
            model="wanx2.1-imageedit",
            request_id=f"req-edit-{len(self.calls)}",
            usage={"image_count": 1},
        )


@dataclass
class MapEnv:
    client: TestClient
    engine: object
    db_path: Path
    tmp_path: Path
    llm: FakeImageLLM
    edit: FakeMaskedEdit
    downloads: dict[str, tuple[bytes, str]]
    image_bytes: bytes = IMAGE_BYTES
    reopened: list[TestClient] = field(default_factory=list)

    def session(self) -> Session:
        return Session(self.engine)

    def reopen(self) -> TestClient:
        """A fresh client on the same SQLite file - the closest thing to a restart."""
        engine = create_engine(
            f"sqlite:///{self.db_path.as_posix()}",
            connect_args={"check_same_thread": False},
        )

        def override():
            with Session(engine) as session:
                yield session

        app.dependency_overrides[get_session] = override
        client = TestClient(app)
        self.reopened.append(client)
        return client


@pytest.fixture()
def map_env(tmp_path) -> Iterator[MapEnv]:
    db_path = tmp_path / "live.db"
    engine = create_engine(
        f"sqlite:///{db_path.as_posix()}",
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(engine)

    def override():
        with Session(engine) as session:
            yield session

    llm = FakeImageLLM()
    downloads: dict[str, tuple[bytes, str]] = {"next": (IMAGE_BYTES, "png")}
    edit = FakeMaskedEdit(downloads)
    app.dependency_overrides[get_session] = override
    app.dependency_overrides[get_llm_client] = lambda: llm
    app.dependency_overrides[get_masked_edit_client] = lambda: edit
    env = MapEnv(
        client=TestClient(app),
        engine=engine,
        db_path=db_path,
        tmp_path=tmp_path,
        llm=llm,
        edit=edit,
        downloads=downloads,
    )
    try:
        yield env
    finally:
        for client in env.reopened:
            client.close()
        app.dependency_overrides.pop(get_masked_edit_client, None)
        app.dependency_overrides.pop(get_llm_client, None)
        app.dependency_overrides.pop(get_session, None)
        env.client.close()


def _png(width: int, height: int, color: tuple[int, int, int] = (10, 20, 30)) -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, format="PNG")
    return buffer.getvalue()


def _open(data: bytes) -> Image.Image:
    return Image.open(BytesIO(data)).convert("RGB")


def _novel(env: MapEnv, title: str = "雾城") -> int:
    response = env.client.post("/api/novels", json={"title": title})
    assert response.status_code in {200, 201}, response.text
    return int(response.json()["id"])


def _project(env: MapEnv, novel_id: int, name: str = "雾城全域图") -> dict:
    response = env.client.post(f"/api/novels/{novel_id}/maps", json={"name": name})
    assert response.status_code in {200, 201}, response.text
    return response.json()


def _generate(env: MapEnv, project_id: int, **payload) -> object:
    body = {"prompt": "雾城地图", "confirm_billing": True}
    body.update(payload)
    return env.client.post(f"/api/maps/{project_id}/versions", json=body)


def test_generate_persists_image_and_confirm_makes_it_active(map_env, monkeypatch) -> None:
    monkeypatch.setattr(maps_service, "download_image", lambda url: (IMAGE_BYTES, "png"))
    novel_id = _novel(map_env)
    project = _project(map_env, novel_id)
    assert project["revision"] == 0
    assert project["active_revision"] is None

    created = _generate(map_env, project["id"], size="1024x1536")

    assert created.status_code == 200, created.text
    version = created.json()
    assert version["revision"] == 1
    assert version["status"] == "draft"
    assert version["model"] == "qwen-image-3.0-pro"
    assert version["image_url"] == f"/api/maps/{project['id']}/versions/1/image"
    saved = map_env.tmp_path / "map_assets" / str(novel_id) / str(project["id"]) / "r1.png"
    assert saved.read_bytes() == IMAGE_BYTES
    assert map_env.llm.calls[0][0] == "雾城地图"
    assert map_env.llm.calls[0][1]["size"] == "1024x1536"

    detail = map_env.client.get(f"/api/maps/{project['id']}").json()
    assert detail["active_revision"] is None
    assert detail["revision"] == 1
    assert [item["revision"] for item in detail["versions"]] == [1]
    image = map_env.client.get(f"/api/maps/{project['id']}/versions/1/image")
    assert image.status_code == 200
    assert image.content == IMAGE_BYTES
    assert image.headers["content-type"].startswith("image/png")

    confirmed = map_env.client.post(f"/api/maps/{project['id']}/versions/1/confirm")
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["active_revision"] == 1
    assert confirmed.json()["status"] == "ready"

    restarted = map_env.reopen()
    reread = restarted.get(f"/api/maps/{project['id']}").json()
    assert reread["active_revision"] == 1
    assert reread["versions"][0]["revision"] == 1
    assert (map_env.tmp_path / "map_assets" / str(novel_id) / str(project["id"]) / "r1.png").exists()


def test_unconfirmed_draft_does_not_replace_confirmed_version(map_env, monkeypatch) -> None:
    monkeypatch.setattr(maps_service, "download_image", lambda url: (IMAGE_BYTES, "png"))
    novel_id = _novel(map_env)
    project = _project(map_env, novel_id)
    _generate(map_env, project["id"], prompt="第一版")
    map_env.client.post(f"/api/maps/{project['id']}/versions/1/confirm")

    second = _generate(map_env, project["id"], prompt="第二版")
    assert second.status_code == 200, second.text
    detail = map_env.client.get(f"/api/maps/{project['id']}").json()
    assert detail["active_revision"] == 1
    assert [(item["revision"], item["status"]) for item in detail["versions"]] == [
        (2, "draft"),
        (1, "confirmed"),
    ]

    promoted = map_env.client.post(f"/api/maps/{project['id']}/versions/2/confirm").json()
    assert promoted["active_revision"] == 2
    assert [(item["revision"], item["status"]) for item in promoted["versions"]] == [
        (2, "confirmed"),
        (1, "superseded"),
    ]


def test_generate_requires_explicit_billing_confirmation(map_env) -> None:
    novel_id = _novel(map_env)
    project = _project(map_env, novel_id)

    for body in ({"prompt": "雾城地图"}, {"prompt": "雾城地图", "confirm_billing": False}):
        response = map_env.client.post(f"/api/maps/{project['id']}/versions", json=body)
        assert response.status_code == 422

    assert map_env.llm.calls == []
    detail = map_env.client.get(f"/api/maps/{project['id']}").json()
    assert detail["revision"] == 0
    assert detail["versions"] == []


def test_missing_image_model_is_rejected_before_any_billing(map_env) -> None:
    map_env.llm.unavailable = True
    novel_id = _novel(map_env)
    project = _project(map_env, novel_id)

    response = _generate(map_env, project["id"])

    assert response.status_code == 409
    assert map_env.llm.billing_calls == 0
    assert map_env.client.get(f"/api/maps/{project['id']}").json()["versions"] == []


def test_download_failure_retries_twice_then_leaves_no_version(map_env, monkeypatch) -> None:
    attempts: list[str] = []

    def failing_download(url: str):
        attempts.append(url)
        raise OSError("image host unreachable")

    monkeypatch.setattr(maps_service, "download_image", failing_download)
    novel_id = _novel(map_env)
    project = _project(map_env, novel_id)

    response = _generate(map_env, project["id"])

    assert response.status_code == 502, response.text
    assert "req-map-1" in response.json()["detail"]
    assert len(attempts) == 3
    detail = map_env.client.get(f"/api/maps/{project['id']}").json()
    assert detail["revision"] == 0
    assert detail["versions"] == []
    assert not (map_env.tmp_path / "map_assets" / str(novel_id) / str(project["id"])).exists()


def test_download_survives_malformed_no_proxy(monkeypatch) -> None:
    """This machine's NO_PROXY ends with `[::1]`, which httpx 0.27 cannot parse."""

    payload = IMAGE_BYTES

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self) -> None:
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args) -> None:
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        monkeypatch.setenv("NO_PROXY", "localhost,127.0.0.1,[::1],::1")
        monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:9")
        monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:9")
        data, ext = maps_service.download_image(
            f"http://127.0.0.1:{server.server_port}/map.png"
        )
    finally:
        server.shutdown()
        server.server_close()

    assert data == payload
    assert ext == "png"


def test_prompt_uses_blueprint_arc_and_chapter_brief(map_env) -> None:
    novel_id = _novel(map_env)
    with map_env.session() as session:
        session.add(
            PlanningBlueprint(
                novel_id=novel_id,
                main_line="寻找失落灯塔",
                ending="灯塔重新点亮",
                core_conflicts="雾港议会与守塔人",
                themes="记忆与守望",
            )
        )
        arc = ArcPlan(
            novel_id=novel_id,
            title="雾港夜航",
            start_chapter=1,
            end_chapter=5,
            objective="护送信使穿过雾港",
            conflict="议会封锁航道",
        )
        session.add(arc)
        session.commit()
        session.refresh(arc)
        session.add(
            ChapterBrief(
                novel_id=novel_id,
                arc_plan_id=arc.id,
                chapter_number=2,
                goal="交出灯塔钥匙",
                events="信使在钟楼换船",
                characters=["信使", "守塔人"],
            )
        )
        session.commit()
        arc_id = arc.id

    response = map_env.client.get(
        f"/api/novels/{novel_id}/maps/prompt",
        params={"arc_id": arc_id, "chapter_number": 2},
    )

    assert response.status_code == 200, response.text
    prompt = response.json()["prompt"]
    assert "寻找失落灯塔" in prompt
    assert "护送信使穿过雾港" in prompt
    assert "交出灯塔钥匙" in prompt
    assert "雾港夜航" in prompt

    missing = map_env.client.get(
        f"/api/novels/{novel_id}/maps/prompt", params={"arc_id": 9999}
    )
    assert missing.status_code == 404


def test_invalid_size_or_prompt_is_rejected_before_billing(map_env) -> None:
    novel_id = _novel(map_env)
    project = _project(map_env, novel_id)

    assert _generate(map_env, project["id"], size="4096x4096").status_code == 422
    assert _generate(map_env, project["id"], prompt="   ").status_code == 422
    assert _generate(map_env, project["id"], prompt="地" * 12_001).status_code == 422
    assert map_env.llm.calls == []


def test_rename_and_delete_map_removes_files_and_rows(map_env, monkeypatch) -> None:
    monkeypatch.setattr(maps_service, "download_image", lambda url: (IMAGE_BYTES, "png"))
    novel_id = _novel(map_env)
    project = _project(map_env, novel_id)
    _generate(map_env, project["id"])
    folder = map_env.tmp_path / "map_assets" / str(novel_id) / str(project["id"])
    assert folder.exists()

    renamed = map_env.client.put(f"/api/maps/{project['id']}", json={"name": "雾城航线图"})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "雾城航线图"
    assert map_env.client.put(f"/api/maps/{project['id']}", json={"name": "  "}).status_code == 422
    listed = map_env.client.get(f"/api/novels/{novel_id}/maps").json()
    assert [item["name"] for item in listed] == ["雾城航线图"]

    deleted = map_env.client.delete(f"/api/maps/{project['id']}")
    assert deleted.status_code == 204
    assert map_env.client.get(f"/api/maps/{project['id']}").status_code == 404
    assert not folder.exists()
    with map_env.session() as session:
        assert session.exec(select(MapTile)).all() == []


def test_delete_novel_removes_map_project_tiles_and_assets(map_env, monkeypatch) -> None:
    monkeypatch.setattr(maps_service, "download_image", lambda url: (IMAGE_BYTES, "png"))
    novel_id = _novel(map_env)
    project = _project(map_env, novel_id)
    _generate(map_env, project["id"])
    novel_folder = map_env.tmp_path / "map_assets" / str(novel_id)
    assert novel_folder.exists()

    response = map_env.client.delete(f"/api/novels/{novel_id}")

    assert response.status_code == 204, response.text
    assert map_env.client.get(f"/api/maps/{project['id']}").status_code == 404
    assert not novel_folder.exists()
    with map_env.session() as session:
        assert session.exec(select(MapTile)).all() == []


def _use_downloads(map_env, monkeypatch) -> None:
    monkeypatch.setattr(
        maps_service, "download_image", lambda url: map_env.downloads["next"]
    )


def _expand(map_env, project_id: int, parent: int, **payload) -> object:
    body = {
        "parent_revision": parent,
        "edge": "east",
        "prompt": "向东扩展雾城海岸",
        "confirm_billing": True,
    }
    body.update(payload)
    return map_env.client.post(f"/api/maps/{project_id}/expand", json=body)


def _regenerate(map_env, project_id: int, x: int, y: int, **payload) -> object:
    body = {"parent_revision": 1, "prompt": "重绘这一格", "confirm_billing": True}
    body.update(payload)
    return map_env.client.post(
        f"/api/maps/{project_id}/cells/{x}/{y}/regenerate", json=body
    )


def test_expand_east_creates_a_draft_and_keeps_every_old_pixel(map_env, monkeypatch) -> None:
    base = _png(1024, 1024, (10, 20, 30))
    map_env.downloads["next"] = (base, "png")
    _use_downloads(map_env, monkeypatch)
    novel_id = _novel(map_env)
    project = _project(map_env, novel_id)
    _generate(map_env, project["id"], size="1024x1024", prompt="底图")
    map_env.client.post(f"/api/maps/{project['id']}/versions/1/confirm")

    response = _expand(map_env, project["id"], 1)

    assert response.status_code == 200, response.text
    detail = response.json()
    assert detail["active_revision"] == 1
    assert [(item["revision"], item["status"]) for item in detail["versions"]] == [
        (2, "draft"),
        (1, "confirmed"),
    ]
    version = detail["versions"][0]
    assert version["width"] == 2048
    assert version["height"] == 1024
    assert version["cols"] == 2
    assert version["rows"] == 1
    assert version["cell"] == 1024
    assert version["operation"] == {"kind": "expand", "edge": "east"}
    assert version["parent_revision"] == 1
    assert version["request_id"] == "req-edit-1"

    saved = (
        map_env.tmp_path / "map_assets" / str(novel_id) / str(project["id"]) / "r2.png"
    )
    image = _open(saved.read_bytes())
    assert image.size == (2048, 1024)
    assert image.getpixel((0, 0)) == (10, 20, 30)
    assert image.getpixel((1023, 1023)) == (10, 20, 30)
    assert image.getpixel((1500, 500)) == (200, 0, 0)

    assert len(map_env.edit.calls) == 1
    prompt = map_env.edit.calls[0]["prompt"]
    assert "白色遮罩" in prompt
    assert "向东" in prompt
    assert "雾城海岸" in prompt

    promoted = map_env.client.post(f"/api/maps/{project['id']}/versions/2/confirm").json()
    assert promoted["active_revision"] == 2
    assert [(item["revision"], item["status"]) for item in promoted["versions"]] == [
        (2, "confirmed"),
        (1, "superseded"),
    ]


def test_regenerate_cell_leaves_the_other_three_cells_untouched(map_env, monkeypatch) -> None:
    map_env.downloads["next"] = (_png(2048, 2048, (60, 70, 80)), "png")
    _use_downloads(map_env, monkeypatch)
    novel_id = _novel(map_env)
    project = _project(map_env, novel_id)
    _generate(map_env, project["id"], size="2048x2048", prompt="底图")
    map_env.client.post(f"/api/maps/{project['id']}/versions/1/confirm")

    response = _regenerate(map_env, project["id"], 1, 1, parent_revision=1)

    assert response.status_code == 200, response.text
    detail = response.json()
    version = detail["versions"][0]
    assert version["revision"] == 2
    assert version["status"] == "draft"
    assert version["operation"] == {"kind": "regenerate", "cell": [1, 1]}
    assert version["cols"] == 2 and version["rows"] == 2
    assert detail["active_revision"] == 1

    saved = (
        map_env.tmp_path / "map_assets" / str(novel_id) / str(project["id"]) / "r2.png"
    )
    image = _open(saved.read_bytes())
    assert image.getpixel((10, 10)) == (60, 70, 80)
    assert image.getpixel((1024 + 10, 10)) == (60, 70, 80)
    assert image.getpixel((10, 1024 + 10)) == (60, 70, 80)
    assert image.getpixel((1024 + 10, 1024 + 10)) == (200, 0, 0)
    assert len(map_env.edit.calls) == 1


def test_expand_requires_billing_confirmation_before_any_provider_call(
    map_env, monkeypatch
) -> None:
    map_env.downloads["next"] = (_png(1024, 1024), "png")
    _use_downloads(map_env, monkeypatch)
    novel_id = _novel(map_env)
    project = _project(map_env, novel_id)
    _generate(map_env, project["id"], size="1024x1024")

    for body in (
        {"parent_revision": 1, "edge": "east", "prompt": "扩展"},
        {
            "parent_revision": 1,
            "edge": "east",
            "prompt": "扩展",
            "confirm_billing": False,
        },
    ):
        response = map_env.client.post(f"/api/maps/{project['id']}/expand", json=body)
        assert response.status_code == 422

    assert map_env.edit.calls == []
    assert len(map_env.client.get(f"/api/maps/{project['id']}").json()["versions"]) == 1


def test_expand_rejects_missing_parent_and_non_square_canvas(map_env, monkeypatch) -> None:
    map_env.downloads["next"] = (_png(1024, 1536), "png")
    _use_downloads(map_env, monkeypatch)
    novel_id = _novel(map_env)
    project = _project(map_env, novel_id)
    _generate(map_env, project["id"], size="1024x1536")
    map_env.client.post(f"/api/maps/{project['id']}/versions/1/confirm")

    missing = _expand(map_env, project["id"], 999)
    assert missing.status_code == 404

    non_square = _expand(map_env, project["id"], 1)
    assert non_square.status_code == 422
    assert "1024" in non_square.json()["detail"]
    assert map_env.edit.calls == []


def test_expand_rejects_a_wrong_provider_size_without_saving(map_env, monkeypatch) -> None:
    map_env.downloads["next"] = (_png(1024, 1024), "png")
    _use_downloads(map_env, monkeypatch)
    novel_id = _novel(map_env)
    project = _project(map_env, novel_id)
    _generate(map_env, project["id"], size="1024x1024")
    map_env.edit.override_size = (1024, 1024)

    response = _expand(map_env, project["id"], 1)

    assert response.status_code == 502, response.text
    detail = map_env.client.get(f"/api/maps/{project['id']}").json()
    assert len(detail["versions"]) == 1
    assert not (
        map_env.tmp_path / "map_assets" / str(novel_id) / str(project["id"]) / "r2.png"
    ).exists()


def test_expand_stops_at_four_columns(map_env, monkeypatch) -> None:
    map_env.downloads["next"] = (_png(1024, 1024), "png")
    _use_downloads(map_env, monkeypatch)
    novel_id = _novel(map_env)
    project = _project(map_env, novel_id)
    _generate(map_env, project["id"], size="1024x1024")

    parent = 1
    for _ in range(3):
        response = _expand(map_env, project["id"], parent)
        assert response.status_code == 200, response.text
        parent = response.json()["versions"][0]["revision"]

    blocked = _expand(map_env, project["id"], parent)
    assert blocked.status_code == 422
    assert "4" in blocked.json()["detail"]
    assert len(map_env.edit.calls) == 3
    assert len(map_env.client.get(f"/api/maps/{project['id']}").json()["versions"]) == 4


def test_expand_maps_unavailable_provider_to_409(map_env, monkeypatch) -> None:
    map_env.downloads["next"] = (_png(1024, 1024), "png")
    _use_downloads(map_env, monkeypatch)
    novel_id = _novel(map_env)
    project = _project(map_env, novel_id)
    _generate(map_env, project["id"], size="1024x1024")
    map_env.edit.unavailable = True

    response = _expand(map_env, project["id"], 1)

    assert response.status_code == 409
    assert len(map_env.client.get(f"/api/maps/{project['id']}").json()["versions"]) == 1


def test_download_failure_retries_download_but_never_the_paid_submit(
    map_env, monkeypatch
) -> None:
    map_env.downloads["next"] = (_png(1024, 1024), "png")
    _use_downloads(map_env, monkeypatch)
    attempts: list[str] = []

    def failing_download(url: str):
        attempts.append(url)
        raise OSError("image host unreachable")

    novel_id = _novel(map_env)
    project = _project(map_env, novel_id)
    _generate(map_env, project["id"], size="1024x1024")
    monkeypatch.setattr(maps_service, "download_image", failing_download)
    map_env.edit.downloads["next"] = (_png(1024, 1024), "png")

    response = _expand(map_env, project["id"], 1)

    assert response.status_code == 502, response.text
    assert len(map_env.edit.calls) == 1
    assert len(attempts) == 3
    assert len(map_env.client.get(f"/api/maps/{project['id']}").json()["versions"]) == 1
