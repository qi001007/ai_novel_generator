from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from app.db import get_session
from app.models import Character, utc_now
from app.routers.planning import get_novel_or_404


router = APIRouter(prefix="/novels", tags=["characters"])


# D-15: every text field of a character is written through the document layer.
def _retired_write() -> None:
    raise HTTPException(
        status_code=410,
        detail="人物档案写入口已收口到 PUT /files/settings/characters/{id}.md（见 DECISIONS D-15）",
    )


# A portrait is an asset, not prose: it is a base64 data URL up to ~2MB of source
# image, which is why it never joins the Markdown projection (DECISIONS D-15) and gets
# this narrow endpoint instead. Empty string clears it, because the UI has a clear button.
MAX_PORTRAIT_CHARS = 3 * 1024 * 1024


class PortraitUpdate(SQLModel):
    portrait: str = ""


@router.get("/{novel_id}/characters", response_model=list[Character])
def list_characters(
    novel_id: int,
    session: Session = Depends(get_session),
) -> list[Character]:
    get_novel_or_404(novel_id, session)
    return list(
        session.exec(
            select(Character)
            .where(Character.novel_id == novel_id)
            .order_by(Character.name)
        ).all()
    )


@router.post("/{novel_id}/characters")
def create_character() -> None:
    raise _retired_write()


@router.put("/{novel_id}/characters/{character_id}")
def update_character() -> None:
    raise _retired_write()


@router.put("/{novel_id}/characters/{character_id}/portrait", response_model=Character)
def set_portrait(
    novel_id: int,
    character_id: int,
    payload: PortraitUpdate,
    session: Session = Depends(get_session),
) -> Character:
    """Write only the portrait, so the document layer can own every text field.

    Keeping this endpoint narrow is what makes D-15 safe: it cannot touch a field the
    file layer is responsible for, so there is still exactly one writer for content.
    """
    get_novel_or_404(novel_id, session)
    character = session.get(Character, character_id)
    if character is None or character.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Character not found")

    value = (payload.portrait or "").strip()
    if value and not value.startswith("data:image/"):
        raise HTTPException(status_code=422, detail="头像只接受 data:image/... 内联图片")
    if len(value) > MAX_PORTRAIT_CHARS:
        raise HTTPException(status_code=413, detail="头像过大，请压到 2MB 以内")

    character.portrait = value
    character.updated_at = utc_now()
    session.add(character)
    session.commit()
    session.refresh(character)
    return character
