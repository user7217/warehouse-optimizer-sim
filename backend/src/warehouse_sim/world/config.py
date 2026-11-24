"""Warehouse layout configuration, loaded from TOML and validated."""

from __future__ import annotations

import tomllib
from pathlib import Path

from pydantic import BaseModel, Field, model_validator


class RackConfig(BaseModel):
    aisles: int = Field(ge=1)
    columns: int = Field(ge=2)
    levels: int = Field(ge=1)
    depth: int = Field(ge=1)


class RailConfig(BaseModel):
    lift_columns: list[int]
    sensor_every: int = Field(default=0, ge=0)


class DockConfig(BaseModel):
    aisles: list[int]


class Dimensions(BaseModel):
    column_pitch: float = Field(gt=0)
    level_height: float = Field(gt=0)
    slot_depth: float = Field(gt=0)
    aisle_width: float = Field(gt=0)


class RobotConfig(BaseModel):
    count: int = Field(default=8, ge=0)
    speed: float = Field(default=0.25, gt=0)  # metres per tick
    pick_ticks: int = Field(default=8, ge=0)
    drop_ticks: int = Field(default=6, ge=0)
    delay_prob: float = Field(default=0.0, ge=0, lt=1)


class SimConfig(BaseModel):
    seed: int = 42
    ticks_per_second: float = Field(default=10, gt=0)


class WarehouseConfig(BaseModel):
    name: str
    racks: RackConfig
    rails: RailConfig
    docks: DockConfig
    dimensions: Dimensions
    robots: RobotConfig = RobotConfig()
    sim: SimConfig = SimConfig()

    @model_validator(mode="after")
    def _check_references(self) -> WarehouseConfig:
        cols, aisles = self.racks.columns, self.racks.aisles
        bad_lifts = [c for c in self.rails.lift_columns if not 0 <= c < cols]
        if bad_lifts:
            raise ValueError(f"lift_columns out of range 0..{cols - 1}: {bad_lifts}")
        if self.racks.levels > 1 and not self.rails.lift_columns:
            raise ValueError("levels > 1 needs at least one lift column, or upper levels are unreachable")
        bad_docks = [a for a in self.docks.aisles if not 0 <= a < aisles]
        if bad_docks:
            raise ValueError(f"dock aisles out of range 0..{aisles - 1}: {bad_docks}")
        if not self.docks.aisles:
            raise ValueError("need at least one dock")
        if self.robots.count > aisles:
            raise ValueError(f"robots.count ({self.robots.count}) > aisles ({aisles}): each robot needs its own parking spur")
        return self


def load_config(path: str | Path) -> WarehouseConfig:
    with open(path, "rb") as f:
        return WarehouseConfig.model_validate(tomllib.load(f))
