from sqlmodel import Session


class PlanningDomainError(Exception):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def save(session: Session, instance):
    session.add(instance)
    session.commit()
    session.refresh(instance)
    return instance
