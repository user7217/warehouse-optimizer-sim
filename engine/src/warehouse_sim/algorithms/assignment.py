"""Task allocation. Swap `Assigner` implementations to compare algorithms.

Baseline: greedy. Oldest queued task first; it goes to the nearest available robot.
Known weakness (the thing to beat): an early task can grab a robot that a later task
needed far more, because decisions are made one task at a time.
"""

from __future__ import annotations

from typing import Protocol

from warehouse_sim.sim.state import Robot, Task

from .routing import Router


class Assigner(Protocol):
    def assign(self, tasks: list[Task], robots: list[Robot], origin: dict[str, str]) -> list[tuple[str, str]]:
        """Return (task_id, robot_id) pairs.

        tasks:  queued tasks, oldest first
        robots: robots free to take work
        origin: robot id -> node it would start planning from
        """
        ...


class GreedyNearestAssigner:
    def __init__(self, router: Router):
        self.router = router

    def assign(self, tasks: list[Task], robots: list[Robot], origin: dict[str, str]) -> list[tuple[str, str]]:
        free = {r.id for r in robots}
        pairs = []
        for t in tasks:
            if not free:
                break
            best = min(sorted(free), key=lambda rid: self.router.distance(origin[rid], t.pickup_node))
            if self.router.distance(origin[best], t.pickup_node) == float("inf"):
                continue
            pairs.append((t.id, best))
            free.remove(best)
        return pairs
