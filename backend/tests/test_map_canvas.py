"""M-01 画布几何：扩块只涂白新区域，遮罩外逐像素贴回原图。

这些测试不碰网络、不碰数据库；先用纯像素断言把“真无缝”的底线钉住。
"""

from __future__ import annotations

from io import BytesIO

import pytest
from PIL import Image

from app.services import map_canvas

CELL = 1024


def _png(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _solid(width: int, height: int, color: tuple[int, int, int]) -> bytes:
    return _png(Image.new("RGB", (width, height), color))


def _open(data: bytes) -> Image.Image:
    return Image.open(BytesIO(data)).convert("RGB")


def _info(cols: int = 1, rows: int = 1) -> map_canvas.CanvasInfo:
    return map_canvas.CanvasInfo(
        width=cols * CELL, height=rows * CELL, cols=cols, rows=rows, cell=CELL
    )


def test_expand_east_masks_only_the_new_strip() -> None:
    base = _solid(CELL, CELL, (10, 20, 30))

    expansion = map_canvas.expand_canvas(base, _info(), "east")

    assert expansion.info == _info(2, 1)
    assert expansion.offset == (0, 0)
    canvas = _open(expansion.canvas)
    mask = Image.open(BytesIO(expansion.mask)).convert("L")
    assert canvas.size == (CELL * 2, CELL)
    assert canvas.getpixel((5, 5)) == (10, 20, 30)
    assert mask.getpixel((5, 5)) == 0
    assert mask.getpixel((CELL + 5, 5)) == 255


def test_expand_west_offsets_the_old_image_and_masks_the_left_strip() -> None:
    base = _solid(CELL, CELL, (11, 21, 31))

    expansion = map_canvas.expand_canvas(base, _info(), "west")

    assert expansion.info == _info(2, 1)
    assert expansion.offset == (CELL, 0)
    canvas = _open(expansion.canvas)
    mask = Image.open(BytesIO(expansion.mask)).convert("L")
    assert canvas.getpixel((CELL + 5, 5)) == (11, 21, 31)
    assert mask.getpixel((CELL + 5, 5)) == 0
    assert mask.getpixel((5, 5)) == 255


def test_expand_north_offsets_the_old_image_and_masks_the_top_strip() -> None:
    base = _solid(CELL, CELL, (12, 22, 32))

    expansion = map_canvas.expand_canvas(base, _info(), "north")

    assert expansion.info == _info(1, 2)
    assert expansion.offset == (0, CELL)
    assert _open(expansion.canvas).getpixel((5, CELL + 5)) == (12, 22, 32)
    mask = Image.open(BytesIO(expansion.mask)).convert("L")
    assert mask.getpixel((5, 5)) == 255
    assert mask.getpixel((5, CELL + 5)) == 0


def test_composite_restores_every_original_pixel_outside_the_mask() -> None:
    original = _png(
        Image.new("RGB", (CELL, CELL), (30, 40, 50))
    )
    generated = _solid(CELL * 2, CELL, (200, 10, 10))
    expansion = map_canvas.expand_canvas(original, _info(), "east")

    merged = map_canvas.composite_outside_mask(
        generated,
        original,
        expansion.mask,
        offset=expansion.offset,
        expected_size=(CELL * 2, CELL),
    )

    image = _open(merged)
    assert image.size == (CELL * 2, CELL)
    assert image.getpixel((0, 0)) == (30, 40, 50)
    assert image.getpixel((CELL - 1, CELL - 1)) == (30, 40, 50)
    assert image.getpixel((CELL, 0)) == (200, 10, 10)


def test_composite_keeps_neighbours_when_one_cell_is_redrawn() -> None:
    original = _solid(CELL * 2, CELL * 2, (60, 70, 80))
    generated = _solid(CELL * 2, CELL * 2, (5, 200, 5))
    mask = map_canvas.cell_mask(_info(2, 2), 1, 1)

    merged = map_canvas.composite_outside_mask(
        generated,
        original,
        mask,
        offset=(0, 0),
        expected_size=(CELL * 2, CELL * 2),
    )

    image = _open(merged)
    assert image.getpixel((10, 10)) == (60, 70, 80)
    assert image.getpixel((CELL + 10, CELL + 10)) == (5, 200, 5)
    assert image.getpixel((CELL * 2 - 1, CELL * 2 - 1)) == (5, 200, 5)


def test_cell_mask_covers_exactly_the_selected_cell() -> None:
    mask = Image.open(BytesIO(map_canvas.cell_mask(_info(2, 2), 0, 1))).convert("L")

    assert mask.getpixel((5, CELL + 5)) == 255
    assert mask.getpixel((5, 5)) == 0
    assert mask.getpixel((CELL + 5, CELL + 5)) == 0


def test_rejects_expansion_past_the_four_by_four_cap() -> None:
    with pytest.raises(map_canvas.CanvasError) as caught:
        map_canvas.expand_canvas(_solid(CELL * 4, CELL, (0, 0, 0)), _info(4, 1), "east")

    assert caught.value.status_code == 422
    assert "4" in caught.value.detail


def test_rejects_out_of_bounds_cell() -> None:
    with pytest.raises(map_canvas.CanvasError):
        map_canvas.cell_mask(_info(2, 2), 2, 0)
    with pytest.raises(map_canvas.CanvasError):
        map_canvas.cell_mask(_info(2, 2), 0, -1)


def test_composite_rejects_a_wrong_provider_size_instead_of_resizing() -> None:
    original = _solid(CELL, CELL, (1, 2, 3))
    expansion = map_canvas.expand_canvas(original, _info(), "east")

    with pytest.raises(map_canvas.CanvasError) as caught:
        map_canvas.composite_outside_mask(
            _solid(CELL, CELL, (9, 9, 9)),
            original,
            expansion.mask,
            offset=expansion.offset,
            expected_size=(CELL * 2, CELL),
        )

    assert caught.value.status_code == 502
    assert "尺寸" in caught.value.detail


def test_legacy_metadata_infers_grid_and_rejects_non_square_canvas() -> None:
    square = map_canvas.info_from_metadata({"size": "1024x1024"})
    assert square == _info(1, 1)

    tiled = map_canvas.info_from_metadata(
        {"size": "2048x1024", "width": 2048, "height": 1024, "cols": 2, "rows": 1, "cell": 1024}
    )
    assert tiled == _info(2, 1)

    with pytest.raises(map_canvas.CanvasError) as caught:
        map_canvas.info_from_metadata({"size": "1024x1536"})
    assert caught.value.status_code == 422
    assert "1024" in caught.value.detail


def test_metadata_round_trips_grid_fields() -> None:
    info = _info(2, 3)
    metadata = map_canvas.grid_metadata(info)

    assert metadata == {
        "width": CELL * 2,
        "height": CELL * 3,
        "cols": 2,
        "rows": 3,
        "cell": CELL,
        "size": f"{CELL * 2}x{CELL * 3}",
    }
    assert map_canvas.info_from_metadata(metadata) == info
