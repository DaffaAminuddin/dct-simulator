"""Progress persistence service."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.progress import Learner, WorkOrderAttempt
from app.schemas.progress import AttemptIn, ProgressIn


def get_learner(db: Session, learner_id: str) -> Learner | None:
    return db.get(Learner, learner_id)


def upsert_progress(db: Session, learner_id: str, data: ProgressIn) -> Learner:
    learner = db.get(Learner, learner_id)
    if learner is None:
        learner = Learner(id=learner_id)
        db.add(learner)
    learner.display_name = data.display_name
    learner.modules_completed = sorted(set(data.modules_completed))
    learner.mistakes = dict(data.mistakes)
    learner.actions = data.actions
    db.commit()
    db.refresh(learner)
    return learner


def record_attempt(db: Session, learner_id: str, data: AttemptIn) -> WorkOrderAttempt:
    if db.get(Learner, learner_id) is None:
        db.add(Learner(id=learner_id))
        db.flush()
    attempt = WorkOrderAttempt(learner_id=learner_id, **data.model_dump())
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    return attempt


def list_attempts(db: Session, learner_id: str) -> list[WorkOrderAttempt]:
    stmt = select(WorkOrderAttempt).where(WorkOrderAttempt.learner_id == learner_id).order_by(WorkOrderAttempt.id)
    return list(db.scalars(stmt))
