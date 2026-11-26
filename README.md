# Warehouse robot coordination testbed

Write a routing or task-assignment algorithm in Python, in the browser, and benchmark it on a
simulated rail-based warehouse. No ROS, no setup: the editor, the simulator and your code all run
in the visitor's browser (Python compiled to WebAssembly via Pyodide). The server only serves files.

## How it fits together

```
browser
├── UI (React, Three.js, CodeMirror)          frontend/src
└── Web Worker
    └── Pyodide (CPython in WebAssembly)
        ├── warehouse_sim  (the engine)       engine/src/warehouse_sim   ← bundled at build time
        └── your code      (Router / Assigner, typed in the editor)
server: nginx, static files only                deploy/, Dockerfile, compose.yaml
```

Why in the browser: the site is public. Running strangers' Python on a home server is remote code
execution. Here it runs in their own browser's WebAssembly sandbox, the server never sees it, and
server load stays near zero whatever people run.

## The engine (`engine/src/warehouse_sim/`)

Pure standard library (no pip packages), so it runs unchanged in CPython (tests) and Pyodide.

| Path | What |
|---|---|
| `runner.py` | entry points the browser calls; contract in `frontend/src/types.ts` |
| `scenario.py` | test scenarios (layout size, robots, workload, arrivals) + presets |
| `templates/default_algorithms.py` | what the editor starts with: the baseline, written out |
| `algorithms/adapters.py` | times, validates and contains every algorithm call |
| `algorithms/routing.py`, `assignment.py` | built-in baselines (Dijkstra, greedy) |
| `algorithms/deadlock.py` | wait-for cycle detection + push-chain back-off |
| `sim/engine.py` | tick loop, orders, task lifecycle, ownership invariants, metrics |
| `sim/signalling.py` | block signalling: the fixed safety layer |
| `world/` | config → graph: rails, lifts, one-way transfer loop, dock sidings, parking |

### Writing an algorithm

Define `class Router` and/or `class Assigner` (anything missing uses the baseline):

```python
class Router:
    def __init__(self, world, view): ...
    def route(self, start, goal):      # -> [node, ..., goal] | [] | None ("ask again next tick")
    def distance(self, start, goal):   # optional -> metres

class Assigner:
    def __init__(self, world, view, router): ...
    def assign(self, tasks, robots, origin):   # -> [(task_id, robot_id), ...]
```

Every answer is checked (legal moves only, ends at goal, queued tasks, free robots, no doubles);
a bad answer stops the test with an error at your line. Robots only move when block signalling
allows it, so algorithms can cause waiting and deadlocks, never collisions.

### What a test records

Makespan (ticks), throughput, item delivery time (avg / p95 / max), queue time, order completion
time, robot utilization, fraction of time waiting, distance, deadlocks, back-offs, and wall-clock
time per call for `route`, `assign` and the whole tick (calls, mean, p95, max, total).
Timings are measured in the browser: compare algorithms on the same machine, not across machines.

## Develop

```bash
cd frontend && npm install && npm run dev
```

```bash
cd engine && uv run pytest -q
```

## Deploy (home server, Cloudflare Tunnel)

```bash
docker compose up -d --build
```

- Serves on `127.0.0.1:8080` only; point a Cloudflare Tunnel at it (or use the commented
  `tunnel` service in `compose.yaml`).
- Runs as uid 101, read-only root filesystem, all capabilities dropped, `no-new-privileges`,
  capped at 0.5 CPU and 128 MB (it actually uses a few MB).
- Sends COOP/COEP + a strict CSP. In Cloudflare, turn off Rocket Loader, Email Obfuscation and
  any script injection (they break the CSP/isolation). Cloudflare caching and compression are fine.
- Nothing is stored anywhere: no database, no uploads, no logs of user code.
