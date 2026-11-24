"""Thin HTTP/WebSocket layer over the Simulation. No sim logic lives here.

Run: uv run uvicorn warehouse_sim.api.server:app --reload
Pick a layout: WAREHOUSE_CONFIG=configs/other.toml uv run uvicorn ...

Concurrency: everything runs on one asyncio event loop, so commands and ticks never interleave
mid-tick. No locks needed.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

from warehouse_sim.sim import SimState
from warehouse_sim.sim.engine import Simulation
from warehouse_sim.world import World, build_world, load_config

CONFIG_PATH = Path(os.environ.get("WAREHOUSE_CONFIG", Path(__file__).parents[3] / "configs" / "default.toml"))

cfg = load_config(CONFIG_PATH)
world: World = build_world(cfg)
sim = Simulation(world, cfg)
clients: set[WebSocket] = set()
_runner: asyncio.Task | None = None


async def broadcast() -> None:
    if not clients:
        return
    msg = sim.snapshot().model_dump_json()
    dead = []
    for ws in clients:
        try:
            await ws.send_text(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


async def run_loop() -> None:
    """Tick at sim.ticks_per_second until paused. Stops (and reports) if an invariant breaks."""
    loop = asyncio.get_running_loop()
    next_at = loop.time()
    while sim.running:
        try:
            sim.tick()
        except AssertionError as err:
            sim.running = False
            sim._event("info", f"STOPPED: invariant violated: {err}")
        await broadcast()
        next_at += 1 / sim.ticks_per_second
        await asyncio.sleep(max(0.0, next_at - loop.time()))
        if loop.time() - next_at > 1:  # fell far behind (e.g. laptop slept): don't burst-catch-up
            next_at = loop.time()


async def stop_runner() -> None:
    global _runner
    sim.running = False
    if _runner:
        _runner.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await _runner
        _runner = None


app = FastAPI(title="Warehouse sim")


# ------------------------------------------------------------------ reads --
@app.get("/api/world")
def get_world() -> World:
    return world


@app.get("/api/state")
def get_state() -> SimState:
    return sim.snapshot()


# --------------------------------------------------------------- commands --
@app.post("/api/sim/run")
async def run() -> SimState:
    global _runner
    if not sim.running:
        sim.running = True
        _runner = asyncio.create_task(run_loop())
    await broadcast()
    return sim.snapshot()


@app.post("/api/sim/pause")
async def pause() -> SimState:
    await stop_runner()
    await broadcast()
    return sim.snapshot()


@app.post("/api/sim/step")
async def step() -> SimState:
    if not sim.running:
        try:
            sim.tick()
        except AssertionError as err:
            sim._event("info", f"invariant violated: {err}")
    await broadcast()
    return sim.snapshot()


@app.post("/api/sim/reset")
async def reset() -> SimState:
    await stop_runner()
    sim.reset()
    await broadcast()
    return sim.snapshot()


class SpeedBody(BaseModel):
    ticks_per_second: float = Field(gt=0, le=200)


@app.post("/api/sim/speed")
async def speed(body: SpeedBody) -> SimState:
    sim.ticks_per_second = body.ticks_per_second
    await broadcast()
    return sim.snapshot()


class TaskBody(BaseModel):
    count: int | None = Field(default=None, ge=1, le=500)
    pickup_slot: str | None = None
    drop_dock: str | None = None


@app.post("/api/tasks")
async def add_tasks(body: TaskBody) -> SimState:
    try:
        if body.pickup_slot and body.drop_dock:
            sim.add_task(body.pickup_slot, body.drop_dock)
        else:
            sim.add_random_tasks(body.count or 1)
    except ValueError as err:
        raise HTTPException(400, str(err)) from err
    await broadcast()
    return sim.snapshot()


# -------------------------------------------------------------- websocket --
@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    clients.add(ws)
    try:
        await ws.send_text(sim.snapshot().model_dump_json())
        while True:
            await ws.receive_text()  # we don't expect messages; this just detects disconnects
    except WebSocketDisconnect:
        pass
    finally:
        clients.discard(ws)
