from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.db import get_session
from app.main import app


@pytest.fixture()
def file_client(tmp_path) -> Iterator[TestClient]:
    """A client on a **file** database.

    Snapshots are copies of a file; an in-memory database has nothing to copy, so any test
    that cares about backups must not run against the default fixture.
    """
    engine = create_engine(
        f"sqlite:///{(tmp_path / 'live.db').as_posix()}",
        connect_args={"check_same_thread": False},
    )
    SQLModel.metadata.create_all(engine)

    def override() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture()
def db_engine():
    """The test database, exposed so a test can read what the API wrote.

    Without this, a test that wants to check resolution had to import app.db.engine and
    silently talk to the real development database - which is exactly what one of the
    provider tests did on its first run.
    """
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)
    return engine


@pytest.fixture()
def client(db_engine) -> Iterator[TestClient]:
    def override_get_session():
        with Session(db_engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    yield TestClient(app)
    app.dependency_overrides.clear()
