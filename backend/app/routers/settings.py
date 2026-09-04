from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.db import get_session
from app.models import Setting
from app.routers.planning import get_novel_or_404


router = APIRouter(prefix="/novels", tags=["settings"])


def _retired_write() -> None:
    """The worldview book is the only writer for this table now (DECISIONS D-15)."""
    raise HTTPException(
        status_code=410,
        detail="设定写入口已收口到 PUT /files/settings/worldview.md（见 DECISIONS D-15）",
    )


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


@router.post("/{novel_id}/settings")
def create_setting() -> None:
    raise _retired_write()


@router.put("/{novel_id}/settings/{setting_id}")
def update_setting(setting_id: int) -> None:
    raise _retired_write()
