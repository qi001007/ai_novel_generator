import os

from sqlalchemy import Engine
from sqlmodel import create_engine


DATABASE_URL = os.getenv(
    "NOVEL_GENERATOR_DATABASE_URL",
    "sqlite:///./novel_generator.db",
)


engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
)
