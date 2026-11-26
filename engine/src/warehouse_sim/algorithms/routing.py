"""Path planning. Swap `Router` implementations to compare algorithms.

Baseline: Dijkstra on edge length, each robot alone, blind to the others.
Signalling keeps it safe; this planner just doesn't try to avoid waiting.
"""

from __future__ import annotations

import heapq
from collections import OrderedDict
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
    """Dijkstra with a per-source cache. The graph is static, so trees are reused across calls.

    The cache is LRU-bounded so memory stays flat on big layouts (~500k cached entries max).
    """

    CACHE_ENTRIES = 500_000

    def __init__(self, world: World):
        self.world = world
        self._trees: OrderedDict[str, tuple[dict[str, float], dict[str, str]]] = OrderedDict()
        self._max_trees = max(8, self.CACHE_ENTRIES // max(1, len(world.nodes)))

    def _tree(self, source: str) -> tuple[dict[str, float], dict[str, str]]:
        if source in self._trees:
            self._trees.move_to_end(source)
        else:
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
            if len(self._trees) > self._max_trees:
                self._trees.popitem(last=False)
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
