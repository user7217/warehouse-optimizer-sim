"""Thin HTTP layer. Holds no logic: it only exposes the world and sim state.

Run: uv run uvicorn warehouse_sim.api.server:app --reload
Pick a layout: WAREHOUSE_CONFIG=configs/other.toml uv run uvicorn ...
"""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI

from warehouse_sim.sim import SimState
from warehouse_sim.world import World, build_world, load_config

CONFIG_PATH = Path(os.environ.get("WAREHOUSE_CONFIG", Path(__file__).parents[3] / "configs" / "default.toml"))

app = FastAPI(title="Warehouse sim")
world: World = build_world(load_config(CONFIG_PATH))
state = SimState()


@app.get("/api/world")
def get_world() -> World:
    return world


@app.get("/api/state")
def get_state() -> SimState:
    return state
