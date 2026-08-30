from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from app.db import get_session
from app.main import app
from app.models import Novel


@pytest.fixture()
def client() -> Iterator[TestClient]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    def override_get_session():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_create_and_list_novels(client: TestClient) -> None:
    response = client.post(
        "/api/novels",
        json={"title": "测试作品", "description": "A novel for testing"},
    )

    assert response.status_code == 201
    assert response.json()["title"] == "测试作品"

    response = client.get("/api/novels")

    assert response.status_code == 200
    assert len(response.json()) == 1


def test_create_novel_rejects_duplicate_title(client: TestClient) -> None:
    client.post("/api/novels", json={"title": "测试作品"})

    response = client.post("/api/novels", json={"title": "测试作品"})

    assert response.status_code == 409
