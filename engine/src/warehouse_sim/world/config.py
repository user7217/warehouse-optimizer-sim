"""Warehouse configuration: dataclasses + explicit validation. Loaded from TOML or a dict.

Pure standard library so it runs in the browser (Pyodide) as well as CPython.
"""

from __future__ import annotations

import tomllib
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any


def _check(cond: bool, msg: str) -> None:
    if not cond:
        raise ValueError(msg)


@dataclass
class RackConfig:
    aisles: int
    columns: int
    levels: int
    depth: int = 1


@dataclass
class RailConfig:
    lift_columns: list[int]
    sensor_every: int = 0


@dataclass
class DockConfig:
    aisles: list[int]


@dataclass
class Dimensions:
    column_pitch: float = 1.0
    level_height: float = 1.0
    slot_depth: float = 0.8
    aisle_width: float = 1.0


@dataclass
class RobotConfig:
    count: int = 8
    speed: float = 0.25      # metres per tick
    pick_ticks: int = 8
    drop_ticks: int = 6
    delay_prob: float = 0.0  # chance per tick a moving robot stalls


@dataclass
class SimConfig:
    seed: int = 42
    ticks_per_second: float = 10


_NESTED: dict[str, type] = {}


@dataclass
class WarehouseConfig:
    name: str
    racks: RackConfig
    rails: RailConfig
    docks: DockConfig
    dimensions: Dimensions = field(default_factory=Dimensions)
    robots: RobotConfig = field(default_factory=RobotConfig)
    sim: SimConfig = field(default_factory=SimConfig)

    def __post_init__(self) -> None:
        self.validate()

    def validate(self) -> None:
        r = self.racks
        _check(r.aisles >= 1, "racks.aisles must be >= 1")
        _check(r.columns >= 2, "racks.columns must be >= 2")
        _check(r.levels >= 1, "racks.levels must be >= 1")
        _check(r.depth >= 1, "racks.depth must be >= 1")
        _check(self.rails.sensor_every >= 0, "rails.sensor_every must be >= 0")
        bad_lifts = [c for c in self.rails.lift_columns if not 0 <= c < r.columns]
        _check(not bad_lifts, f"lift_columns out of range 0..{r.columns - 1}: {bad_lifts}")
        _check(r.levels == 1 or bool(self.rails.lift_columns),
               "levels > 1 needs at least one lift column, or upper levels are unreachable")
        _check(bool(self.docks.aisles), "need at least one dock")
        bad_docks = [a for a in self.docks.aisles if not 0 <= a < r.aisles]
        _check(not bad_docks, f"dock aisles out of range 0..{r.aisles - 1}: {bad_docks}")
        d = self.dimensions
        _check(min(d.column_pitch, d.level_height, d.slot_depth, d.aisle_width) > 0, "dimensions must be > 0")
        rb = self.robots
        _check(rb.count >= 0, "robots.count must be >= 0")
        _check(rb.count <= r.aisles * r.levels,
               f"robots.count ({rb.count}) > aisles x levels ({r.aisles * r.levels}): each robot needs a parking spur")
        _check(rb.speed > 0, "robots.speed must be > 0")
        _check(rb.pick_ticks >= 0 and rb.drop_ticks >= 0, "pick/drop ticks must be >= 0")
        _check(0 <= rb.delay_prob < 1, "robots.delay_prob must be in [0, 1)")
        _check(self.sim.ticks_per_second > 0, "sim.ticks_per_second must be > 0")

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> WarehouseConfig:
        return _build(cls, data)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _build(cls: type, data: dict[str, Any]) -> Any:
    """Construct nested dataclasses from plain dicts; unknown keys are an error (catches typos)."""
    known = {f.name: f for f in fields(cls)}
    unknown = set(data) - set(known)
    _check(not unknown, f"unknown config keys for {cls.__name__}: {sorted(unknown)}")
    kwargs = {}
    for name, value in data.items():
        sub = _NESTED.get(str(known[name].type))
        kwargs[name] = _build(sub, value) if sub and isinstance(value, dict) else value
    return cls(**kwargs)


_NESTED.update({
    "RackConfig": RackConfig, "RailConfig": RailConfig, "DockConfig": DockConfig,
    "Dimensions": Dimensions, "RobotConfig": RobotConfig, "SimConfig": SimConfig,
})


def load_config(path: str | Path) -> WarehouseConfig:
    with open(path, "rb") as f:
        return WarehouseConfig.from_dict(tomllib.load(f))
