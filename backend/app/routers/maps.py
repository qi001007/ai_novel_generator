"""HTTP surface for the basic map library: one image per revision."""

from __future__ import annotations

import mimetypes
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlmodel import Field, Session, SQLModel, select

from app.db import get_session
from app.models import MapProject, MapTile, utc_now
from app.services import map_canvas
from app.services import maps as maps_service
from app.services.image_edit import (
    DashScopeMaskedEditClient,
    MaskedEditError,
    MaskedEditUnavailable,
    get_masked_edit_client,
)
from app.services.llm import LLMClient, LLMError, LLMUnavailableError, get_llm_client


router = APIRouter(tags=["maps"])


class MapCreateIn(SQLModel):
    name: str


class MapRenameIn(SQLModel):
    name: str


class MapVersionIn(SQLModel):
    prompt: str
    confirm_billing: bool = False
    size: str = "1024x1536"


class MapExpandIn(SQLModel):
    parent_revision: int
    edge: str
    prompt: str = ""
    confirm_billing: bool = False


class MapRegenerateIn(SQLModel):
    parent_revision: int
    prompt: str = ""
    confirm_billing: bool = False


class MapVersionOut(SQLModel):
    revision: int
    status: str
    prompt: str
    model: str
    size: str
    request_id: str
    image_url: str
    created_at: datetime
    width: int = 0
    height: int = 0
    cols: int = 0
    rows: int = 0
    cell: int = 0
    parent_revision: int | None = None
    operation: dict = Field(default_factory=dict)


class MapSummaryOut(SQLModel):
    id: int
    novel_id: int
    name: str
    status: str
    revision: int
    active_revision: int | None
    preview_url: str | None
    created_at: datetime
    updated_at: datetime


class MapDetailOut(MapSummaryOut):
    versions: list[MapVersionOut]


class MapPromptOut(SQLModel):
    prompt: str


def _http(error: maps_service.MapError) -> HTTPException:
    return HTTPException(status_code=error.status_code, detail=error.detail)


def _grid_metadata(size: str) -> dict:
    """Only 1024-aligned canvases can be tiled; anything else stays a plain image."""
    try:
        width, height = (int(part) for part in size.lower().split("x", 1))
    except ValueError:
        return {}
    if width % map_canvas.CELL or height % map_canvas.CELL:
        return {}
    try:
        info = map_canvas.CanvasInfo(
            width=width, height=height, cols=width // map_canvas.CELL, rows=height // map_canvas.CELL
        )
    except map_canvas.CanvasError:
        return {}
    return map_canvas.grid_metadata(info)


def _clean_edit_prompt(value: str) -> str:
    prompt = (value or "").strip()
    if not prompt:
        raise HTTPException(status_code=422, detail="扩图提示词不能为空")
    if len(prompt) > 12_000:
        raise HTTPException(status_code=422, detail="扩图提示词过长")
    return prompt


def _run_edit(
    session: Session,
    project: MapProject,
    parent: MapTile,
    *,
    edit,
    canvas: bytes,
    mask: bytes,
    offset: tuple[int, int],
    info: map_canvas.CanvasInfo,
    operation: dict,
    prompt: str,
) -> MapTile:
    try:
        result = edit.edit(
            image=canvas, mask=mask, prompt=maps_service.edit_prompt(prompt, operation)
        )
    except MaskedEditUnavailable as cause:
        raise HTTPException(status_code=409, detail=str(cause)) from cause
    except MaskedEditError as cause:
        raise HTTPException(status_code=502, detail=str(cause)) from cause

    try:
        generated, _ = maps_service.fetch_image(
            result.image_url, request_id=result.request_id
        )
        merged = map_canvas.composite_outside_mask(
            generated,
            canvas,
            mask,
            offset=offset,
            expected_size=(info.width, info.height),
        )
        revision = maps_service.next_revision(session, project)
        return maps_service.save_edit_revision(
            session,
            project,
            revision=revision,
            data=merged,
            info=info,
            prompt=prompt,
            model=result.model,
            request_id=result.request_id,
            usage=result.usage,
            operation=operation,
            parent_revision=int(parent.revision),
        )
    except maps_service.MapError as cause:
        raise _http(cause) from cause
    except map_canvas.CanvasError as cause:
        raise HTTPException(status_code=cause.status_code, detail=cause.detail) from cause


