"""The browser-facing runner: contract shapes, user-code containment, timing, scenarios, orders."""

import json

import pytest

from warehouse_sim import runner
from warehouse_sim.scenario import parse_scenario, presets

SMALL = json.dumps(presets()["Small"].to_dict())


def run_test(scenario: str = SMALL, code: str = "") -> dict:
    opened = json.loads(runner.open_session(scenario, code))
    assert opened["ok"], opened["error"]
    while True:
        chunk = json.loads(runner.run_chunk(500))
        if chunk["done"]:
            return chunk["report"]


# ------------------------------------------------------------------ shapes --
STATE_KEYS = {"tick", "finished", "error", "robots", "tasks", "metrics", "timing", "events"}
METRIC_KEYS = {"orders_total", "orders_done", "orders_planned", "tasks_total", "delivered", "throughput_per_100",
               "avg_delivery_ticks", "p95_delivery_ticks", "max_delivery_ticks", "avg_queue_ticks", "avg_order_ticks",
               "total_wait_ticks", "waiting_now", "utilization", "wait_fraction", "distance_total", "deadlocks", "backoffs"}
CALL_KEYS = {"calls", "total_ms", "mean_ms", "p95_ms", "max_ms"}


def test_open_session_matches_contract():
    r = json.loads(runner.open_session(SMALL, ""))
    assert r["ok"] and r["error"] is None
    assert {"nodes", "edges", "blocks", "slots", "dimensions", "shape"} <= r["world"].keys()
    assert set(r["state"]) == STATE_KEYS
    assert set(r["state"]["metrics"]) == METRIC_KEYS
    assert set(r["state"]["timing"]) == {"route", "assign", "tick", "wall_ms"}
    assert set(r["state"]["timing"]["route"]) == CALL_KEYS
    robot = r["state"]["robots"][0]
    assert "timer" not in robot and "resume_goal" not in robot  # internals never leak


def test_report_records_timing_and_metrics():
    rep = run_test()
    assert rep["finished"] and rep["reason"] == "complete"
    m, t = rep["metrics"], rep["timing"]
    assert m["delivered"] == m["tasks_total"] > 0
    assert m["orders_done"] == m["orders_planned"] == 20
    assert 0 < m["utilization"] <= 1
    assert t["tick"]["calls"] == rep["ticks"]
    assert t["route"]["calls"] > 0 and t["assign"]["calls"] > 0
    assert t["wall_ms"] > 0


def test_presets_all_valid():
    p = json.loads(runner.presets())
    assert p["default"] in p["presets"]
    for s in p["presets"].values():
        parse_scenario(s)  # raises if invalid


# ---------------------------------------------------------------- user code --
def test_template_is_treated_as_baseline():
    assert json.loads(runner.check_code(runner.default_code()))["provides"] == {"router": False, "assigner": False}


def test_modified_template_runs_as_user_code_and_matches_baseline():
    code = runner.default_code() + "\n# my tweak\n"
    rep = run_test(code=code)
    base = run_test()
    assert rep["provides"] == {"router": True, "assigner": True}
    assert rep["ticks"] == base["ticks"]  # same algorithms, same result: proves the plumbing


def test_syntax_error_points_at_line():
    r = json.loads(runner.check_code("x = 1\nclass Router(:\n    pass\n"))
    assert not r["ok"] and r["error"]["phase"] == "compile" and r["error"]["line"] == 2


def test_runtime_error_in_route_stops_run_with_line():
    code = "class Router:\n    def __init__(self, world, view):\n        pass\n    def route(self, start, goal):\n        return 1 / 0\n"
    rep = run_test(code=code)
    assert rep["reason"] == "error"
    assert rep["error"]["phase"] == "router" and rep["error"]["line"] == 5
    assert "ZeroDivisionError" in rep["error"]["message"]


