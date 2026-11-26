"""The layer between the engine and algorithm code (user-written or baseline).

Every call is:
  - timed        (wall clock, into Timing.route / Timing.assign)
  - validated    (a route must be legal moves ending at the goal; an assignment must pair queued
                  tasks with free robots, each at most once)
  - contained    (any exception becomes a UserCodeError with phase, message, traceback, line)

So a buggy or malicious algorithm can produce a wrong answer only by being slow or bad at its job,
never by teleporting robots, double-assigning packages, or crashing the engine silently.
"""

from __future__ import annotations

import math
import traceback
from collections.abc import Callable
from typing import Any

from warehouse_sim.sim.timing import Timing, now
from warehouse_sim.world import World

USER_FILE = "<your code>"  # filename user code is compiled under; used to find its line numbers


class UserCodeError(Exception):
    """An algorithm misbehaved. Carries what the UI needs to show it."""

    def __init__(self, phase: str, message: str, tb: str = "", line: int | None = None):
        super().__init__(message)
        self.phase, self.message, self.tb, self.line = phase, message, tb, line

    @classmethod
    def from_exception(cls, phase: str, exc: BaseException) -> UserCodeError:
        frames = traceback.extract_tb(exc.__traceback__)
        user_frames = [f for f in frames if f.filename == USER_FILE]
        line = user_frames[-1].lineno if user_frames else None
        if isinstance(exc, SyntaxError) and exc.filename == USER_FILE:
            line = exc.lineno
        # Show only the user's frames + the exception itself; engine internals are noise to them.
        shown = traceback.format_list(user_frames) if user_frames else []
        tb = "Traceback (most recent call last):\n" + "".join(shown) if shown else ""
        tb += "".join(traceback.format_exception_only(type(exc), exc))
        return cls(phase, f"{type(exc).__name__}: {exc}", tb, line)

    def to_dict(self) -> dict:
        return {"phase": self.phase, "message": self.message, "traceback": self.tb, "line": self.line}


def _def_line(method: Any) -> int | None:
    """Line where a user's method is defined, so validation errors can point somewhere useful."""
    code = getattr(getattr(method, "__func__", method), "__code__", None)
    return code.co_firstlineno if code is not None and code.co_filename == USER_FILE else None


def _call(phase: str, fn: Callable[..., Any], *args: Any) -> Any:
    try:
        return fn(*args)
    except UserCodeError:
        raise
    except KeyboardInterrupt:
        raise UserCodeError(phase, "Stopped (interrupted by the Stop button)") from None
    except Exception as exc:  # noqa: BLE001 - anything their code throws is reported, not swallowed
        raise UserCodeError.from_exception(phase, exc) from None


class CheckedRouter:
    """Wraps a Router: times, validates and contains every call."""

    def __init__(self, inner: Any, world: World, timing: Timing):
        self.inner, self.world, self.timing = inner, world, timing
        self._next = {n.id: {v for v, _ in world.neighbors(n.id)} for n in world.nodes}
        self._has_distance = callable(getattr(inner, "distance", None))
        self._route_line = _def_line(getattr(inner, "route", None))
        self._distance_line = _def_line(getattr(inner, "distance", None))

    def route(self, start: str, goal: str) -> list[str] | None:
        t0 = now()
        try:
            path = _call("router", self.inner.route, start, goal)
        finally:
            self.timing.route.add(now() - t0)
        if path is None:
            return None  # "no route right now": the engine asks again next tick
        return self._check(start, goal, path)

    def distance(self, start: str, goal: str) -> float:
        if not self._has_distance:  # optional for users: derive it from route()
            path = self.route(start, goal)
            if path is None:
                return math.inf
            nodes = [start, *path]
            return sum(self._edge_len(a, b) for a, b in zip(nodes, nodes[1:]))
        t0 = now()
        try:
            d = _call("router", self.inner.distance, start, goal)
        finally:
            self.timing.route.add(now() - t0)
        if isinstance(d, bool) or not isinstance(d, (int, float)) or d < 0 or math.isnan(d):
            raise UserCodeError("validation", f"Router.distance({start!r}, {goal!r}) returned {d!r}; expected a number >= 0 (math.inf if unreachable)", line=self._distance_line)
        return float(d)

    def _edge_len(self, a: str, b: str) -> float:
        for v, e in self.world.neighbors(a):
            if v == b:
                return e.length
        return math.inf

    def _check(self, start: str, goal: str, path: Any) -> list[str]:
        try:
            return self._check_path(start, goal, path)
        except UserCodeError as err:
            err.line = err.line or self._route_line
            raise

    def _check_path(self, start: str, goal: str, path: Any) -> list[str]:
        if not isinstance(path, (list, tuple)):
            raise UserCodeError("validation", f"Router.route({start!r}, {goal!r}) returned {type(path).__name__}; expected a list of node ids or None")
        prev = start
        for i, n in enumerate(path):
            if not isinstance(n, str) or n not in self.world.node_by_id:
                raise UserCodeError("validation", f"Router.route({start!r}, {goal!r}): item {i} is {n!r}, not a node id")
            if n not in self._next[prev]:
                raise UserCodeError("validation", f"Router.route({start!r}, {goal!r}): step {prev} -> {n} is not a legal move (not adjacent, or against a one-way edge)")
            prev = n
        if prev != goal:
            raise UserCodeError("validation", f"Router.route({start!r}, {goal!r}) ends at {prev!r}, not at the goal. Exclude the start node; end with the goal ([] if already there)")
        return list(path)


