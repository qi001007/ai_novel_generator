from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from app.db import get_session
from app.models import Character
from app.routers.planning import get_novel_or_404


router = APIRouter(prefix="/novels", tags=["characters"])


class CharacterCreate(SQLModel):
    name: str
    level: str = "supporting"
    portrait: str = ""
    identity: str = ""
    goals: str = ""
    behavior_constraints: str = ""
    relationships: dict[str, Any] = {}
    current_status: str = ""
    expected_start_chapter: int | None = None
    expected_end_chapter: int | None = None


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


@router.post("/{novel_id}/characters", response_model=Character, status_code=201)
def create_character(
    novel_id: int,
    payload: CharacterCreate,
    session: Session = Depends(get_session),
) -> Character:
    get_novel_or_404(novel_id, session)
    existing = session.exec(
        select(Character).where(
            Character.novel_id == novel_id,
            Character.name == payload.name,
        )
    ).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="This character already exists")

    character = Character(novel_id=novel_id, **payload.model_dump())
    session.add(character)
    session.commit()
    session.refresh(character)
    return character


@router.put("/{novel_id}/characters/{character_id}", response_model=Character)
def update_character(
    novel_id: int,
    character_id: int,
    payload: CharacterCreate,
    session: Session = Depends(get_session),
) -> Character:
    get_novel_or_404(novel_id, session)
    character = session.get(Character, character_id)
    if character is None or character.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Character not found")

    duplicate = session.exec(
        select(Character).where(
            Character.novel_id == novel_id,
            Character.name == payload.name,
            Character.id != character_id,
        )
    ).first()
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="This character already exists")

    for field, value in payload.model_dump().items():
        setattr(character, field, value)
    session.add(character)
    session.commit()
    session.refresh(character)
    return character
