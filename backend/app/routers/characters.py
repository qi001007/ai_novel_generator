from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from app.db import get_session
from app.models import Character, CharacterAppearance, utc_now
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


@router.delete("/{novel_id}/characters/{character_id}", status_code=204)
def delete_character(
    novel_id: int,
    character_id: int,
    session: Session = Depends(get_session),
) -> None:
    """把一个人物从这本书里删掉，连同它的逐章外貌记录。

    这不是新功能：`CharacterLibrary.remove()` 一直在调它，而它从来不存在，
    所以「删除」按钮必然 405（Q-09）。补上它是把一个坏按钮修好。
    `settings/characters/N.md` 是投影（D-02），行没了文件也就没了 -
    不需要第二条写通路去「删文件」。
    归属必须一起验：拿着 A 书的 id 到 B 书下来删，是 404，不是把 A 的人物删掉
    （T-18 那条教训：两个 id 拼出来的操作，必须能证明它们属于同一本书）。
    """
    get_novel_or_404(novel_id, session)
    character = session.get(Character, character_id)
    if character is None or character.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Character not found in this novel")
    for row in session.exec(
        select(CharacterAppearance).where(CharacterAppearance.character_id == character_id)
    ).all():
        session.delete(row)
    session.delete(character)
    session.commit()


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
