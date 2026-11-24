"""Builds a World graph from a WarehouseConfig (aisle-and-lift layout)."""

from __future__ import annotations

import math

from .config import WarehouseConfig
from .model import Block, Edge, EdgeKind, Node, NodeKind, Slot, Vec3, World


def rail_id(aisle: int, column: int, level: int) -> str:
    return f"R{aisle}.{column}.{level}"


def transfer_id(aisle: int) -> str:
    return f"T{aisle}"


def dock_id(aisle: int) -> str:
    return f"D{aisle}"


class _Geometry:
    """Maps logical (aisle, column, level) to world coordinates."""

    def __init__(self, cfg: WarehouseConfig):
        d, r = cfg.dimensions, cfg.racks
        self.d = d
        self.aisle_spacing = d.aisle_width + 2 * r.depth * d.slot_depth

    def aisle_z(self, aisle: int) -> float:
        return aisle * self.aisle_spacing

    def rail(self, aisle: int, column: int, level: int) -> Vec3:
        return (column * self.d.column_pitch, level * self.d.level_height, self.aisle_z(aisle))

    def transfer(self, aisle: int) -> Vec3:
        return (-1.5 * self.d.column_pitch, 0.0, self.aisle_z(aisle))

    def dock(self, aisle: int) -> Vec3:
        return (-3.0 * self.d.column_pitch, 0.0, self.aisle_z(aisle))

    def slot(self, aisle: int, side: int, column: int, level: int, depth: int) -> Vec3:
        offset = self.d.aisle_width / 2 + self.d.slot_depth * (depth + 0.5)
        return (column * self.d.column_pitch, level * self.d.level_height, self.aisle_z(aisle) + side * offset)


def build_world(cfg: WarehouseConfig) -> World:
    r = cfg.racks
    geo = _Geometry(cfg)
    lifts = set(cfg.rails.lift_columns)
    nodes: dict[str, Node] = {}
    raw_edges: list[tuple[EdgeKind, str, str]] = []

    # --- aisle rails ---------------------------------------------------------
    for a in range(r.aisles):
        for c in range(r.columns):
            for lv in range(r.levels):
                nodes[rail_id(a, c, lv)] = Node(
                    id=rail_id(a, c, lv), kind=NodeKind.RAIL, pos=geo.rail(a, c, lv),
                    sensor=_rail_has_sensor(c, r.columns, lifts, cfg.rails.sensor_every),
                    aisle=a, column=c, level=lv,
                )
                if c + 1 < r.columns:
                    raw_edges.append((EdgeKind.HORIZONTAL, rail_id(a, c, lv), rail_id(a, c + 1, lv)))
                if c in lifts and lv + 1 < r.levels:
                    raw_edges.append((EdgeKind.VERTICAL, rail_id(a, c, lv), rail_id(a, c, lv + 1)))

    # --- transfer rail, aisle entries, docks ---------------------------------
    for a in range(r.aisles):
        nodes[transfer_id(a)] = Node(id=transfer_id(a), kind=NodeKind.TRANSFER, pos=geo.transfer(a), sensor=True, aisle=a)
        raw_edges.append((EdgeKind.ENTRY, transfer_id(a), rail_id(a, 0, 0)))
        if a + 1 < r.aisles:
            raw_edges.append((EdgeKind.TRANSFER, transfer_id(a), transfer_id(a + 1)))
    for a in cfg.docks.aisles:
        nodes[dock_id(a)] = Node(id=dock_id(a), kind=NodeKind.DOCK, pos=geo.dock(a), sensor=True, aisle=a)
        raw_edges.append((EdgeKind.DOCK, dock_id(a), transfer_id(a)))

    edges, blocks = _assign_blocks(raw_edges, nodes)

    slots = [
        Slot(
            id=f"S{a}.{'L' if side < 0 else 'R'}.{c}.{lv}.{z}", aisle=a, side=side, column=c, level=lv, depth=z,
            access_node=rail_id(a, c, lv), pos=geo.slot(a, side, c, lv, z),
        )
        for a in range(r.aisles) for side in (-1, 1)
        for c in range(r.columns) for lv in range(r.levels) for z in range(r.depth)
    ]

    return World(
        name=cfg.name, nodes=list(nodes.values()), edges=edges, blocks=blocks, slots=slots,
        dimensions={**cfg.dimensions.model_dump(), "aisle_spacing": geo.aisle_spacing},
        shape=r.model_dump(),
    )


def _rail_has_sensor(column: int, columns: int, lifts: set[int], every: int) -> bool:
    """Sensors at rail ends, at every lift junction, and optionally every N columns."""
    return column in (0, columns - 1) or column in lifts or (every > 0 and column % every == 0)


def _assign_blocks(
    raw_edges: list[tuple[EdgeKind, str, str]], nodes: dict[str, Node]
) -> tuple[list[Edge], list[Block]]:
    """Group edges into blocks: edges joined through a sensor-less node share a block.

    Union-find over edges. A sensor node is a boundary, so edges meeting there stay apart.
    This works for any graph shape, not just this layout.
    """
    parent = list(range(len(raw_edges)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    edges_at_node: dict[str, list[int]] = {}
    for i, (_, u, v) in enumerate(raw_edges):
        edges_at_node.setdefault(u, []).append(i)
        edges_at_node.setdefault(v, []).append(i)
    for node_id, incident in edges_at_node.items():
        if not nodes[node_id].sensor:
            for i in incident[1:]:
                parent[find(i)] = find(incident[0])

    block_of_root: dict[int, str] = {}
    block_edges: dict[str, list[str]] = {}
    block_sensors: dict[str, set[str]] = {}
    edges: list[Edge] = []
    for i, (kind, u, v) in enumerate(raw_edges):
        bid = block_of_root.setdefault(find(i), f"B{len(block_of_root)}")
        eid = f"E{i}"
        edges.append(Edge(id=eid, kind=kind, u=u, v=v, length=math.dist(nodes[u].pos, nodes[v].pos), block=bid))
        block_edges.setdefault(bid, []).append(eid)
        block_sensors.setdefault(bid, set()).update(n for n in (u, v) if nodes[n].sensor)

    blocks = [Block(id=b, edges=block_edges[b], sensors=sorted(block_sensors[b])) for b in block_edges]
    return edges, blocks
