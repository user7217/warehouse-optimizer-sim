"""Entry points the browser calls (through Pyodide in a Web Worker). Contract: frontend/src/types.ts.

Every function takes and returns JSON strings (or plain str/int/float) and never raises:
failures come back as {"ok": false, "error": UserError} or inside SimState.error.
One session at a time per worker.
"""

from __future__ import annotations

import json
import traceback
from pathlib import Path
from typing import Any

from warehouse_sim.algorithms.adapters import USER_FILE, UserCodeError
from warehouse_sim.scenario import DEFAULT_PRESET, Scenario, parse_scenario, presets as _presets, scenario_to_config
from warehouse_sim.sim.engine import Simulation
from warehouse_sim.sim.timing import now
from warehouse_sim.world import build_world

TEMPLATE = (Path(__file__).parent / "templates" / "default_algorithms.py").read_text()


class _Session:
    def __init__(self, sim: Simulation, scenario: Scenario, provides: dict[str, bool]):
        self.sim, self.scenario, self.provides = sim, scenario, provides


_session: _Session | None = None


def _dumps(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"), allow_nan=False)


def _engine_error(exc: BaseException) -> dict:
    return UserCodeError("engine", f"{type(exc).__name__}: {exc}", traceback.format_exc()).to_dict()


def _no_session() -> str:
    return _dumps({"ok": False, "error": UserCodeError("engine", "No session open. Open one first.").to_dict()})


# ------------------------------------------------------------------ code --
def _compile(code: str) -> tuple[dict[str, Any], dict[str, bool]]:
    """Run the user's module in a fresh namespace. The unchanged template means 'use the baselines'."""
    if not code.strip() or code.strip() == TEMPLATE.strip():
        return {}, {"router": False, "assigner": False}
    ns: dict[str, Any] = {"__name__": "user_algorithms"}
    try:
        exec(compile(code, USER_FILE, "exec"), ns)  # noqa: S102 - runs in the visitor's own browser sandbox
    except KeyboardInterrupt:
        raise UserCodeError("compile", "Stopped (interrupted by the Stop button)") from None
    except Exception as exc:  # noqa: BLE001
        raise UserCodeError.from_exception("compile", exc) from None
    provides = {"router": isinstance(ns.get("Router"), type), "assigner": isinstance(ns.get("Assigner"), type)}
    for name, needed in (("Router", ("route",)), ("Assigner", ("assign",))):
        cls = ns.get(name)
        if isinstance(cls, type):
            missing = [m for m in needed if not callable(getattr(cls, m, None))]
            if missing:
                raise UserCodeError("compile", f"class {name} must define {', '.join(missing)}()")
    return ns, provides


def default_code() -> str:
    return TEMPLATE


def presets() -> str:
    return _dumps({"default": DEFAULT_PRESET, "presets": {k: v.to_dict() for k, v in _presets().items()}})


def check_code(code: str) -> str:
    try:
        _, provides = _compile(code)
        return _dumps({"ok": True, "error": None, "provides": provides})
    except UserCodeError as err:
        return _dumps({"ok": False, "error": err.to_dict(), "provides": {"router": False, "assigner": False}})
    except Exception as exc:  # noqa: BLE001
        return _dumps({"ok": False, "error": _engine_error(exc), "provides": {"router": False, "assigner": False}})


# --------------------------------------------------------------- session --
def open_session(scenario_json: str, code: str) -> str:
    global _session
    _session = None
    try:
        try:
            scenario = parse_scenario(json.loads(scenario_json))
            cfg = scenario_to_config(scenario)
        except (ValueError, TypeError, KeyError) as exc:
            raise UserCodeError("scenario", f"Invalid scenario: {exc}") from None
        ns, provides = _compile(code)
        router_factory = (lambda w, v: ns["Router"](w, v)) if provides["router"] else None
        assigner_factory = (lambda w, v, r: ns["Assigner"](w, v, r)) if provides["assigner"] else None
        world = build_world(cfg)
        sim = Simulation(world, cfg, router_factory, assigner_factory,
                         workload=scenario.workload, max_ticks=scenario.max_ticks)
        _session = _Session(sim, scenario, provides)
        return _dumps({"ok": True, "error": None, "world": world.to_dict(), "state": sim.snapshot()})
    except UserCodeError as err:
        return _dumps({"ok": False, "error": err.to_dict(), "world": None, "state": None})
    except Exception as exc:  # noqa: BLE001
        return _dumps({"ok": False, "error": _engine_error(exc), "world": None, "state": None})


def _advance(max_ticks: int, budget_s: float | None) -> None:
    sim = _session.sim  # type: ignore[union-attr]
    t0 = now()
    try:
        for _ in range(max_ticks):
            if sim.done:
                break
            sim.tick()
            if budget_s is not None and now() - t0 >= budget_s:
                break
    finally:
        sim.timing.wall += now() - t0


def step(n: int) -> str:
    if _session is None:
        return _no_session()
    try:
        _advance(max(0, int(n)), None)
        return _dumps(_session.sim.snapshot())
    except Exception as exc:  # noqa: BLE001
        _session.sim.error = UserCodeError("engine", f"{type(exc).__name__}: {exc}", traceback.format_exc())
        return _dumps(_session.sim.snapshot())


def get_state() -> str:
    return _no_session() if _session is None else _dumps(_session.sim.snapshot())


def add_orders(count: int) -> str:
    if _session is None:
        return _no_session()
    try:
        _session.sim.add_random_orders(max(0, min(int(count), 1000)))
    except Exception as exc:  # noqa: BLE001
        _session.sim.error = UserCodeError("engine", f"{type(exc).__name__}: {exc}", traceback.format_exc())
    return _dumps(_session.sim.snapshot())


def _report() -> dict:
    s = _session
    assert s is not None
    sim = s.sim
    reason = "error" if sim.error else "complete" if sim.finished else "max_ticks"
    return {
        "scenario": s.scenario.to_dict(), "provides": s.provides, "finished": sim.finished, "reason": reason,
        "ticks": sim.tick_no, "metrics": sim.metrics(), "timing": sim.timing.to_dict(),
        "error": sim.error.to_dict() if sim.error else None,
    }


def run_chunk(budget_ms: float) -> str:
    """Headless test mode: as many ticks as fit in budget_ms, then hand control back to the worker."""
    if _session is None:
        return _no_session()
    sim = _session.sim
    try:
        _advance(10**9, max(1.0, float(budget_ms)) / 1000.0)
    except Exception as exc:  # noqa: BLE001
        sim.error = UserCodeError("engine", f"{type(exc).__name__}: {exc}", traceback.format_exc())
    m = sim.metrics()
    planned = m["orders_planned"] or 1
    progress = 1.0 if sim.done else min(0.999, max(m["orders_done"] / planned, sim.tick_no / (sim.max_ticks or 1)))
    return _dumps({"done": sim.done, "tick": sim.tick_no, "progress": round(progress, 4),
                   "report": _report() if sim.done else None, "state": sim.snapshot()})


def report() -> str:
    return _no_session() if _session is None else _dumps(_report())
