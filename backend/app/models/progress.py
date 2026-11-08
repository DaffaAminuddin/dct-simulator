"""ORM models. Portable types only (JSON, String, Integer, DateTime) so the schema runs on SQLite and PostgreSQL."""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _now() -> datetime:
    return datetime.now(UTC)


class Learner(Base):
    __tablename__ = "learners"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(120), default="")
    modules_completed: Mapped[list[str]] = mapped_column(JSON, default=list)
    mistakes: Mapped[dict[str, int]] = mapped_column(JSON, default=dict)
    actions: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    attempts: Mapped[list[WorkOrderAttempt]] = relationship(back_populates="learner", cascade="all, delete-orphan")


class WorkOrderAttempt(Base):
    __tablename__ = "work_order_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    learner_id: Mapped[str] = mapped_column(ForeignKey("learners.id"), index=True)
    work_order_id: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(24))
    training_mode: Mapped[str] = mapped_column(String(16), default="practice")
    resolved_in_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    validations: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    learner: Mapped[Learner] = relationship(back_populates="attempts")
