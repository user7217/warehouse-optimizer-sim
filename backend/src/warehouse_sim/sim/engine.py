"""Discrete-time simulation engine.

One `tick()`:
  1. assign queued tasks to free robots            (Assigner: swappable)
  2. advance every robot one step                  (Router: swappable; Signalling: fixed safety layer)
  3. detect deadlocks and break them               (deadlock module)
  4. check ownership invariants                    (raises if a package has two owners)

Deterministic: same config + same seed + same commands -> identical run.
"""

from __future__ import annotations

import random

from warehouse_sim.algorithms.assignment import Assigner, GreedyNearestAssigner
from warehouse_sim.algorithms.deadlock import find_cycles, plan_push
from warehouse_sim.algorithms.routing import Router, ShortestPathRouter
from warehouse_sim.world import NodeKind, WarehouseConfig, World

from .signalling import Signalling
from .state import Goal, Metrics, Robot, RobotStatus, SimEvent, SimState, Task, TaskStatus

MAX_EVENTS = 80
MAX_DELIVERED_SHOWN = 30


class InvariantError(AssertionError):
    pass


class Simulation:
    def __init__(
        self,
        world: World,
        cfg: WarehouseConfig,
        router: Router | None = None,
        assigner: Assigner | None = None,
    ):
        self.world = world
        self.cfg = cfg
        self.router: Router = router or ShortestPathRouter(world)
        self.assigner: Assigner = assigner or GreedyNearestAssigner(self.router)
        self.sig = Signalling(world)
        self.ticks_per_second = cfg.sim.ticks_per_second
        self.running = False
        self.reset()

    # ================================================================ setup ==
    def reset(self) -> None:
        self.rng = random.Random(self.cfg.sim.seed)
        self.tick_no = 0
        self.sig.clear()
        self.tasks: dict[str, Task] = {}
        self._task_seq = 0
        self.events: list[SimEvent] = []
        self.deadlocks = 0
        self.backoffs = 0
        self._prev_cycles: set[frozenset[str]] = set()
        parking = sorted((n for n in self.world.nodes if n.kind == NodeKind.PARKING), key=lambda n: n.aisle or 0)
        self.robots: dict[str, Robot] = {}
        for i in range(self.cfg.robots.count):
            home = parking[i].id
            r = Robot(id=f"R{i}", node=home, home=home)
            self.robots[r.id] = r
            self.sig.place(r.id, home)
        self._docks = sorted(n.id for n in self.world.nodes if n.kind == NodeKind.DOCK)
        self._slot = {s.id: s for s in self.world.slots}

    # ============================================================= commands ==
    def add_task(self, pickup_slot: str, drop_dock: str) -> Task:
        if pickup_slot not in self._slot:
            raise ValueError(f"unknown slot {pickup_slot}")
        if drop_dock not in self._docks:
            raise ValueError(f"unknown dock {drop_dock}")
        self._task_seq += 1
        t = Task(
            id=f"T{self._task_seq}", pickup_slot=pickup_slot, pickup_node=self._slot[pickup_slot].access_node,
            drop_dock=drop_dock, created_tick=self.tick_no,
        )
        self.tasks[t.id] = t
        return t

    def add_random_tasks(self, count: int) -> list[Task]:
        slots = self.world.slots
        return [self.add_task(self.rng.choice(slots).id, self.rng.choice(self._docks)) for _ in range(count)]

    # ================================================================= tick ==
    def tick(self) -> None:
        self.tick_no += 1
        self._assign()
        waits_on: dict[str, str] = {}
        for rid in sorted(self.robots):
            blocked_by = self._step(self.robots[rid])
            if blocked_by:
                waits_on[rid] = blocked_by
        self._resolve_deadlocks(waits_on)
        self.check_invariants()

    # ----------------------------------------------------------- assignment --
    def _free_robots(self) -> list[Robot]:
        """Robots with no task: parked, or on their way home (can be redirected)."""
        return [r for r in self.robots.values() if r.task is None and r.goal != Goal.BACKOFF and r.status != RobotStatus.FAILED]

    def _assign(self) -> None:
        queued = sorted((t for t in self.tasks.values() if t.status == TaskStatus.QUEUED), key=lambda t: (t.created_tick, int(t.id[1:])))
        free = self._free_robots()
        if not queued or not free:
            return
        origin = {r.id: r.next_node or r.node for r in free}
        for task_id, robot_id in self.assigner.assign(queued, free, origin):
            t, r = self.tasks[task_id], self.robots[robot_id]
            if t.status != TaskStatus.QUEUED or r.task is not None:
                raise InvariantError(f"assigner returned busy pair {task_id}/{robot_id}")
            t.status, t.robot = TaskStatus.ASSIGNED, r.id
            r.task = t.id
            self._set_goal(r, Goal.PICKUP, t.pickup_node)
            self._event("assigned", f"{t.id} → {r.id}")

    # ---------------------------------------------------------------- robot --
    def _set_goal(self, r: Robot, goal: Goal, node: str) -> None:
        r.goal, r.goal_node = goal, node
        start = r.next_node or r.node  # mid-edge robots finish the edge first
        path = self.router.route(start, node)
        r.path = path if path is not None else []

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
            self._set_goal(r, Goal.HOME, r.home)
            r.status = RobotStatus.MOVING

    # ------------------------------------------------------------- deadlock --
    @staticmethod
    def _priority(r: Robot) -> tuple[int, int, str]:
        """Higher wins and keeps its place. Carrying beats assigned beats free.

        Tried and rejected: aging (robots that yielded more get priority) and a yield-hold after
        backing off. Both made livelock worse on the single-lane transfer rail (5/8 seeds -> 0-4/8).
        """
        return (1 if r.payload else 0, 1 if r.task else 0, r.id)

    def _resolve_deadlocks(self, waits_on: dict[str, str]) -> None:
        cycles = find_cycles(waits_on)
        current = {frozenset(c) for c in cycles}
        for cycle in cycles:
            if frozenset(cycle) not in self._prev_cycles:  # count a stuck cycle once, not every tick
                self.deadlocks += 1
                self._event("deadlock", "wait cycle " + " → ".join(cycle + [cycle[0]]))
            for victim_id in sorted(cycle, key=lambda rid: self._priority(self.robots[rid])):
                victim = self.robots[victim_id]
                # Resources every other robot in the cycle needs for its next step.
                forbidden: set[str] = set()
                for rid in cycle:
                    other = self.robots[rid]
                    if rid != victim_id and other.path and other.next_node is None:
                        forbidden.update(self.sig.needs_for_step(other.node, other.path[0]))
                in_cycle = set(cycle)
                pushable = {
                    r.id: r.node for r in self.robots.values()
                    if r.id not in in_cycle and r.next_node is None
                    and r.status in (RobotStatus.WAITING, RobotStatus.IDLE, RobotStatus.MOVING)
                }
                routes = frozenset(
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

    @staticmethod
    def _back_off(r: Robot, path: list[str]) -> None:
        """Send `r` along `path`, remembering its real goal so it resumes afterwards."""
        if r.goal != Goal.BACKOFF:
            r.resume_goal, r.resume_node = r.goal, r.goal_node
            if r.resume_goal is None:  # was parked: go home again afterwards
                r.resume_goal, r.resume_node = Goal.HOME, r.home
        r.goal, r.goal_node, r.path = Goal.BACKOFF, path[-1], list(path)
        r.status = RobotStatus.MOVING

    # ----------------------------------------------------------- invariants --
    def check_invariants(self) -> None:
        """Ownership + safety. Cheap enough to run every tick."""
        carried_by: dict[str, str] = {}
        for r in self.robots.values():
            for tid in r.payload:
                if tid in carried_by:
                    raise InvariantError(f"{tid} carried by both {carried_by[tid]} and {r.id}")
                carried_by[tid] = r.id
            if r.task:
                t = self.tasks[r.task]
                if t.robot != r.id:
                    raise InvariantError(f"{r.id} thinks it owns {t.id}, task says {t.robot}")
        for t in self.tasks.values():
            if t.status in (TaskStatus.ASSIGNED, TaskStatus.CARRIED):
                if t.robot is None or self.robots[t.robot].task != t.id:
                    raise InvariantError(f"{t.id} is {t.status} but its robot doesn't hold it")
            if t.status == TaskStatus.CARRIED and carried_by.get(t.id) != t.robot:
                raise InvariantError(f"{t.id} is carried but not on {t.robot}")
            if t.status in (TaskStatus.QUEUED, TaskStatus.DELIVERED) and t.id in carried_by:
                raise InvariantError(f"{t.id} is {t.status} but on {carried_by[t.id]}")
        # Every robot must hold the resource for where it physically is.
        for r in self.robots.values():
            if r.next_node is None:
                res = self.sig.resource_at(r.node)
            else:
                res = f"B:{self.sig.edge(r.node, r.next_node).block}"
            if self.sig.holder.get(res) != r.id:
                raise InvariantError(f"{r.id} at {r.node}->{r.next_node} does not hold {res}")

    # ================================================================ output ==
    def _event(self, kind: str, msg: str) -> None:
        self.events.append(SimEvent(tick=self.tick_no, kind=kind, msg=msg))
        if len(self.events) > MAX_EVENTS:
            del self.events[: len(self.events) - MAX_EVENTS]

    def metrics(self) -> Metrics:
        done = [t for t in self.tasks.values() if t.status == TaskStatus.DELIVERED]
        return Metrics(
            delivered=len(done),
            throughput_per_100=round(100 * len(done) / self.tick_no, 2) if self.tick_no else 0.0,
            avg_delivery_ticks=round(sum(t.delivered_tick - t.created_tick for t in done) / len(done), 1) if done else None,
            total_wait_ticks=sum(r.wait_ticks for r in self.robots.values()),
            waiting_now=sum(r.status == RobotStatus.WAITING for r in self.robots.values()),
            deadlocks=self.deadlocks,
            backoffs=self.backoffs,
        )

    def snapshot(self) -> SimState:
        active = [t for t in self.tasks.values() if t.status != TaskStatus.DELIVERED]
        done = sorted((t for t in self.tasks.values() if t.status == TaskStatus.DELIVERED), key=lambda t: t.delivered_tick or 0)
        return SimState(
            tick=self.tick_no, running=self.running, ticks_per_second=self.ticks_per_second,
            robots=list(self.robots.values()), tasks=active + done[-MAX_DELIVERED_SHOWN:],
            metrics=self.metrics(), events=list(self.events),
        )
