"""Pydantic request/response schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

WorkOrderStatus = Literal["open", "in_progress", "pending_validation", "resolved", "closed"]
TrainingMode = Literal["guided", "practice", "incident"]

LEARNER_ID_PATTERN = r"^[A-Za-z0-9_-]{1,64}$"


class ProgressIn(BaseModel):
    display_name: str = Field(default="", max_length=120)
    modules_completed: list[str] = Field(default_factory=list, max_length=64)
    mistakes: dict[str, int] = Field(default_factory=dict)
    actions: int = Field(default=0, ge=0)


class ProgressOut(ProgressIn):
    model_config = ConfigDict(from_attributes=True)

    id: str
    updated_at: datetime


class AttemptIn(BaseModel):
    work_order_id: str = Field(pattern=r"^DCT-\d{4}$")
    status: WorkOrderStatus
    training_mode: TrainingMode = "practice"
    resolved_in_ms: int | None = Field(default=None, ge=0)
    validations: int = Field(default=0, ge=0)


class AttemptOut(AttemptIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    learner_id: str
    created_at: datetime


class Health(BaseModel):
    status: Literal["ok"]
    version: str
    database: str
