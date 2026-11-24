"""Dynamic simulation state: robots and tasks. Empty until the robot step.

Shapes are defined now so the frontend panels have a stable contract.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class RobotStatus(StrEnum):
    IDLE = "idle"
    MOVING = "moving"
    WAITING = "waiting"      # blocked by signalling: next block occupied
    RETRIEVING = "retrieving"
    DELIVERING = "delivering"
    FAILED = "failed"


class Robot(BaseModel):
    id: str
    status: RobotStatus = RobotStatus.IDLE
    node: str                       # last sensor-confirmed position
    task: str | None = None
    payload: list[str] = Field(default_factory=list)  # package ids on board
    path: list[str] = Field(default_factory=list)     # planned node ids ahead


class TaskStatus(StrEnum):
    QUEUED = "queued"
    ASSIGNED = "assigned"
    CARRIED = "carried"
    DELIVERED = "delivered"
    STRANDED = "stranded"  # on a failed robot


class Task(BaseModel):
    id: str
    pickup_slot: str
    drop_dock: str
    status: TaskStatus = TaskStatus.QUEUED
    robot: str | None = None
    created_tick: int = 0


class SimState(BaseModel):
    tick: int = 0
    robots: list[Robot] = Field(default_factory=list)
    tasks: list[Task] = Field(default_factory=list)
