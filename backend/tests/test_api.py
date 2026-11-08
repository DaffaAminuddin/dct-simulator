from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.db import get_session, init_db, make_engine
from app.main import app


@pytest.fixture()
def client() -> Iterator[TestClient]:
    engine = make_engine("sqlite://")
    init_db(engine)
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override() -> Iterator:
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_session] = override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_health(client: TestClient) -> None:
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
    assert r.json()["database"] == "sqlite"


def test_progress_roundtrip(client: TestClient) -> None:
    assert client.get("/api/learners/alice/progress").status_code == 404
    body = {"display_name": "Alice", "modules_completed": ["cabling", "dc-fundamentals", "cabling"], "mistakes": {"CHASSIS_CLOSED": 2}, "actions": 17}
    r = client.put("/api/learners/alice/progress", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["modules_completed"] == ["cabling", "dc-fundamentals"]
    assert data["mistakes"] == {"CHASSIS_CLOSED": 2}
    assert client.get("/api/learners/alice/progress").json()["actions"] == 17


def test_attempts(client: TestClient) -> None:
    r = client.post("/api/learners/bob/attempts", json={"work_order_id": "DCT-0002", "status": "resolved", "resolved_in_ms": 95000, "validations": 2})
    assert r.status_code == 201
    assert r.json()["learner_id"] == "bob"
    client.post("/api/learners/bob/attempts", json={"work_order_id": "DCT-0005", "status": "pending_validation", "training_mode": "incident"})
    attempts = client.get("/api/learners/bob/attempts").json()
    assert [a["work_order_id"] for a in attempts] == ["DCT-0002", "DCT-0005"]


@pytest.mark.parametrize(
    "path,body",
    [
        ("/api/learners/bad%20id/progress", {}),
        ("/api/learners/bob/attempts", {"work_order_id": "X-1", "status": "resolved"}),
        ("/api/learners/bob/attempts", {"work_order_id": "DCT-0001", "status": "done"}),
        ("/api/learners/bob/progress", {"actions": -1}),
    ],
)
def test_validation_errors(client: TestClient, path: str, body: dict) -> None:
    method = client.put if path.endswith("progress") else client.post
    assert method(path, json=body).status_code == 422
