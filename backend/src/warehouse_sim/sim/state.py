"""Dynamic simulation state. Serialised as-is to the frontend (see frontend/src/types.ts).

Fields marked `exclude=True` are engine-internal and never sent.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class RobotStatus(StrEnum):
    IDLE = "idle"
    MOVING = "moving"
    WAITING = "waiting"      # blocked by signalling: a resource it needs is held by another robot
    RETRIEVING = "retrieving"
    DELIVERING = "delivering"
    FAILED = "failed"


class Goal(StrEnum):
    PICKUP = "pickup"
    DROP = "drop"
    HOME = "home"
    BACKOFF = "backoff"  # stepping aside to break a deadlock; resumes its real goal after


class Robot(BaseModel):
    id: str
    status: RobotStatus = RobotStatus.IDLE
    node: str                        # last sensor-confirmed node
    next_node: str | None = None     # travelling towards; None = stopped at `node`
    progress: float = 0.0            # 0..1 along node -> next_node
    task: str | None = None
    payload: list[str] = Field(default_factory=list)
    path: list[str] = Field(default_factory=list)  # nodes ahead, excluding next_node
    goal: Goal | None = None
    goal_node: str | None = None
    home: str
    waiting_for: str | None = None
    wait_ticks: int = 0
    distance: float = 0.0
    delivered: int = 0

    # engine-internal
    timer: int = Field(default=0, exclude=True)                # ticks left for pick/drop
    resume_goal: Goal | None = Field(default=None, exclude=True)  # goal to restore after a back-off
    resume_node: str | None = Field(default=None, exclude=True)


class TaskStatus(StrEnum):
    QUEUED = "queued"
    ASSIGNED = "assigned"
    CARRIED = "carried"
    DELIVERED = "delivered"
    STRANDED = "stranded"  # on a failed robot (future)


class Task(BaseModel):
    id: str
    pickup_slot: str
    pickup_node: str
    drop_dock: str
    status: TaskStatus = TaskStatus.QUEUED
    robot: str | None = None
    created_tick: int = 0
    picked_tick: int | None = None
    delivered_tick: int | None = None


class Metrics(BaseModel):
    delivered: int = 0
    throughput_per_100: float = 0.0
    avg_delivery_ticks: float | None = None
    total_wait_ticks: int = 0
    waiting_now: int = 0
    deadlocks: int = 0
    backoffs: int = 0


class SimEvent(BaseModel):
    tick: int
    kind: str  # assigned | picked | delivered | deadlock | backoff | info
    msg: str


class SimState(BaseModel):
    tick: int = 0
    running: bool = False
    ticks_per_second: float = 10
    robots: list[Robot] = Field(default_factory=list)
    tasks: list[Task] = Field(default_factory=list)
    metrics: Metrics = Field(default_factory=Metrics)
    events: list[SimEvent] = Field(default_factory=list)
