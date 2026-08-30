from sqlmodel import Session, select


class PlanningDomainError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def get_owned_or_error(
    session: Session, model, novel_id: int, entity_id: int, label: str
):
    instance = session.get(model, entity_id)
    if instance is None or instance.novel_id != novel_id:
        raise PlanningDomainError(404, f"{label} not found")
    return instance


def ensure_chapter_number_unique(
    session: Session,
    model,
    novel_id: int,
    chapter_number: int,
    label: str,
    exclude_id: int | None = None,
) -> None:
    statement = select(model).where(
        model.novel_id == novel_id,
        model.chapter_number == chapter_number,
    )
    if exclude_id is not None:
        statement = statement.where(model.id != exclude_id)
    if session.exec(statement).first() is not None:
        raise PlanningDomainError(409, f"This {label} already exists")


def validate_arc_range(start_chapter: int, end_chapter: int) -> None:
    if end_chapter < start_chapter:
        raise PlanningDomainError(422, "Arc end chapter is before start chapter")


def apply_payload(instance, payload) -> None:
    for field, value in payload.model_dump().items():
        setattr(instance, field, value)


def save(session: Session, instance):
    session.add(instance)
    session.commit()
    session.refresh(instance)
    return instance
