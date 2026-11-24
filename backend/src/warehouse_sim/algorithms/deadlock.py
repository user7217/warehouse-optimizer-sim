"""Deadlock detection and recovery.

Detection: every waiting robot waits on exactly one other robot (the first holder of a resource it
needs), so the wait-for graph has out-degree <= 1. A deadlock is a cycle in it: follow the pointers.

Recovery (baseline): pick a robot in the cycle and clear a way for it to step aside.
Search outward for the nearest free node. Robots parked or waiting on the way can be *pushed*:
the whole chain shuffles one slot towards the free node, front first, then the stuck robot moves
into the slot that opened. Like sliding tiles. Everyone then re-plans to their real goal.

It is crude: under heavy traffic it can push robots back and forth (livelock), which the `backoffs`
metric makes visible. Better planners should make this fire rarely.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

from warehouse_sim.sim.signalling import Signalling
from warehouse_sim.world import World


def find_cycles(waits_on: dict[str, str]) -> list[list[str]]:
    """Cycles in a functional graph (each robot waits on at most one other). Deterministic order."""
    cycles: list[list[str]] = []
    state: dict[str, int] = {}  # 1 = on current walk, 2 = finished
    for start in sorted(waits_on):
        if state.get(start):
            continue
        walk: list[str] = []
        n: str | None = start
        while n is not None and n in waits_on and not state.get(n):
            state[n] = 1
            walk.append(n)
            n = waits_on[n]
        if n is not None and state.get(n) == 1:
            cycles.append(walk[walk.index(n):])
        for w in walk:
            state[w] = 2
    return cycles


@dataclass
class PushPlan:
    """moves[robot_id] = the nodes that robot travels, in order. Front of the chain is last in `order`."""

    order: list[str]
    moves: dict[str, list[str]]


def plan_push(
    world: World,
    sig: Signalling,
    victim: str,
    start: str,
    forbidden: set[str],
    pushable_at: dict[str, str],
    avoid_end: frozenset[str] = frozenset(),
    max_depth: int = 40,
) -> PushPlan | None:
    """Find the nearest free node for `victim` and the chain of robots that must shuffle to reach it.

    forbidden:   resources the victim must neither pass through nor end on (what the others need now)
    avoid_end:   resources it may pass through but should not stop on (the others' routes). Tried
                 first; if no such spot is near, falls back to ignoring it. Stepping off the route
                 (e.g. up a lift) is what stops two robots meeting again a moment later.
    pushable_at: robot id -> node, for robots stopped where they could be nudged (not mid-edge, not busy)
    A step u -> v is allowed if each resource it needs is free, the victim's own, or held by a pushable
    robot standing exactly at u or v (so the chain is a clean line of robots along the path).
    """
    if avoid_end:
        plan = _search(world, sig, victim, start, forbidden, pushable_at, forbidden | avoid_end, max_depth)
        if plan:
            return plan
    return _search(world, sig, victim, start, forbidden, pushable_at, forbidden, max_depth)


def _search(
    world: World, sig: Signalling, victim: str, start: str, forbidden: set[str],
    pushable_at: dict[str, str], bad_end: set[str] | frozenset[str], max_depth: int,
) -> PushPlan | None:
    at_node = {node: rid for rid, node in pushable_at.items()}
    prev: dict[str, str] = {}
    q = deque([(start, 0)])
    seen = {start}
    while q:
        u, depth = q.popleft()
        if u != start and u not in at_node and sig.holder.get(sig.resource_at(u)) in (None, victim) \
                and sig.resource_at(u) not in bad_end:
            return _chain(_backtrack(prev, start, u), start, victim, at_node)
        if depth >= max_depth:
            continue
        for v, _ in world.neighbors(u):
            if v in seen:
                continue
            need = sig.needs_for_step(u, v)
            # It may move through what it already holds (it is leaving it); it may not grab more of it.
            if any(r in forbidden and sig.holder.get(r) != victim for r in need):
                continue
            if all(_passable(sig.holder.get(r), victim, u, v, pushable_at) for r in need):
                seen.add(v)
                prev[v] = u
                q.append((v, depth + 1))
    return None


def _passable(holder: str | None, victim: str, u: str, v: str, pushable_at: dict[str, str]) -> bool:
    return holder in (None, victim) or pushable_at.get(holder) in (u, v)


def _backtrack(prev: dict[str, str], start: str, end: str) -> list[str]:
    path = [end]
    while prev[path[-1]] != start:
        path.append(prev[path[-1]])
    return path[::-1]


def _chain(path: list[str], start: str, victim: str, at_node: dict[str, str]) -> PushPlan:
    """Split `path` (start excluded, free node last) into one hop-segment per robot along it."""
    occupants = [(i, at_node[n]) for i, n in enumerate(path) if n in at_node]
    order = [victim] + [rid for _, rid in occupants]
    stops = [i for i, _ in occupants] + [len(path) - 1]  # each robot moves up to the next one's spot
    moves: dict[str, list[str]] = {}
    begin = 0
    for rid, stop in zip(order, stops):
        moves[rid] = path[begin: stop + 1]
        begin = stop + 1
    return PushPlan(order=order, moves=moves)
