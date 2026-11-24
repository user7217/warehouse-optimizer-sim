# Warehouse robot coordination sim

A lab for multi-robot optimisation algorithms on a rail-based automated warehouse.

## Layout

```
backend/   Python. All logic: world graph, (soon) simulation + algorithms. You edit this.
  configs/default.toml           warehouse layout knobs
  src/warehouse_sim/world/       config -> graph builder (nodes, rails, sensors, blocks, slots)
  src/warehouse_sim/sim/         robot + task state (empty for now)
  src/warehouse_sim/api/         thin FastAPI layer, no logic
frontend/  React + Three.js. Only renders what the backend says.
```

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
