"""Path planning. Swap `Router` implementations to compare algorithms.

Baseline: Dijkstra on edge length, each robot alone, blind to the others.
Signalling keeps it safe; this planner just doesn't try to avoid waiting.
"""

from __future__ import annotations

import heapq
from typing import Protocol

from warehouse_sim.world import World


class Router(Protocol):
    def route(self, start: str, goal: str) -> list[str] | None:
        """Nodes to visit after `start`, ending at `goal` ([] if start == goal). None if unreachable."""
        ...

    def distance(self, start: str, goal: str) -> float:
        """Travel distance in metres; inf if unreachable."""
        ...


class ShortestPathRouter:
    """Dijkstra with a per-source cache. The graph is static, so trees are reused across calls."""

    def __init__(self, world: World):
        self.world = world
        self._trees: dict[str, tuple[dict[str, float], dict[str, str]]] = {}

    def _tree(self, source: str) -> tuple[dict[str, float], dict[str, str]]:
        if source not in self._trees:
            dist: dict[str, float] = {source: 0.0}
            prev: dict[str, str] = {}
            heap = [(0.0, source)]
            while heap:
                d, u = heapq.heappop(heap)
                if d > dist[u]:
                    continue
                for v, e in self.world.neighbors(u):
                    nd = d + e.length
                    if nd < dist.get(v, float("inf")):
                        dist[v] = nd
                        prev[v] = u
                        heapq.heappush(heap, (nd, v))
            self._trees[source] = (dist, prev)
        return self._trees[source]

    def route(self, start: str, goal: str) -> list[str] | None:
        dist, prev = self._tree(start)
        if goal not in dist:
            return None
        path = []
        n = goal
        while n != start:
            path.append(n)
            n = prev[n]
        path.reverse()
        return path

    def distance(self, start: str, goal: str) -> float:
        return self._tree(start)[0].get(goal, float("inf"))
