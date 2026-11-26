"""Dynamic simulation state. `to_dict()` output is the contract with the UI (frontend/src/types.ts).

Pure standard library. Fields after the `# engine-internal` marker are never serialised.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


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


class TaskStatus(StrEnum):
    QUEUED = "queued"
    ASSIGNED = "assigned"
    CARRIED = "carried"
    DELIVERED = "delivered"
    STRANDED = "stranded"  # on a failed robot (future)


@dataclass(slots=True)
class Robot:
    id: str
    node: str                        # last sensor-confirmed node
    home: str                        # its parking spur
    status: RobotStatus = RobotStatus.IDLE
    next_node: str | None = None     # travelling towards; None = stopped at `node`
    progress: float = 0.0            # 0..1 along node -> next_node
    task: str | None = None
    payload: list[str] = field(default_factory=list)
    path: list[str] = field(default_factory=list)  # nodes ahead, excluding next_node
    goal: Goal | None = None
    goal_node: str | None = None
    waiting_for: str | None = None
    wait_ticks: int = 0
    distance: float = 0.0
    delivered: int = 0
    # engine-internal
    timer: int = 0                   # ticks left for pick/drop
    resume_goal: Goal | None = None  # goal to restore after a back-off
    resume_node: str | None = None

    def to_dict(self) -> dict:
        return {
            "id": self.id, "status": self.status.value, "node": self.node, "next_node": self.next_node,
            "progress": round(self.progress, 4), "task": self.task, "payload": list(self.payload),
            "path": list(self.path), "goal": self.goal.value if self.goal else None, "goal_node": self.goal_node,
            "home": self.home, "waiting_for": self.waiting_for, "wait_ticks": self.wait_ticks,
            "distance": round(self.distance, 3), "delivered": self.delivered,
        }


@dataclass(slots=True)
class Task:
    """One item of an order: pick it from a slot, deliver it to the order's dock."""

    id: str
    order: str
    pickup_slot: str
    pickup_node: str
    drop_dock: str
    status: TaskStatus = TaskStatus.QUEUED
    robot: str | None = None
    created_tick: int = 0
    assigned_tick: int | None = None
    picked_tick: int | None = None
    delivered_tick: int | None = None

    def to_dict(self) -> dict:
        return {
            "id": self.id, "order": self.order, "pickup_slot": self.pickup_slot, "pickup_node": self.pickup_node,
            "drop_dock": self.drop_dock, "status": self.status.value, "robot": self.robot,
            "created_tick": self.created_tick, "assigned_tick": self.assigned_tick,
            "picked_tick": self.picked_tick, "delivered_tick": self.delivered_tick,
        }


@dataclass(slots=True)
class Order:
    id: str
    dock: str
    tasks: list[str]
    released_tick: int
    done_tick: int | None = None


@dataclass(slots=True)
class SimEvent:
    tick: int
    kind: str  # assigned | picked | delivered | order_done | deadlock | backoff | info | error
    msg: str

    def to_dict(self) -> dict:
        return {"tick": self.tick, "kind": self.kind, "msg": self.msg}
