"""Basic map library: one image per revision, stored beside the SQLite file.

The provider hands back a 24-hour URL, so every generated image is downloaded
immediately - the local file, not the URL, is what the map detail page reads.
"""

from __future__ import annotations

import os
import re
import shutil
from pathlib import Path
from typing import Any

import httpx
from sqlmodel import Session, select

from app.models import (
    ArcPlan,
    ChapterBrief,
    MapProject,
    MapTile,
    Novel,
    PlanningBlueprint,
    utc_now,
)
from app.services import map_canvas
from app.services.storage import database_file

IMAGE_SIZES = {"1024x1024", "1024x1536", "1536x1024", "2048x2048"}
MEDIA_EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
}
SAFE_NAME = re.compile(r'[\\/:*?"<>|\s]+')


class MapError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def assets_root(session: Session) -> Path | None:
    database = database_file(session)
    return database.parent / "map_assets" if database else None


def require_assets_root(session: Session) -> Path:
    root = assets_root(session)
    if root is None:
        raise MapError(503, "地图图片需要文件数据库（当前是内存库）")
    return root


def _proxy_for(url: str) -> str | None:
    parsed = httpx.URL(url)
    if parsed.host in {"localhost", "127.0.0.1", "::1"}:
        return None
    name = "HTTPS_PROXY" if parsed.scheme == "https" else "HTTP_PROXY"
    return os.getenv(name) or os.getenv(name.lower()) or os.getenv("ALL_PROXY")


def download_image(url: str) -> tuple[bytes, str]:
    # trust_env=False because httpx 0.27 dies parsing this machine's NO_PROXY ("[::1]")
    # before the request starts. Read the proxy here instead; loopback stays direct.
    with httpx.Client(
        proxy=_proxy_for(url), trust_env=False, timeout=60, follow_redirects=True
    ) as client:
        response = client.get(url)
        response.raise_for_status()
        content = response.content
        if not content:
            raise ValueError("empty image body")
        media = response.headers.get("content-type", "").split(";")[0].strip().lower()
        return content, MEDIA_EXTENSIONS.get(media, "png")


def fetch_image(url: str, *, request_id: str) -> tuple[bytes, str]:
    """Three attempts total. Failure leaves nothing on disk and no revision row."""
    last = ""
    for _ in range(3):
        try:
            return download_image(url)
        except (httpx.HTTPError, OSError, ValueError) as cause:
            last = str(cause)
    raise MapError(
        502,
        f"地图图片下载失败（provider request {request_id or 'unknown'}）：{last}",
    )


def save_image(session: Session, project: MapProject, revision: int, data: bytes, ext: str) -> str:
    root = require_assets_root(session)
    relative = f"{project.novel_id}/{project.id}/r{revision}.{ext}"
    target = root / relative
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    except OSError as cause:
        raise MapError(500, f"地图图片写不进本机目录：{cause}") from cause
    return relative


def remove_project_assets(session: Session, project: MapProject) -> None:
    root = assets_root(session)
    if root is None:
        return
    shutil.rmtree(root / str(project.novel_id) / str(project.id), ignore_errors=True)


def remove_novel_assets(session: Session, novel_id: int) -> None:
    root = assets_root(session)
    if root is None:
        return
    shutil.rmtree(root / str(novel_id), ignore_errors=True)


def delete_novel_maps(session: Session, novel_id: int) -> None:
    project_ids = [
        int(pid)
        for pid in session.exec(
            select(MapProject.id).where(MapProject.novel_id == novel_id)
        ).all()
    ]
    if not project_ids:
        return
    for tile in session.exec(
        select(MapTile).where(MapTile.map_project_id.in_(project_ids))
    ).all():
        session.delete(tile)
    for project in session.exec(
        select(MapProject).where(MapProject.novel_id == novel_id)
    ).all():
        session.delete(project)
    session.flush()


def project_or_404(session: Session, map_id: int) -> MapProject:
    project = session.get(MapProject, map_id)
    if project is None:
        raise MapError(404, "地图不存在")
    return project


def novel_or_404(session: Session, novel_id: int) -> Novel:
    novel = session.get(Novel, novel_id)
    if novel is None:
        raise MapError(404, "Novel not found")
    return novel


def tile_or_404(session: Session, project: MapProject, revision: int) -> MapTile:
    tile = session.exec(
        select(MapTile).where(
            MapTile.map_project_id == project.id,
            MapTile.revision == revision,
        )
    ).first()
    if tile is None:
        raise MapError(404, "这个版本不存在")
    return tile


def versions(session: Session, project: MapProject) -> list[MapTile]:
    return list(
        session.exec(
            select(MapTile)
            .where(MapTile.map_project_id == project.id)
            .order_by(MapTile.revision.desc())
        ).all()
    )


def active_revision(session: Session, project: MapProject) -> int | None:
    row = session.exec(
        select(MapTile)
        .where(
            MapTile.map_project_id == project.id,
            MapTile.status == "confirmed",
        )
        .order_by(MapTile.revision.desc())
    ).first()
    return int(row.revision) if row else None


def next_revision(session: Session, project: MapProject) -> int:
    latest = session.exec(
        select(MapTile.revision)
        .where(MapTile.map_project_id == project.id)
        .order_by(MapTile.revision.desc())
    ).first()
    return int(latest or 0) + 1


