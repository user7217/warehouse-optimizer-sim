from fastapi.testclient import TestClient

from warehouse_sim.api.server import app

client = TestClient(app)


def test_world_endpoint():
    body = client.get("/api/world").json()
    assert {"nodes", "edges", "blocks", "slots", "dimensions", "shape"} <= body.keys()
    assert body["nodes"] and body["edges"]


def test_state_endpoint_starts_empty():
    assert client.get("/api/state").json() == {"tick": 0, "robots": [], "tasks": []}