@pytest.mark.parametrize("body,needle", [
    ("return [goal]", "not a legal move"),                 # teleport
    ("return 'nope'", "expected a list"),
    ("return ['NOT_A_NODE']", "not a node id"),
])
def test_invalid_routes_are_rejected(body, needle):
    code = f"class Router:\n    def __init__(self, world, view):\n        pass\n    def route(self, start, goal):\n        if start == goal:\n            return []\n        {body}\n"
    rep = run_test(code=code)
    assert rep["reason"] == "error" and rep["error"]["phase"] == "validation"
    assert needle in rep["error"]["message"]


def test_double_assignment_rejected():
    code = ("class Assigner:\n    def __init__(self, world, view, router):\n        pass\n"
            "    def assign(self, tasks, robots, origin):\n"
            "        return [(t.id, robots[0].id) for t in tasks[:2]] if len(tasks) > 1 else []\n")
    rep = run_test(code=code)
    assert rep["reason"] == "error" and "more than one pair" in rep["error"]["message"]


def test_bad_constructor_is_init_error():
    code = "class Router:\n    def __init__(self):\n        pass\n    def route(self, s, g):\n        return []\n"
    r = json.loads(runner.open_session(SMALL, code))
    assert not r["ok"] and r["error"]["phase"] == "init"


def test_route_none_means_wait_and_retry():
    """A router may say 'not now'; the robot waits and asks again (no crash, eventually delivers)."""
    code = runner.default_code().replace(
        "    def route(self, start, goal):\n",
        "    def route(self, start, goal):\n        if self.view.tick % 3:\n            return None\n",
    )
    rep = run_test(code=code)
    assert rep["finished"], rep["error"]


def test_invalid_scenario_reported():
    bad = json.loads(SMALL)
    bad["robots"]["count"] = 999
    r = json.loads(runner.open_session(json.dumps(bad), ""))
    assert not r["ok"] and r["error"]["phase"] == "scenario"


# ---------------------------------------------------------------- workloads --
@pytest.mark.parametrize("arrival", ["all_at_once", "steady", "bursts"])
def test_arrival_patterns_complete(arrival):
    s = json.loads(SMALL)
    s["workload"].update({"arrival": arrival, "orders": 12, "rate_per_100_ticks": 4, "burst_size": 4, "burst_every": 200})
    rep = run_test(json.dumps(s))
    assert rep["finished"] and rep["metrics"]["orders_done"] == 12


def test_multi_item_orders():
    s = json.loads(SMALL)
    s["workload"].update({"orders": 8, "items_min": 2, "items_max": 3})
    rep = run_test(json.dumps(s))
    m = rep["metrics"]
    assert rep["finished"] and m["orders_done"] == 8 and 16 <= m["tasks_total"] <= 24
    assert m["avg_order_ticks"] >= m["avg_delivery_ticks"]  # an order waits for its slowest item


def test_steady_arrivals_spread_over_time():
    s = json.loads(SMALL)
    s["workload"].update({"arrival": "steady", "orders": 10, "rate_per_100_ticks": 1})  # one per 100 ticks
    json.loads(runner.open_session(json.dumps(s), ""))
    state = json.loads(runner.step(250))
    assert state["metrics"]["orders_total"] == 3  # released at ticks 1, 101, 201


def test_max_ticks_stops_unfinished():
    s = json.loads(SMALL)
    s["max_ticks"] = 50
    rep = run_test(json.dumps(s))
    assert not rep["finished"] and rep["reason"] == "max_ticks" and rep["ticks"] == 50


def test_robots_beyond_aisles_park_on_upper_levels():
    s = json.loads(SMALL)  # 4 aisles x 3 levels -> up to 12 robots
    s["robots"]["count"] = 10
    rep = run_test(json.dumps(s))
    assert rep["finished"]


def test_add_orders_while_live():
    json.loads(runner.open_session(SMALL, ""))
    runner.step(5)
    state = json.loads(runner.add_orders(3))
    assert state["metrics"]["orders_planned"] == 23


def test_validation_error_points_at_method_definition():
    code = ("import math\nclass Assigner:\n    def __init__(self, world, view, router):\n        pass\n"
            "    def assign(self, tasks, robots, origin):\n        return [('nope', 'R0')]\n")
    rep = run_test(code=code)
    assert rep["error"]["phase"] == "validation" and rep["error"]["line"] == 5
