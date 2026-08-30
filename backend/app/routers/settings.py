from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, SQLModel, select

from app.db import get_session
from app.models import Setting
from app.routers.planning import get_novel_or_404


router = APIRouter(prefix="/novels", tags=["settings"])


class SettingCreate(SQLModel):
    category: str
    name: str
    content: str = ""
    current_state: str = ""
    is_confirmed: bool = False
    source_chapter: int | None = None


@router.get("/{novel_id}/settings", response_model=list[Setting])
def list_settings(
    novel_id: int,
    session: Session = Depends(get_session),
) -> list[Setting]:
    get_novel_or_404(novel_id, session)
    return list(
        session.exec(
            select(Setting)
            .where(Setting.novel_id == novel_id)
            .order_by(Setting.category, Setting.name)
        ).all()
    )


@router.post("/{novel_id}/settings", response_model=Setting, status_code=201)
def create_setting(
    novel_id: int,
    payload: SettingCreate,
    session: Session = Depends(get_session),
) -> Setting:
    get_novel_or_404(novel_id, session)
    existing = session.exec(
        select(Setting).where(
            Setting.novel_id == novel_id,
            Setting.category == payload.category,
            Setting.name == payload.name,
        )
    ).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="This setting already exists")

    setting = Setting(novel_id=novel_id, **payload.model_dump())
    session.add(setting)
    session.commit()
    session.refresh(setting)
    return setting


@router.put("/{novel_id}/settings/{setting_id}", response_model=Setting)
def update_setting(
    novel_id: int,
    setting_id: int,
    payload: SettingCreate,
    session: Session = Depends(get_session),
) -> Setting:
    get_novel_or_404(novel_id, session)
    setting = session.get(Setting, setting_id)
    if setting is None or setting.novel_id != novel_id:
        raise HTTPException(status_code=404, detail="Setting not found")

    duplicate = session.exec(
        select(Setting).where(
            Setting.novel_id == novel_id,
            Setting.category == payload.category,
            Setting.name == payload.name,
            Setting.id != setting_id,
        )
    ).first()
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="This setting already exists")

    for field, value in payload.model_dump().items():
        setattr(setting, field, value)
    session.add(setting)
    session.commit()
    session.refresh(setting)
    return setting
