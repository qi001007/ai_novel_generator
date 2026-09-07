from sqlmodel import Session



def save(session: Session, instance):
    session.add(instance)
    session.commit()
    session.refresh(instance)
    return instance
