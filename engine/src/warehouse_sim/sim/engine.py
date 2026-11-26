"""Discrete-time simulation engine.

One `tick()`:
  1. release orders whose arrival time has come          (scenario workload)
  2. assign queued tasks to free robots                  (Assigner: swappable / user code)
  3. advance every robot one step                        (Router: swappable / user code;
                                                          Signalling: fixed safety layer)
  4. detect deadlocks and break them                     (deadlock module)
  5. check ownership + safety invariants

Algorithms are reached only through CheckedRouter / CheckedAssigner, which time, validate and
contain every call. Deterministic: same scenario + same code -> identical run.
Pure standard library: runs in CPython and in Pyodide (browser).
"""

from __future__ import annotations

import random
from collections.abc import Callable
from typing import Any

from warehouse_sim.algorithms.adapters import CheckedAssigner, CheckedRouter, SimView, UserCodeError, _call
from warehouse_sim.algorithms.assignment import GreedyNearestAssigner
from warehouse_sim.algorithms.deadlock import find_cycles, plan_push
from warehouse_sim.algorithms.routing import ShortestPathRouter
from warehouse_sim.world import NodeKind, WarehouseConfig, World

from .signalling import Signalling
from .state import Goal, Order, Robot, RobotStatus, SimEvent, Task, TaskStatus
from .timing import Timing, now

MAX_EVENTS = 120
MAX_OPEN_SHOWN = 300
MAX_DELIVERED_SHOWN = 30

RouterFactory = Callable[[World, SimView], Any]
AssignerFactory = Callable[[World, SimView, Any], Any]


def baseline_router(world: World, view: SimView) -> Any:
    return ShortestPathRouter(world)


def baseline_assigner(world: World, view: SimView, router: Any) -> Any:
    return GreedyNearestAssigner(router)


class InvariantError(AssertionError):
    pass