class CheckedAssigner:
    """Wraps an Assigner: times, validates and contains every call."""

    def __init__(self, inner: Any, timing: Timing):
        self.inner, self.timing = inner, timing
        self._line = _def_line(getattr(inner, "assign", None))

    def assign(self, tasks: list, robots: list, origin: dict[str, str]) -> list[tuple[str, str]]:
        t0 = now()
        try:
            out = _call("assigner", self.inner.assign, tasks, robots, origin)
        finally:
            self.timing.assign.add(now() - t0)
        try:
            return self._validate(tasks, robots, out)
        except UserCodeError as err:
            err.line = err.line or self._line
            raise

    def _validate(self, tasks: list, robots: list, out: Any) -> list[tuple[str, str]]:
        queued = {t.id for t in tasks}
        free = {r.id for r in robots}
        if out is None:
            return []
        try:
            pairs = [tuple(p) for p in out]
        except TypeError:
            raise UserCodeError("validation", f"Assigner.assign returned {type(out).__name__}; expected a list of (task_id, robot_id) pairs") from None
        seen_t: set[str] = set()
        seen_r: set[str] = set()
        for p in pairs:
            if len(p) != 2:
                raise UserCodeError("validation", f"Assigner.assign: {p!r} is not a (task_id, robot_id) pair")
            tid, rid = p
            if tid not in queued:
                raise UserCodeError("validation", f"Assigner.assign: task {tid!r} is not one of the queued tasks passed in")
            if rid not in free:
                raise UserCodeError("validation", f"Assigner.assign: robot {rid!r} is not one of the free robots passed in")
            if tid in seen_t or rid in seen_r:
                raise UserCodeError("validation", f"Assigner.assign: {tid!r} or {rid!r} appears in more than one pair")
            seen_t.add(tid)
            seen_r.add(rid)
        return pairs  # type: ignore[return-value]


class SimView:
    """Read-only window onto the live simulation, handed to algorithm constructors.

    Treat everything as read-only. Mutating it only corrupts your own test run.
    """

    def __init__(self, sim: Any):
        self._sim = sim

    @property
    def tick(self) -> int:
        return self._sim.tick_no

    @property
    def robots(self) -> list:
        """All robots (see Robot fields: id, node, next_node, path, goal, goal_node, status, payload...)."""
        return list(self._sim.robots.values())

    @property
    def open_tasks(self) -> list:
        """Tasks not yet delivered."""
        return [t for t in self._sim.tasks.values() if t.status.value != "delivered"]

    @property
    def reservations(self) -> dict[str, str]:
        """Signalling: resource -> robot id. "N:<node>" for sensor nodes, "B:<block>" for blocks."""
        return self._sim.sig.holder

    def resource_at(self, node: str) -> str:
        """The resource a robot stopped at `node` would hold."""
        return self._sim.sig.resource_at(node)