def _clean_name(value: str) -> str:
    name = (value or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail="地图名称不能为空")
    if len(name) > 80:
        raise HTTPException(status_code=422, detail="地图名称最多 80 个字")
    return name


def _version_out(project: MapProject, tile: MapTile) -> MapVersionOut:
    metadata = tile.metadata_json or {}
    parent = metadata.get("parent_revision")
    operation = metadata.get("operation")
    return MapVersionOut(
        revision=int(tile.revision),
        status=tile.status,
        prompt=tile.prompt,
        model=tile.provider,
        size=str(metadata.get("size", "")),
        request_id=str(metadata.get("request_id", "")),
        image_url=f"/api/maps/{project.id}/versions/{tile.revision}/image",
        created_at=tile.created_at,
        width=int(metadata.get("width") or 0),
        height=int(metadata.get("height") or 0),
        cols=int(metadata.get("cols") or 0),
        rows=int(metadata.get("rows") or 0),
        cell=int(metadata.get("cell") or 0),
        parent_revision=int(parent) if isinstance(parent, int) else None,
        operation=operation if isinstance(operation, dict) else {},
    )


def _summary(session: Session, project: MapProject) -> MapSummaryOut:
    active = maps_service.active_revision(session, project)
    latest = session.exec(
        select(MapTile.revision)
        .where(MapTile.map_project_id == project.id)
        .order_by(MapTile.revision.desc())
    ).first()
    preview = active or latest
    return MapSummaryOut(
        id=int(project.id),
        novel_id=int(project.novel_id),
        name=project.name,
        status="ready" if active else "draft",
        revision=int(latest or 0),
        active_revision=active,
        preview_url=(
            f"/api/maps/{project.id}/versions/{preview}/image" if preview else None
        ),
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


def _detail(session: Session, project: MapProject) -> MapDetailOut:
    rows = maps_service.versions(session, project)
    return MapDetailOut(
        **_summary(session, project).model_dump(),
        versions=[_version_out(project, tile) for tile in rows],
    )


@router.get("/novels/{novel_id}/maps", response_model=list[MapSummaryOut])
def list_maps(
    novel_id: int,
    session: Session = Depends(get_session),
) -> list[MapSummaryOut]:
    try:
        maps_service.novel_or_404(session, novel_id)
    except maps_service.MapError as cause:
        raise _http(cause) from cause
    projects = session.exec(
        select(MapProject)
        .where(MapProject.novel_id == novel_id)
        .order_by(MapProject.updated_at.desc(), MapProject.id.desc())
    ).all()
    return [_summary(session, project) for project in projects]


@router.post("/novels/{novel_id}/maps", response_model=MapDetailOut, status_code=201)
def create_map(
    novel_id: int,
    payload: MapCreateIn,
    session: Session = Depends(get_session),
) -> MapDetailOut:
    try:
        novel = maps_service.novel_or_404(session, novel_id)
    except maps_service.MapError as cause:
        raise _http(cause) from cause
    project = maps_service.create_project(session, novel, _clean_name(payload.name))
    return _detail(session, project)


@router.get("/novels/{novel_id}/maps/prompt", response_model=MapPromptOut)
def map_prompt(
    novel_id: int,
    arc_id: int | None = Query(default=None),
    chapter_number: int | None = Query(default=None),
    session: Session = Depends(get_session),
) -> MapPromptOut:
    try:
        novel = maps_service.novel_or_404(session, novel_id)
        prompt = maps_service.build_prompt(
            session, novel, arc_id=arc_id, chapter_number=chapter_number
        )
    except maps_service.MapError as cause:
        raise _http(cause) from cause
    return MapPromptOut(prompt=prompt)


@router.get("/maps/{map_id}", response_model=MapDetailOut)
def get_map(map_id: int, session: Session = Depends(get_session)) -> MapDetailOut:
    try:
        project = maps_service.project_or_404(session, map_id)
    except maps_service.MapError as cause:
        raise _http(cause) from cause
    return _detail(session, project)


@router.put("/maps/{map_id}", response_model=MapDetailOut)
def rename_map(
    map_id: int,
    payload: MapRenameIn,
    session: Session = Depends(get_session),
) -> MapDetailOut:
    try:
        project = maps_service.project_or_404(session, map_id)
    except maps_service.MapError as cause:
        raise _http(cause) from cause
    maps_service.update_project(session, project, name=_clean_name(payload.name))
    return _detail(session, project)


@router.delete("/maps/{map_id}", status_code=204, response_model=None)
def delete_map(map_id: int, session: Session = Depends(get_session)) -> None:
    try:
        project = maps_service.project_or_404(session, map_id)
    except maps_service.MapError as cause:
        raise _http(cause) from cause
    for tile in maps_service.versions(session, project):
        session.delete(tile)
    session.delete(project)
    session.commit()
    maps_service.remove_project_assets(session, project)
    return None


@router.post("/maps/{map_id}/versions", response_model=MapVersionOut)
def generate_version(
    map_id: int,
    payload: MapVersionIn,
    session: Session = Depends(get_session),
    llm: LLMClient = Depends(get_llm_client),
) -> MapVersionOut:
    try:
        project = maps_service.project_or_404(session, map_id)
    except maps_service.MapError as cause:
        raise _http(cause) from cause
    prompt = (payload.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=422, detail="生图提示词不能为空")
    if len(prompt) > 12_000:
        raise HTTPException(status_code=422, detail="生图提示词过长")
    if payload.size not in maps_service.IMAGE_SIZES:
        raise HTTPException(status_code=422, detail="暂只支持 1K、竖幅、横幅或 2K 预设尺寸")
    if payload.confirm_billing is not True:
        raise HTTPException(status_code=422, detail="生图会产生费用，请先勾选确认")

    try:
        result = llm.generate_image(prompt, size=payload.size)
    except LLMUnavailableError as cause:
        raise HTTPException(status_code=409, detail=str(cause)) from cause
    except LLMError as cause:
        raise HTTPException(status_code=502, detail=str(cause)) from cause
    if not result.urls:
        raise HTTPException(
            status_code=502,
            detail=f"供应商没有返回图片地址（request {result.request_id or 'unknown'}）",
        )

    try:
        data, ext = maps_service.fetch_image(result.urls[0], request_id=result.request_id)
        revision = maps_service.next_revision(session, project)
        relative = maps_service.save_image(session, project, revision, data, ext)
    except maps_service.MapError as cause:
        raise _http(cause) from cause

    tile = MapTile(
        map_project_id=int(project.id),
        x=0,
        y=0,
        revision=revision,
        status="draft",
        image_path=relative,
        prompt=prompt,
        provider=result.model,
        metadata_json={
            "request_id": result.request_id,
            "size": payload.size,
            "usage": result.usage,
            **_grid_metadata(payload.size),
        },
    )
    project.revision = revision
    project.updated_at = utc_now()
    session.add(tile)
    session.add(project)
    session.commit()
    session.refresh(tile)
    return _version_out(project, tile)


@router.post("/maps/{map_id}/versions/{revision}/confirm", response_model=MapDetailOut)
def confirm_version(
    map_id: int,
    revision: int,
    session: Session = Depends(get_session),
) -> MapDetailOut:
    try:
        project = maps_service.project_or_404(session, map_id)
        tile = maps_service.tile_or_404(session, project, revision)
    except maps_service.MapError as cause:
        raise _http(cause) from cause
    for other in maps_service.versions(session, project):
        if other.status == "confirmed" and other.revision != tile.revision:
            other.status = "superseded"
            session.add(other)
    tile.status = "confirmed"
    project.settings = {**(project.settings or {}), "active_revision": int(tile.revision)}
    project.status = "ready"
    project.updated_at = utc_now()
    session.add(tile)
    session.add(project)
    session.commit()
    return _detail(session, project)


@router.post("/maps/{map_id}/expand", response_model=MapDetailOut)
def expand_map(
    map_id: int,
    payload: MapExpandIn,
    session: Session = Depends(get_session),
    edit: DashScopeMaskedEditClient = Depends(get_masked_edit_client),
) -> MapDetailOut:
    try:
        project = maps_service.project_or_404(session, map_id)
        parent = maps_service.tile_or_404(session, project, payload.parent_revision)
        if payload.confirm_billing is not True:
            raise HTTPException(status_code=422, detail="扩图会产生费用，请先勾选确认")
        prompt = _clean_edit_prompt(payload.prompt)
        info = map_canvas.info_from_metadata(parent.metadata_json)
        base = maps_service.read_tile_image(session, parent)
        expansion = map_canvas.expand_canvas(base, info, payload.edge)
    except maps_service.MapError as cause:
        raise _http(cause) from cause
    except map_canvas.CanvasError as cause:
        raise HTTPException(status_code=cause.status_code, detail=cause.detail) from cause

    _run_edit(
        session,
        project,
        parent,
        edit=edit,
        canvas=expansion.canvas,
        mask=expansion.mask,
        offset=expansion.offset,
        info=expansion.info,
        operation=expansion.operation,
        prompt=prompt,
    )
    return _detail(session, project)


@router.post("/maps/{map_id}/cells/{x}/{y}/regenerate", response_model=MapDetailOut)
def regenerate_cell(
    map_id: int,
    x: int,
    y: int,
    payload: MapRegenerateIn,
    session: Session = Depends(get_session),
    edit: DashScopeMaskedEditClient = Depends(get_masked_edit_client),
) -> MapDetailOut:
    try:
        project = maps_service.project_or_404(session, map_id)
        parent = maps_service.tile_or_404(session, project, payload.parent_revision)
        if payload.confirm_billing is not True:
            raise HTTPException(status_code=422, detail="重绘会产生费用，请先勾选确认")
        prompt = _clean_edit_prompt(payload.prompt)
        info = map_canvas.info_from_metadata(parent.metadata_json)
        base = maps_service.read_tile_image(session, parent)
        mask = map_canvas.cell_mask(info, x, y)
    except maps_service.MapError as cause:
        raise _http(cause) from cause
    except map_canvas.CanvasError as cause:
        raise HTTPException(status_code=cause.status_code, detail=cause.detail) from cause

    _run_edit(
        session,
        project,
        parent,
        edit=edit,
        canvas=base,
        mask=mask,
        offset=(0, 0),
        info=info,
        operation={"kind": "regenerate", "cell": [x, y]},
        prompt=prompt,
    )
    return _detail(session, project)


@router.get("/maps/{map_id}/versions/{revision}/image")
def map_image(
    map_id: int,
    revision: int,
    download: bool = False,
    session: Session = Depends(get_session),
) -> FileResponse:
    try:
        project = maps_service.project_or_404(session, map_id)
        tile = maps_service.tile_or_404(session, project, revision)
    except maps_service.MapError as cause:
        raise _http(cause) from cause
    if not tile.image_path:
        raise HTTPException(status_code=404, detail="这个版本没有图片")
    try:
        root = maps_service.require_assets_root(session)
    except maps_service.MapError as cause:
        raise _http(cause) from cause
    path = (root / tile.image_path).resolve()
    if root.resolve() not in path.parents or not path.is_file():
        raise HTTPException(status_code=404, detail="地图图片已丢失")
    media_type = mimetypes.guess_type(path.name)[0] or "image/png"
    filename = None
    if download:
        safe = maps_service.SAFE_NAME.sub("_", project.name).strip("_") or "map"
        filename = f"{safe}-v{revision}{path.suffix}"
    return FileResponse(path, media_type=media_type, filename=filename)
