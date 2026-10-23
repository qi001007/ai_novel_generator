"""M-01 canvas geometry: one 1024 block at a time, masked redraw, exact old pixels.

No feathering and no resampling live here on purpose. The provider only fills the
white mask; everything outside it is pasted back from the parent revision.
"""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from typing import Any

from PIL import Image, ImageDraw, ImageOps

CELL = 1024
MAX_COLS = 4
MAX_ROWS = 4
EDGES = ("east", "west", "north", "south")
NEUTRAL = (128, 128, 128)


class CanvasError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


@dataclass(frozen=True)
class CanvasInfo:
    width: int
    height: int
    cols: int
    rows: int
    cell: int = CELL

    def __post_init__(self) -> None:
        if self.cell != CELL:
            raise CanvasError(422, f"分块扩图只支持 {CELL} 像素方格")
        if not (1 <= self.cols <= MAX_COLS and 1 <= self.rows <= MAX_ROWS):
            raise CanvasError(422, f"地图最多 {MAX_COLS}×{MAX_ROWS} 格")
        if self.width != self.cols * self.cell or self.height != self.rows * self.cell:
            raise CanvasError(422, "地图版本网格信息不一致")


@dataclass(frozen=True)
class Expansion:
    canvas: bytes
    mask: bytes
    offset: tuple[int, int]
    info: CanvasInfo
    operation: dict[str, Any]


def _encode(image: Image.Image, fmt: str) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format=fmt)
    return buffer.getvalue()


def _open(data: bytes) -> Image.Image:
    try:
        return Image.open(BytesIO(data)).convert("RGB")
    except OSError as cause:
        raise CanvasError(422, "图片无法解析") from cause


def grid_metadata(info: CanvasInfo) -> dict[str, Any]:
    return {
        "width": info.width,
        "height": info.height,
        "cols": info.cols,
        "rows": info.rows,
        "cell": info.cell,
        "size": f"{info.width}x{info.height}",
    }


def info_from_metadata(metadata: dict[str, Any] | None) -> CanvasInfo:
    data = metadata or {}
    width = data.get("width")
    height = data.get("height")
    cols = data.get("cols")
    rows = data.get("rows")
    cell = data.get("cell")
    if all(isinstance(value, int) for value in (width, height, cols, rows, cell)):
        return CanvasInfo(width=width, height=height, cols=cols, rows=rows, cell=cell)

    size = str(data.get("size") or "").strip().lower()
    try:
        width, height = (int(part) for part in size.split("x", 1))
    except (ValueError, TypeError) as cause:
        raise CanvasError(422, "地图版本缺少可用的尺寸信息") from cause
    if width % CELL or height % CELL:
        raise CanvasError(
            422,
            f"分块扩图需要 {CELL} 对齐的方图（当前 {width}x{height}），请先生成 1:1 底图",
        )
    return CanvasInfo(
        width=width,
        height=height,
        cols=width // CELL,
        rows=height // CELL,
        cell=CELL,
    )


def expand_canvas(base: bytes, info: CanvasInfo, edge: str) -> Expansion:
    if edge not in EDGES:
        raise CanvasError(422, "扩展方向只能是 east / west / north / south")
    source = _open(base)
    if source.size != (info.width, info.height):
        raise CanvasError(422, "父版本图片尺寸与网格信息不一致")

    if edge in {"east", "west"}:
        if info.cols >= MAX_COLS:
            raise CanvasError(422, f"地图最多 {MAX_COLS} 列，不能再向外扩展")
        width = info.width + CELL
        height = info.height
    else:
        if info.rows >= MAX_ROWS:
            raise CanvasError(422, f"地图最多 {MAX_ROWS} 行，不能再向外扩展")
        width = info.width
        height = info.height + CELL

    offset = {
        "east": (0, 0),
        "south": (0, 0),
        "west": (CELL, 0),
        "north": (0, CELL),
    }[edge]
    canvas = Image.new("RGB", (width, height), NEUTRAL)
    canvas.paste(source, offset)

    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    if edge == "east":
        draw.rectangle((info.width, 0, width, height), fill=255)
    elif edge == "west":
        draw.rectangle((0, 0, CELL, height), fill=255)
    elif edge == "south":
        draw.rectangle((0, info.height, width, height), fill=255)
    else:
        draw.rectangle((0, 0, width, CELL), fill=255)

    new_info = CanvasInfo(
        width=width,
        height=height,
        cols=width // CELL,
        rows=height // CELL,
        cell=CELL,
    )
    return Expansion(
        canvas=_encode(canvas, "PNG"),
        mask=_encode(mask, "PNG"),
        offset=offset,
        info=new_info,
        operation={"kind": "expand", "edge": edge},
    )


def cell_mask(info: CanvasInfo, x: int, y: int) -> bytes:
    if not isinstance(x, int) or not isinstance(y, int) or x < 0 or y < 0:
        raise CanvasError(422, "格子坐标必须是非负整数")
    if x >= info.cols or y >= info.rows:
        raise CanvasError(422, "这个格子不在当前地图范围内")
    mask = Image.new("L", (info.width, info.height), 0)
    ImageDraw.Draw(mask).rectangle(
        (x * CELL, y * CELL, (x + 1) * CELL, (y + 1) * CELL), fill=255
    )
    return _encode(mask, "PNG")


def composite_outside_mask(
    generated: bytes,
    original: bytes,
    mask: bytes,
    *,
    offset: tuple[int, int],
    expected_size: tuple[int, int],
) -> bytes:
    result = _open(generated)
    if result.size != expected_size:
        raise CanvasError(
            502,
            f"供应商返回尺寸 {result.size[0]}x{result.size[1]} 与请求 "
            f"{expected_size[0]}x{expected_size[1]} 不符",
        )
    source = _open(original)
    try:
        keep = ImageOps.invert(Image.open(BytesIO(mask)).convert("L"))
    except OSError as cause:
        raise CanvasError(422, "遮罩无法解析") from cause
    if keep.size != expected_size:
        raise CanvasError(422, "遮罩尺寸与画布不一致")

    x, y = offset
    crop = keep.crop((x, y, x + source.width, y + source.height))
    result.paste(source, offset, crop)
    return _encode(result, "PNG")
