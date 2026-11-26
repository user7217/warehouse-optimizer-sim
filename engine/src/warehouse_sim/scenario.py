"""Test scenarios: layout size + robots + workload. One scenario + one code = one reproducible run.

Mirrors `Scenario` in frontend/src/types.ts.
"""

from __future__ import annotations

import copy
from dataclasses import asdict, dataclass, field
from typing import Any

from warehouse_sim.world import WarehouseConfig
from warehouse_sim.world.config import (
    Dimensions, DockConfig, RackConfig, RailConfig, RobotConfig, SimConfig,
)

ARRIVALS = ("all_at_once", "steady", "bursts")


@dataclass
class Layout:
    aisles: int = 10
    columns: int = 16
    levels: int = 5
    lift_every: int = 8
    sensor_every: int = 4
    dock_every: int = 1


@dataclass
class Robots:
    count: int = 8
    speed: float = 0.25
    pick_ticks: int = 8
    drop_ticks: int = 6
    delay_prob: float = 0.0


@dataclass
class Workload:
    orders: int = 40
    items_min: int = 1
    items_max: int = 1
    arrival: str = "all_at_once"
    rate_per_100_ticks: float = 5.0
    burst_size: int = 10
    burst_every: int = 300


@dataclass
class Scenario:
    name: str = "Default"
    layout: Layout = field(default_factory=Layout)
    robots: Robots = field(default_factory=Robots)
    workload: Workload = field(default_factory=Workload)
    seed: int = 42
    max_ticks: int = 20000

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _int_range(name: str, v: Any, lo: int, hi: int) -> int:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or int(v) != v:
        raise ValueError(f"{name} must be a whole number")
    v = int(v)
    if not lo <= v <= hi:
        raise ValueError(f"{name} must be between {lo} and {hi} (got {v})")
    return v


def _num_range(name: str, v: Any, lo: float, hi: float) -> float:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise ValueError(f"{name} must be a number")
    if not lo <= v <= hi:
        raise ValueError(f"{name} must be between {lo} and {hi} (got {v})")
    return float(v)


def parse_scenario(data: dict[str, Any]) -> Scenario:
    """Validate a scenario dict (from the UI). Raises ValueError with a readable message."""
    s = Scenario()
    s.name = str(data.get("name", s.name))[:80]
    lay, rob, wl = data.get("layout", {}), data.get("robots", {}), data.get("workload", {})
    L = s.layout
    L.aisles = _int_range("layout.aisles", lay.get("aisles", L.aisles), 1, 200)
    L.columns = _int_range("layout.columns", lay.get("columns", L.columns), 2, 100)
    L.levels = _int_range("layout.levels", lay.get("levels", L.levels), 1, 20)
    L.lift_every = _int_range("layout.lift_every", lay.get("lift_every", L.lift_every), 1, 100)
    L.sensor_every = _int_range("layout.sensor_every", lay.get("sensor_every", L.sensor_every), 0, 100)
    L.dock_every = _int_range("layout.dock_every", lay.get("dock_every", L.dock_every), 1, 200)
    R = s.robots
    R.count = _int_range("robots.count", rob.get("count", R.count), 1, L.aisles * L.levels)
    R.speed = _num_range("robots.speed", rob.get("speed", R.speed), 0.01, 1.0)
    R.pick_ticks = _int_range("robots.pick_ticks", rob.get("pick_ticks", R.pick_ticks), 0, 1000)
    R.drop_ticks = _int_range("robots.drop_ticks", rob.get("drop_ticks", R.drop_ticks), 0, 1000)
    R.delay_prob = _num_range("robots.delay_prob", rob.get("delay_prob", R.delay_prob), 0.0, 0.9)
    W = s.workload
    W.orders = _int_range("workload.orders", wl.get("orders", W.orders), 1, 5000)
    W.items_min = _int_range("workload.items_min", wl.get("items_min", W.items_min), 1, 20)
    W.items_max = _int_range("workload.items_max", wl.get("items_max", W.items_max), W.items_min, 20)
    W.arrival = str(wl.get("arrival", W.arrival))
    if W.arrival not in ARRIVALS:
        raise ValueError(f"workload.arrival must be one of {ARRIVALS}")
    W.rate_per_100_ticks = _num_range("workload.rate_per_100_ticks", wl.get("rate_per_100_ticks", W.rate_per_100_ticks), 0.01, 1000)
    W.burst_size = _int_range("workload.burst_size", wl.get("burst_size", W.burst_size), 1, 5000)
    W.burst_every = _int_range("workload.burst_every", wl.get("burst_every", W.burst_every), 1, 100000)
    s.seed = _int_range("seed", data.get("seed", s.seed), 0, 2**31 - 1)
    s.max_ticks = _int_range("max_ticks", data.get("max_ticks", s.max_ticks), 10, 1_000_000)
    return s


def scenario_to_config(s: Scenario) -> WarehouseConfig:
    L = s.layout
    last = L.columns - 1
    lifts = sorted({0, last, *range(0, L.columns, L.lift_every)})
    return WarehouseConfig(
        name=s.name,
        racks=RackConfig(aisles=L.aisles, columns=L.columns, levels=L.levels, depth=1),
        rails=RailConfig(lift_columns=lifts, sensor_every=L.sensor_every),
        docks=DockConfig(aisles=[a for a in range(L.aisles) if a % L.dock_every == 0]),
        dimensions=Dimensions(),
        robots=RobotConfig(count=s.robots.count, speed=s.robots.speed, pick_ticks=s.robots.pick_ticks,
                           drop_ticks=s.robots.drop_ticks, delay_prob=s.robots.delay_prob),
        sim=SimConfig(seed=s.seed),
    )


def _preset(name: str, layout: dict, robots: dict, workload: dict, max_ticks: int = 20000) -> Scenario:
    return parse_scenario({"name": name, "layout": layout, "robots": robots, "workload": workload, "max_ticks": max_ticks})


def presets() -> dict[str, Scenario]:
    """Built-in scenarios, small to stress-test. All deterministic (seed 42)."""
    return copy.deepcopy(_PRESETS)


_PRESETS: dict[str, Scenario] = {
    s.name: s for s in [
        _preset("Small", {"aisles": 4, "columns": 10, "levels": 3, "lift_every": 5},
                {"count": 4}, {"orders": 20}),
        _preset("Default", {}, {}, {}),
        _preset("Multi-item orders", {}, {}, {"orders": 25, "items_min": 1, "items_max": 4,
                                              "arrival": "steady", "rate_per_100_ticks": 2}),
        _preset("Rush hour (bursts)", {}, {"count": 10}, {"orders": 60, "arrival": "bursts",
                                                           "burst_size": 15, "burst_every": 400}),
        _preset("Steady stream", {}, {}, {"orders": 80, "arrival": "steady", "rate_per_100_ticks": 3}),
        _preset("Narrow & busy", {"aisles": 4, "columns": 24, "levels": 2, "lift_every": 12},
                {"count": 8}, {"orders": 40}),
        _preset("Large", {"aisles": 30, "columns": 24, "levels": 6, "lift_every": 8, "dock_every": 2},
                {"count": 25}, {"orders": 150, "arrival": "steady", "rate_per_100_ticks": 8}, max_ticks=40000),
        _preset("Huge (graph only)", {"aisles": 80, "columns": 30, "levels": 8, "lift_every": 10, "dock_every": 4},
                {"count": 60}, {"orders": 300, "arrival": "steady", "rate_per_100_ticks": 15}, max_ticks=60000),
    ]
}
DEFAULT_PRESET = "Default"