def create_project(session: Session, novel: Novel, name: str) -> MapProject:
    project = MapProject(novel_id=int(novel.id), name=name, revision=0, settings={})
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


def build_prompt(
    session: Session,
    novel: Novel,
    *,
    arc_id: int | None = None,
    chapter_number: int | None = None,
) -> str:
    blueprint = session.exec(
        select(PlanningBlueprint)
        .where(
            PlanningBlueprint.novel_id == novel.id,
            PlanningBlueprint.is_active == True,  # noqa: E712
        )
        .order_by(PlanningBlueprint.version.desc())
    ).first()
    arc = None
    if arc_id is not None:
        arc = session.get(ArcPlan, arc_id)
        if arc is None or int(arc.novel_id) != int(novel.id):
            raise MapError(404, "这一卷不存在")
    brief = None
    if chapter_number is not None:
        brief = session.exec(
            select(ChapterBrief).where(
                ChapterBrief.novel_id == novel.id,
                ChapterBrief.chapter_number == chapter_number,
            )
        ).first()

    lines: list[str] = [f"请为《{novel.title}》绘制一张世界地图。", ""]
    if blueprint:
        blocks = [
            ("故事主线", blueprint.main_line),
            ("结局", blueprint.ending),
            ("核心冲突", blueprint.core_conflicts),
            ("主题", blueprint.themes),
            ("约束", blueprint.constraints),
        ]
        lines.append("【故事设定】")
        lines.extend(f"{label}：{value}" for label, value in blocks if value.strip())
        lines.append("")
    if arc:
        lines.append(
            f"【本卷】第 {arc.start_chapter}-{arc.end_chapter} 章《{arc.title}》"
        )
        blocks = [
            ("目标", arc.objective),
            ("冲突", arc.conflict),
            ("收束", arc.resolution),
        ]
        lines.extend(f"{label}：{value}" for label, value in blocks if value.strip())
        lines.append("")
    if brief:
        lines.append(f"【本章】第 {brief.chapter_number} 章")
        blocks = [
            ("目标", brief.goal),
            ("事件", brief.events),
            ("视角", brief.pov),
            ("人物", "、".join(brief.characters)),
            ("冲突", brief.conflict),
            ("钩子", brief.hook),
            ("必需事实", "；".join(brief.required_facts)),
        ]
        lines.extend(f"{label}：{value}" for label, value in blocks if value.strip())
        lines.append("")
    lines.append("【画面要求】")
    lines.append("俯视图，清晰的地形与海岸线，标注主要地点名称；不要照片质感，不要拼贴文字。")
    return "\n".join(lines).strip()


def read_tile_image(session: Session, tile: MapTile) -> bytes:
    if not tile.image_path:
        raise MapError(404, "这个版本没有图片")
    root = require_assets_root(session)
    path = (root / tile.image_path).resolve()
    if root.resolve() not in path.parents or not path.is_file():
        raise MapError(404, "地图图片已丢失")
    return path.read_bytes()


EDGE_LABELS = {"east": "向东", "west": "向西", "north": "向北", "south": "向南"}


def edit_prompt(prompt: str, operation: dict[str, Any]) -> str:
    """The provider sees the mask as white=repaint, black=keep, so the rule is explicit."""
    if operation.get("kind") == "expand":
        direction = EDGE_LABELS.get(str(operation.get("edge")))
        if direction is None:
            raise MapError(422, "扩展方向只能是 east / west / north / south")
        rule = (
            f"只补全白色遮罩区域，{direction}扩展一格，让地形、海岸线、道路和水系"
            "与相邻区域自然衔接。黑色遮罩区域必须保持原样，不要重绘，不要加边框或文字。"
        )
    else:
        x, y = operation.get("cell") or (0, 0)
        rule = (
            f"只重绘白色遮罩区域（第 {int(x) + 1} 列第 {int(y) + 1} 行），"
            "保持它与相邻区域的地形、海岸线、道路和水系自然衔接。"
            "黑色遮罩区域必须保持原样，不要重绘，不要加边框或文字。"
        )
    return f"{rule}\n{prompt.strip()}"


def save_edit_revision(
    session: Session,
    project: MapProject,
    *,
    revision: int,
    data: bytes,
    info: map_canvas.CanvasInfo,
    prompt: str,
    model: str,
    request_id: str,
    usage: dict[str, Any],
    operation: dict[str, Any],
    parent_revision: int,
) -> MapTile:
    relative = save_image(session, project, revision, data, "png")
    tile = MapTile(
        map_project_id=int(project.id),
        x=0,
        y=0,
        revision=revision,
        status="draft",
        image_path=relative,
        prompt=prompt,
        provider=model,
        metadata_json={
            **map_canvas.grid_metadata(info),
            "request_id": request_id,
            "usage": usage,
            "operation": operation,
            "parent_revision": parent_revision,
        },
    )
    project.revision = revision
    project.updated_at = utc_now()
    session.add(tile)
    session.add(project)
    session.commit()
    session.refresh(tile)
    return tile


def update_project(session: Session, project: MapProject, *, name: str | None = None) -> MapProject:
    if name is not None:
        project.name = name
    project.updated_at = utc_now()
    session.add(project)
    session.commit()
    session.refresh(project)
    return project
