from collections import deque
from pathlib import Path

import pytest

from warehouse_sim.world import EdgeKind, WarehouseConfig, build_world, load_config

DEFAULT = Path(__file__).parent.parent / "configs" / "default.toml"


@pytest.fixture(scope="module")
def world():
    return build_world(load_config(DEFAULT))


def _cfg(**overrides) -> WarehouseConfig:
    base = load_config(DEFAULT).to_dict()
    for section, values in overrides.items():
        base[section].update(values)
    return WarehouseConfig.from_dict(base)


def test_counts_match_config(world):
    s = world.shape
    rail = s["aisles"] * s["columns"] * s["levels"]
    assert len([n for n in world.nodes if n.kind == "rail"]) == rail
    assert len(world.slots) == s["aisles"] * 2 * s["columns"] * s["levels"] * s["depth"]


def test_ids_unique(world):
    for items in (world.nodes, world.edges, world.blocks, world.slots):
        ids = [x.id for x in items]
        assert len(ids) == len(set(ids))


def test_every_node_reachable_from_first_dock(world):
    """If this fails, some slot can never be served."""
    start = next(n.id for n in world.nodes if n.kind == "dock")
    seen, queue = {start}, deque([start])
    while queue:
        for nxt, _ in world.neighbors(queue.popleft()):
            if nxt not in seen:
                seen.add(nxt)
                queue.append(nxt)
    assert seen == set(world.node_by_id)


def test_every_slot_has_valid_access_node(world):
    for slot in world.slots:
        node = world.node_by_id[slot.access_node]
        assert (node.aisle, node.column, node.level) == (slot.aisle, slot.column, slot.level)


def test_blocks_partition_edges(world):
    in_blocks = [e for b in world.blocks for e in b.edges]
    assert sorted(in_blocks) == sorted(e.id for e in world.edges)


def test_block_interiors_have_no_sensors(world):
    """Every node touched by a block is either a boundary sensor or sensor-free interior."""
    edge = {e.id: e for e in world.edges}
    for b in world.blocks:
        for eid in b.edges:
            for nid in (edge[eid].u, edge[eid].v):
                assert world.node_by_id[nid].sensor == (nid in b.sensors)


def test_vertical_edges_only_at_lift_columns():
    cfg = _cfg(rails={"lift_columns": [3], "sensor_every": 0})
    w = build_world(cfg)
    cols = {w.node_by_id[e.u].column for e in w.edges if e.kind == EdgeKind.VERTICAL}
    assert cols == {3}


def test_no_lifts_with_multiple_levels_rejected():
    with pytest.raises(ValueError, match="lift"):
        _cfg(rails={"lift_columns": []})


def test_out_of_range_dock_rejected():
    with pytest.raises(ValueError, match="dock"):
        _cfg(docks={"aisles": [99]})


def test_sensor_spacing_changes_block_count():
    coarse = build_world(_cfg(rails={"sensor_every": 0}))
    fine = build_world(_cfg(rails={"sensor_every": 2}))
    assert len(fine.blocks) > len(coarse.blocks)


def _reach(world, start, reverse=False):
    adj = {n.id: [] for n in world.nodes}
    for u in adj:
        for v, _ in world.neighbors(u):
            (adj[v] if reverse else adj[u]).append(u if reverse else v)
    seen, queue = {start}, deque([start])
    while queue:
        for nxt in adj[queue.popleft()]:
            if nxt not in seen:
                seen.add(nxt)
                queue.append(nxt)
    return seen


def test_strongly_connected(world):
    """With one-way edges, every node must be reachable from and able to reach every other."""
    start = world.nodes[0].id
    assert _reach(world, start) == set(world.node_by_id)
    assert _reach(world, start, reverse=True) == set(world.node_by_id)


def test_everything_outside_aisles_is_one_way(world):
    """Transfer lanes, aisle mouths and dock sidings are one-way: no head-on meetings there."""
    for e in world.edges:
        if e.kind in (EdgeKind.TRANSFER, EdgeKind.ENTRY, EdgeKind.DOCK):
            assert e.oneway, e.id
        else:
            assert not e.oneway, e.id
