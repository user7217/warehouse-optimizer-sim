"""Engine safety and liveness tests. These are the guarantees every future algorithm must keep."""

from pathlib import Path

import pytest

from warehouse_sim.sim.engine import Simulation
from warehouse_sim.sim.state import TaskStatus
from warehouse_sim.world import WarehouseConfig, build_world, load_config

DEFAULT = Path(__file__).parent.parent / "configs" / "default.toml"


def make_sim(seed: int = 42, delay_prob: float = 0.0, robots: int | None = None) -> Simulation:
    raw = load_config(DEFAULT).to_dict()
    raw["sim"]["seed"] = seed
    raw["robots"]["delay_prob"] = delay_prob
    if robots is not None:
        raw["robots"]["count"] = robots
    cfg = WarehouseConfig.from_dict(raw)
    return Simulation(build_world(cfg), cfg)


def assert_physically_safe(sim: Simulation) -> None:
    """No two robots on the same spot; no two robots swapping along one edge."""
    robots = list(sim.robots.values())
    spots = [(r.node, r.next_node) if r.next_node else (r.node,) for r in robots]
    stopped = [r.node for r in robots if r.next_node is None]
    assert len(stopped) == len(set(stopped)), f"two robots stopped on one node: {stopped}"
    for i, a in enumerate(robots):
        for b in robots[i + 1:]:
            if a.next_node and b.next_node:
                assert {a.node, a.next_node} != {b.node, b.next_node}, f"{a.id} and {b.id} share an edge"
            if a.next_node and b.next_node is None:
                assert b.node != a.next_node or sim.sig.holder.get(f"N:{b.node}") == b.id
    assert spots  # keep linters quiet about unused


def run_until_done(sim: Simulation, max_ticks: int) -> None:
    for _ in range(max_ticks):
        sim.tick()  # tick() itself raises InvariantError on any ownership/safety violation
        assert_physically_safe(sim)
        if all(t.status == TaskStatus.DELIVERED for t in sim.tasks.values()):
            return
    pending = [(t.id, t.status, t.robot) for t in sim.tasks.values() if t.status != TaskStatus.DELIVERED]
    raise AssertionError(f"not done after {max_ticks} ticks: {pending[:5]}")


@pytest.mark.parametrize("seed", range(1, 13))
def test_all_tasks_delivered(seed):
    """Liveness: 40 tasks, 8 robots, all delivered. (Livelocked on 3/8 seeds before the one-way loop.)"""
    sim = make_sim(seed=seed)
    sim.add_random_orders(40)
    run_until_done(sim, 8000)
    assert sim.metrics()["delivered"] == 40


@pytest.mark.parametrize("seed", range(1, 9))
@pytest.mark.parametrize("delay_prob", [0.0, 0.2])
def test_always_safe(seed, delay_prob):
    """Safety holds on every seed, with random stalls too, whether or not the run finishes."""
    sim = make_sim(seed=seed, delay_prob=delay_prob)
    sim.add_random_orders(40)
    for _ in range(3000):
        sim.tick()
        assert_physically_safe(sim)
    assert sim.metrics()["delivered"] > 0


def test_each_task_delivered_exactly_once():
    sim = make_sim()
    sim.add_random_orders(25)
    run_until_done(sim, 6000)
    delivered_events = [e for e in sim.events if e.kind == "delivered"]
    assert sum(r.delivered for r in sim.robots.values()) == 25
    assert len({e.msg.split()[2] for e in delivered_events}) == len(delivered_events)  # no task twice


def test_tasks_added_while_running():
    sim = make_sim()
    sim.add_random_orders(5)
    for _ in range(200):
        sim.tick()
    sim.add_random_orders(5)
    run_until_done(sim, 6000)
    assert sim.metrics()["delivered"] == 10


def test_deterministic():
    a, b = make_sim(seed=7), make_sim(seed=7)
    for s in (a, b):
        s.add_random_orders(20)
        for _ in range(1500):
            s.tick()
    assert a.metrics() == b.metrics()
    assert [r.node for r in a.robots.values()] == [r.node for r in b.robots.values()]


def test_idle_robots_return_home():
    sim = make_sim()
    sim.add_random_orders(8)
    run_until_done(sim, 6000)
    for _ in range(600):
        sim.tick()
    assert all(r.node == r.home and r.status == "idle" for r in sim.robots.values())


def test_reset_restores_start():
    sim = make_sim()
    sim.add_random_orders(10)
    for _ in range(300):
        sim.tick()
    sim.reset()
    assert sim.tick_no == 0 and not sim.tasks
    assert all(r.node == r.home for r in sim.robots.values())


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_heavier_load_ten_robots(seed):
    sim = make_sim(seed=seed, robots=10)
    sim.add_random_orders(80)
    run_until_done(sim, 12000)
