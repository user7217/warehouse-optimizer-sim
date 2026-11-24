# Warehouse robot coordination sim

A lab for multi-robot optimisation algorithms on a rail-based automated warehouse.

## Layout

```
backend/   Python. All logic. You edit this.
  configs/default.toml             layout, robot and sim knobs
  src/warehouse_sim/world/         config -> graph (nodes, rails, sensors, blocks, slots, parking)
  src/warehouse_sim/sim/engine.py  tick loop, task lifecycle, ownership invariants
  src/warehouse_sim/sim/signalling.py  block signalling: the fixed safety layer
  src/warehouse_sim/algorithms/    THE SWAPPABLE PART
    routing.py      Router      baseline: Dijkstra, each robot alone
    assignment.py   Assigner    baseline: greedy nearest robot, oldest task first
    deadlock.py     detection (wait-for cycles) + push-chain back-off recovery
  src/warehouse_sim/api/           FastAPI + WebSocket, no logic
frontend/  React + Three.js. Only renders what the backend says. Contract: frontend/src/types.ts
```

## Baseline results (the numbers to beat)

8 robots / 40 random tasks and 10 robots / 80 tasks, seeds 1-20: every task delivered on all 40 runs
(~2100-2400 and ~3400-3800 ticks), at most 8-16 deadlocks per run, all recovered.
Safety (no collisions, no double ownership) holds on every seed, with and without random stalls.

What made it live: everything outside the aisles is one-way (two-lane transfer loop, separate aisle
in/out, docks as sidings), and back-offs prefer stepping off the other robots' routes (e.g. up a lift).
Head-on conflicts now only happen inside the two-way aisles.

**Rule:** the frontend never decides anything. Swap an algorithm in Python; the views update.

## Run

```bash
cd backend && uv run uvicorn warehouse_sim.api.server:app --reload --port 8000
```

```bash
cd frontend && npm run dev
```

Open http://localhost:5173.

Other layout: `WAREHOUSE_CONFIG=configs/mine.toml uv run uvicorn ...`

## Test

```bash
cd backend && uv run pytest -q
```

## Model in one paragraph

Robots ride rails. Each aisle has one horizontal rail per storage level; lifts (vertical rails) sit at
configured columns; a floor transfer rail joins aisle mouths to docks. Sensors sit at rail ends,
lift junctions and every N columns. The rail between two sensors is a **block**: at most one robot
inside at a time, and a robot only counts as moved when a sensor confirms it (railway block signalling).
