from fastapi.testclient import TestClient

from warehouse_sim.api.server import app

client = TestClient(app)


def test_world_endpoint():
    body = client.get("/api/world").json()
    assert {"nodes", "edges", "blocks", "slots", "dimensions", "shape"} <= body.keys()
    assert any(n["kind"] == "parking" for n in body["nodes"])


def test_state_shape_matches_contract():
    client.post("/api/sim/reset")
    body = client.get("/api/state").json()
    assert {"tick", "running", "ticks_per_second", "robots", "tasks", "metrics", "events"} == body.keys()
    assert body["tick"] == 0 and body["tasks"] == []
    robot = body["robots"][0]
    assert {"id", "status", "node", "next_node", "progress", "task", "payload", "path", "goal", "goal_node",
            "home", "waiting_for", "wait_ticks", "distance", "delivered"} == robot.keys()  # no internal fields leak


def test_tasks_step_reset():
    client.post("/api/sim/reset")
    assert len(client.post("/api/tasks", json={"count": 3}).json()["tasks"]) == 3
    assert client.post("/api/sim/step").json()["tick"] == 1
    assert client.post("/api/tasks", json={"pickup_slot": "nope", "drop_dock": "D0"}).status_code == 400
    assert client.post("/api/sim/reset").json()["tick"] == 0


def test_websocket_sends_snapshot():
    with client.websocket_connect("/ws") as ws:
        assert "robots" in ws.receive_json()