class Simulation:
    def __init__(
        self,
        world: World,
        cfg: WarehouseConfig,
        router_factory: RouterFactory | None = None,
        assigner_factory: AssignerFactory | None = None,
        workload: Any | None = None,   # scenario.Workload; None = no scheduled orders
        max_ticks: int | None = None,
    ):
        self.world = world
        self.cfg = cfg
        self.router_factory = router_factory or baseline_router
        self.assigner_factory = assigner_factory or baseline_assigner
        self.workload = workload
        self.max_ticks = max_ticks
        self.sig = Signalling(world)
        self._docks = sorted(n.id for n in world.nodes if n.kind == NodeKind.DOCK)
        self._slot_by_id = {s.id: s for s in world.slots}
        self.reset()

    # ================================================================ setup ==
    def reset(self) -> None:
        """Back to tick 0. Raises UserCodeError(phase='init') if an algorithm's constructor fails."""
        self.rng = random.Random(self.cfg.sim.seed)
        self.tick_no = 0
        self.sig.clear()
        self.tasks: dict[str, Task] = {}
        self.orders: dict[str, Order] = {}
        self._task_seq = self._order_seq = 0
        self.events: list[SimEvent] = []
        self.deadlocks = self.backoffs = 0
        self._prev_cycles: set[frozenset[str]] = set()
        self.robot_ticks = self.busy_ticks = 0
        self.error: UserCodeError | None = None
        self.timing = Timing()

        parking = sorted((n for n in self.world.nodes if n.kind == NodeKind.PARKING), key=lambda n: (n.level, n.aisle))
        self.robots: dict[str, Robot] = {}
        for i in range(self.cfg.robots.count):
            home = parking[i].id
            self.robots[f"R{i}"] = Robot(id=f"R{i}", node=home, home=home)
            self.sig.place(f"R{i}", home)
        self._needs_route: set[str] = set()  # robots whose router said "no route right now"

        self._schedule = self._build_schedule()
        self._sched_idx = 0
        self._manual_orders = 0

        view = SimView(self)
        self.router = CheckedRouter(_call("init", self.router_factory, self.world, view), self.world, self.timing)
        self.assigner = CheckedAssigner(_call("init", self.assigner_factory, self.world, view, self.router), self.timing)

    def _build_schedule(self) -> list[int]:
        """Release tick of every scheduled order (sorted)."""
        w = self.workload
        if w is None:
            return []
        if w.arrival == "all_at_once":
            return [0] * w.orders
        if w.arrival == "steady":
            gap = 100.0 / w.rate_per_100_ticks
            return [int(i * gap) for i in range(w.orders)]
        return [(i // w.burst_size) * w.burst_every for i in range(w.orders)]  # bursts

    # ============================================================= commands ==
    def add_order(self, slot_ids: list[str], dock: str) -> Order:
        """Release one order now: deliver every slot's box to `dock`."""
        if dock not in self._docks:
            raise ValueError(f"unknown dock {dock}")
        slot_by_id = self._slot_by_id
        self._order_seq += 1
        order = Order(id=f"O{self._order_seq}", dock=dock, tasks=[], released_tick=self.tick_no)
        for sid in slot_ids:
            if sid not in slot_by_id:
                raise ValueError(f"unknown slot {sid}")
            self._task_seq += 1
            t = Task(id=f"T{self._task_seq}", order=order.id, pickup_slot=sid,
                     pickup_node=slot_by_id[sid].access_node, drop_dock=dock, created_tick=self.tick_no)
            self.tasks[t.id] = t
            order.tasks.append(t.id)
        self.orders[order.id] = order
        return order

    def _random_order(self) -> Order:
        lo, hi = (self.workload.items_min, self.workload.items_max) if self.workload else (1, 1)
        k = self.rng.randint(lo, hi)
        slots = self.rng.sample(self.world.slots, min(k, len(self.world.slots)))
        return self.add_order([s.id for s in slots], self.rng.choice(self._docks))

    def add_random_orders(self, count: int) -> list[Order]:
        """Extra orders released now, on top of the scenario's schedule."""
        self._manual_orders += count
        return [self._random_order() for _ in range(count)]

    # ================================================================= tick ==
    @property
    def finished(self) -> bool:
        return (self._sched_idx >= len(self._schedule) and bool(self.tasks)
                and all(t.status == TaskStatus.DELIVERED for t in self.tasks.values()))

    @property
    def done(self) -> bool:
        return self.finished or self.error is not None or (self.max_ticks is not None and self.tick_no >= self.max_ticks)

    def tick(self) -> None:
        if self.error is not None:
            return
        t0 = now()
        try:
            self.tick_no += 1
            while self._sched_idx < len(self._schedule) and self._schedule[self._sched_idx] < self.tick_no:
                self._random_order()
                self._sched_idx += 1
            self._assign()
            waits_on: dict[str, str] = {}
            for rid in sorted(self.robots):
                blocked_by = self._step(self.robots[rid])
                if blocked_by:
                    waits_on[rid] = blocked_by
            self._resolve_deadlocks(waits_on)
            self.robot_ticks += len(self.robots)
            self.busy_ticks += sum(r.status != RobotStatus.IDLE for r in self.robots.values())
            self.check_invariants()
        except UserCodeError as err:
            self.error = err
            self._event("error", f"[{err.phase}] {err.message}")
        except AssertionError as err:  # an invariant broke: engine bug, or user code mutated the state
            self.error = UserCodeError("engine", f"Invariant violated: {err}")
            self._event("error", self.error.message)
        finally:
            self.timing.tick.add(now() - t0)

    # ----------------------------------------------------------- assignment --
    def _assign(self) -> None:
        queued = [t for t in self.tasks.values() if t.status == TaskStatus.QUEUED]
        free = [r for r in self.robots.values()
                if r.task is None and r.goal != Goal.BACKOFF and r.status != RobotStatus.FAILED]
        if not queued or not free:
            return
        queued.sort(key=lambda t: (t.created_tick, int(t.id[1:])))
        origin = {r.id: r.next_node or r.node for r in free}
        for task_id, robot_id in self.assigner.assign(queued, free, origin):
            t, r = self.tasks[task_id], self.robots[robot_id]
            t.status, t.robot, t.assigned_tick = TaskStatus.ASSIGNED, r.id, self.tick_no
            r.task = t.id
            self._set_goal(r, Goal.PICKUP, t.pickup_node)
            self._event("assigned", f"{t.id} ({t.order}) → {r.id}")

    # ---------------------------------------------------------------- robot --
    def _set_goal(self, r: Robot, goal: Goal, node: str) -> None:
        r.goal, r.goal_node = goal, node
        self._route(r, r.next_node or r.node)  # mid-edge robots finish the edge first

    def _route(self, r: Robot, start: str) -> None:
        path = self.router.route(start, r.goal_node) if r.goal_node else []
        if path is None:
            r.path = []
            self._needs_route.add(r.id)
        else:
            r.path = path
            self._needs_route.discard(r.id)

    def _step(self, r: Robot) -> str | None:
        """Advance one robot one tick. Returns the id of the robot blocking it, if it is waiting."""
        r.waiting_for = None

        if r.status in (RobotStatus.RETRIEVING, RobotStatus.DELIVERING):
            r.timer -= 1
            if r.timer <= 0:
                self._finish_action(r)
            return None

        if r.next_node is not None:  # travelling along an edge
            if self.cfg.robots.delay_prob and self.rng.random() < self.cfg.robots.delay_prob:
                return None  # stalled this tick; signalling absorbs the delay
            e = self.sig.edge(r.node, r.next_node)
            r.progress += self.cfg.robots.speed / e.length
            if r.progress >= 1.0:  # sensor confirms arrival
                self.sig.arrive(r.id, r.node, r.next_node)
                r.distance += e.length
                r.node, r.next_node, r.progress = r.next_node, None, 0.0
            return None

        if r.id in self._needs_route:  # router said "not now" last time: ask again
            self._route(r, r.node)
            if r.id in self._needs_route:
                r.status = RobotStatus.WAITING
                r.wait_ticks += 1
                return None

        if r.path:  # stopped at a node with somewhere to go
            blocking = self.sig.try_depart(r.id, r.node, r.path[0])
            if blocking is None:
                r.next_node = r.path.pop(0)
                r.status = RobotStatus.MOVING
                return None
            r.status, r.waiting_for = RobotStatus.WAITING, blocking
            r.wait_ticks += 1
            return blocking

        self._reached_goal(r)
        return None

    def _reached_goal(self, r: Robot) -> None:
        if r.goal == Goal.BACKOFF:
            goal, node = r.resume_goal, r.resume_node
            r.resume_goal = r.resume_node = None
            if goal is not None and node is not None:
                self._set_goal(r, goal, node)
                r.status = RobotStatus.MOVING
                return
        if r.goal == Goal.PICKUP and r.node == r.goal_node:
            r.status, r.timer = RobotStatus.RETRIEVING, self.cfg.robots.pick_ticks
        elif r.goal == Goal.DROP and r.node == r.goal_node:
            r.status, r.timer = RobotStatus.DELIVERING, self.cfg.robots.drop_ticks
        elif r.node == r.home:
            r.status, r.goal, r.goal_node = RobotStatus.IDLE, None, None
        else:
            self._set_goal(r, Goal.HOME, r.home)
            r.status = RobotStatus.MOVING
        if r.timer <= 0 and r.status in (RobotStatus.RETRIEVING, RobotStatus.DELIVERING):
            self._finish_action(r)

    def _finish_action(self, r: Robot) -> None:
        t = self.tasks[r.task] if r.task else None
        if r.status == RobotStatus.RETRIEVING and t:
            t.status, t.picked_tick = TaskStatus.CARRIED, self.tick_no
            r.payload = [t.id]
            self._event("picked", f"{r.id} picked {t.id} at {t.pickup_slot}")
            self._set_goal(r, Goal.DROP, t.drop_dock)
            r.status = RobotStatus.MOVING
        elif r.status == RobotStatus.DELIVERING and t:
            t.status, t.delivered_tick = TaskStatus.DELIVERED, self.tick_no
            r.payload, r.task = [], None
            r.delivered += 1
            self._event("delivered", f"{r.id} delivered {t.id} to {t.drop_dock} ({self.tick_no - t.created_tick} ticks)")
            order = self.orders[t.order]
            if all(self.tasks[tid].status == TaskStatus.DELIVERED for tid in order.tasks):
                order.done_tick = self.tick_no
                self._event("order_done", f"{order.id} complete: {len(order.tasks)} item(s) in {self.tick_no - order.released_tick} ticks")
            self._set_goal(r, Goal.HOME, r.home)
            r.status = RobotStatus.MOVING

    # ------------------------------------------------------------- deadlock --
    @staticmethod
    def _priority(r: Robot) -> tuple[int, int, str]:
        """Higher wins and keeps its place. Carrying beats assigned beats free.

        Tried and rejected: aging (robots that yielded more get priority) and a yield-hold after
        backing off. Both made livelock worse (5/8 seeds -> 0-4/8 on the old single-lane rail).
        """
        return (1 if r.payload else 0, 1 if r.task else 0, r.id)

    def _resolve_deadlocks(self, waits_on: dict[str, str]) -> None:
        cycles = find_cycles(waits_on)
        current = {frozenset(c) for c in cycles}
        for cycle in cycles:
            if frozenset(cycle) not in self._prev_cycles:  # count a stuck cycle once, not every tick
                self.deadlocks += 1
                self._event("deadlock", "wait cycle " + " → ".join(cycle + [cycle[0]]))
            in_cycle = set(cycle)
            for victim_id in sorted(cycle, key=lambda rid: self._priority(self.robots[rid])):
                victim = self.robots[victim_id]
                forbidden: set[str] = set()  # what the others need for their very next step
                for rid in cycle:
                    other = self.robots[rid]
                    if rid != victim_id and other.path and other.next_node is None:
                        forbidden.update(self.sig.needs_for_step(other.node, other.path[0]))
                pushable = {
                    r.id: r.node for r in self.robots.values()
                    if r.id not in in_cycle and r.next_node is None
                    and r.status in (RobotStatus.WAITING, RobotStatus.IDLE, RobotStatus.MOVING)
                }
                routes = frozenset(  # prefer ending off the others' routes (e.g. up a lift)
                    self.sig.resource_at(n) for rid in cycle if rid != victim_id for n in self.robots[rid].path
                )
                plan = plan_push(self.world, self.sig, victim.id, victim.node, forbidden, pushable, avoid_end=routes)
                if plan is None:
                    continue
                for rid in plan.order:
                    self._back_off(self.robots[rid], plan.moves[rid])
                self.backoffs += 1
                pushed = f" (pushing {', '.join(plan.order[1:])})" if len(plan.order) > 1 else ""
                self._event("backoff", f"{victim.id} backs off to {plan.moves[victim.id][-1]}{pushed}")
                break
            else:
                if frozenset(cycle) not in self._prev_cycles:
                    self._event("info", "deadlock: no robot in the cycle can back off yet")
        self._prev_cycles = current

    def _back_off(self, r: Robot, path: list[str]) -> None:
        """Send `r` along `path`, remembering its real goal so it resumes afterwards."""
        if r.goal != Goal.BACKOFF:
            r.resume_goal, r.resume_node = r.goal, r.goal_node
            if r.resume_goal is None:  # was parked: go home again afterwards
                r.resume_goal, r.resume_node = Goal.HOME, r.home
        r.goal, r.goal_node, r.path = Goal.BACKOFF, path[-1], list(path)
        r.status = RobotStatus.MOVING
        self._needs_route.discard(r.id)

    # ----------------------------------------------------------- invariants --
    def check_invariants(self) -> None:
        """Ownership + safety. Cheap enough to run every tick."""
        carried_by: dict[str, str] = {}
        for r in self.robots.values():
            for tid in r.payload:
                if tid in carried_by:
                    raise InvariantError(f"{tid} carried by both {carried_by[tid]} and {r.id}")
                carried_by[tid] = r.id
            if r.task and self.tasks[r.task].robot != r.id:
                raise InvariantError(f"{r.id} thinks it owns {r.task}, task says {self.tasks[r.task].robot}")
        for t in self.tasks.values():
            if t.status in (TaskStatus.ASSIGNED, TaskStatus.CARRIED):
                if t.robot is None or self.robots[t.robot].task != t.id:
                    raise InvariantError(f"{t.id} is {t.status} but its robot doesn't hold it")
            if t.status == TaskStatus.CARRIED and carried_by.get(t.id) != t.robot:
                raise InvariantError(f"{t.id} is carried but not on {t.robot}")
            if t.status in (TaskStatus.QUEUED, TaskStatus.DELIVERED) and t.id in carried_by:
                raise InvariantError(f"{t.id} is {t.status} but on {carried_by[t.id]}")
        for r in self.robots.values():  # every robot holds the resource for where it physically is
            res = self.sig.resource_at(r.node) if r.next_node is None else f"B:{self.sig.edge(r.node, r.next_node).block}"
            if self.sig.holder.get(res) != r.id:
                raise InvariantError(f"{r.id} at {r.node}->{r.next_node} does not hold {res}")

    # ================================================================ output ==
    def _event(self, kind: str, msg: str) -> None:
        self.events.append(SimEvent(tick=self.tick_no, kind=kind, msg=msg))
        if len(self.events) > MAX_EVENTS:
            del self.events[: len(self.events) - MAX_EVENTS]

    def metrics(self) -> dict[str, Any]:
        tasks = list(self.tasks.values())
        done = [t for t in tasks if t.status == TaskStatus.DELIVERED]
        dts = sorted(t.delivered_tick - t.created_tick for t in done)  # type: ignore[operator]
        queue = [t.assigned_tick - t.created_tick for t in tasks if t.assigned_tick is not None]
        odone = [o for o in self.orders.values() if o.done_tick is not None]

        def mean(xs: list[float]) -> float | None:
            return round(sum(xs) / len(xs), 1) if xs else None

        return {
            "orders_total": len(self.orders),
            "orders_done": len(odone),
            "orders_planned": len(self._schedule) + self._manual_orders,
            "tasks_total": len(tasks),
            "delivered": len(done),
            "throughput_per_100": round(100 * len(done) / self.tick_no, 3) if self.tick_no else 0.0,
            "avg_delivery_ticks": mean(dts),
            "p95_delivery_ticks": dts[min(len(dts) - 1, int(0.95 * len(dts)))] if dts else None,
            "max_delivery_ticks": dts[-1] if dts else None,
            "avg_queue_ticks": mean(queue),
            "avg_order_ticks": mean([o.done_tick - o.released_tick for o in odone]),  # type: ignore[operator]
            "total_wait_ticks": sum(r.wait_ticks for r in self.robots.values()),
            "waiting_now": sum(r.status == RobotStatus.WAITING for r in self.robots.values()),
            "utilization": round(self.busy_ticks / self.robot_ticks, 4) if self.robot_ticks else 0.0,
            "wait_fraction": round(sum(r.wait_ticks for r in self.robots.values()) / self.robot_ticks, 4) if self.robot_ticks else 0.0,
            "distance_total": round(sum(r.distance for r in self.robots.values()), 2),
            "deadlocks": self.deadlocks,
            "backoffs": self.backoffs,
        }

    def snapshot(self) -> dict[str, Any]:
        open_ = [t for t in self.tasks.values() if t.status != TaskStatus.DELIVERED][:MAX_OPEN_SHOWN]
        done = sorted((t for t in self.tasks.values() if t.status == TaskStatus.DELIVERED), key=lambda t: t.delivered_tick or 0)
        return {
            "tick": self.tick_no,
            "finished": self.finished,
            "error": self.error.to_dict() if self.error else None,
            "robots": [r.to_dict() for r in self.robots.values()],
            "tasks": [t.to_dict() for t in open_ + done[-MAX_DELIVERED_SHOWN:]],
            "metrics": self.metrics(),
            "timing": self.timing.to_dict(),
            "events": [e.to_dict() for e in self.events],
        }
