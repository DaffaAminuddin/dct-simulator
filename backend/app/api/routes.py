"""HTTP API. The simulation runs client-side; the backend persists learner progress and attempts."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import __version__
from app.db import get_session
from app.schemas.progress import LEARNER_ID_PATTERN, AttemptIn, AttemptOut, Health, ProgressIn, ProgressOut
from app.services import progress as svc

router = APIRouter(prefix="/api")

DbSession = Annotated[Session, Depends(get_session)]
LearnerId = Annotated[str, Path(pattern=LEARNER_ID_PATTERN)]


@router.get("/health", response_model=Health)
def health(db: DbSession) -> Health:
    db.execute(text("SELECT 1"))
    return Health(status="ok", version=__version__, database=db.get_bind().dialect.name)


@router.get("/learners/{learner_id}/progress", response_model=ProgressOut)
def get_progress(learner_id: LearnerId, db: DbSession) -> ProgressOut:
    learner = svc.get_learner(db, learner_id)
    if learner is None:
        raise HTTPException(status_code=404, detail="Learner not found")
    return ProgressOut.model_validate(learner)


@router.put("/learners/{learner_id}/progress", response_model=ProgressOut)
def put_progress(learner_id: LearnerId, body: ProgressIn, db: DbSession) -> ProgressOut:
    return ProgressOut.model_validate(svc.upsert_progress(db, learner_id, body))


@router.post("/learners/{learner_id}/attempts", response_model=AttemptOut, status_code=201)
def post_attempt(learner_id: LearnerId, body: AttemptIn, db: DbSession) -> AttemptOut:
    return AttemptOut.model_validate(svc.record_attempt(db, learner_id, body))


@router.get("/learners/{learner_id}/attempts", response_model=list[AttemptOut])
def get_attempts(learner_id: LearnerId, db: DbSession) -> list[AttemptOut]:
    return [AttemptOut.model_validate(a) for a in svc.list_attempts(db, learner_id)]
