import os

from sqlalchemy import Engine
from sqlmodel import Session, create_engine


DATABASE_URL = os.getenv(
    "NOVEL_GENERATOR_DATABASE_URL",
    "sqlite:///./novel_generator.db",
)


engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)


def get_session():
    with Session(engine) as session:
        yield session
