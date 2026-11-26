"""Builds a World graph from a WarehouseConfig (aisle-and-lift layout)."""

from __future__ import annotations

import math
from dataclasses import asdict

from .config import WarehouseConfig
from .model import Block, Edge, EdgeKind, Node, NodeKind, Slot, Vec3, World


def rail_id(aisle: int, column: int, level: int) -> str:
    return f"R{aisle}.{column}.{level}"


def lane_a_id(k: int) -> str:
    return f"TA{k}"


def lane_b_id(k: int) -> str:
    return f"TB{k}"


def dock_id(aisle: int) -> str:
    return f"D{aisle}"


def parking_id(aisle: int, level: int) -> str:
    return f"P{aisle}.{level}"


class _Geometry:
    """Maps logical (aisle, column, level) to world coordinates."""

    def __init__(self, cfg: WarehouseConfig):
        d, r = cfg.dimensions, cfg.racks
        self.d = d
        self.aisle_spacing = d.aisle_width + 2 * r.depth * d.slot_depth

    def aisle_z(self, aisle: float) -> float:
        return aisle * self.aisle_spacing

    def rail(self, aisle: int, column: int, level: int) -> Vec3:
        return (column * self.d.column_pitch, level * self.d.level_height, self.aisle_z(aisle))

    def lane_a(self, k: int) -> Vec3:
        return (-1.5 * self.d.column_pitch, 0.0, self.aisle_z(k))

    def lane_b(self, k: int) -> Vec3:
        return (-3.0 * self.d.column_pitch, 0.0, self.aisle_z(k))

    def dock(self, aisle: int) -> Vec3:
        """Docks sit outside lane B, between this aisle and the next (they are sidings)."""
        return (-4.5 * self.d.column_pitch, 0.0, self.aisle_z(aisle + 0.5))

    def parking(self, aisle: int, level: int, columns: int) -> Vec3:
        return (columns * self.d.column_pitch, level * self.d.level_height, self.aisle_z(aisle))

    def slot(self, aisle: int, side: int, column: int, level: int, depth: int) -> Vec3:
        offset = self.d.aisle_width / 2 + self.d.slot_depth * (depth + 0.5)
        return (column * self.d.column_pitch, level * self.d.level_height, self.aisle_z(aisle) + side * offset)


def build_world(cfg: WarehouseConfig) -> World:
    r = cfg.racks
    geo = _Geometry(cfg)
    lifts = set(cfg.rails.lift_columns)
    nodes: dict[str, Node] = {}
    raw_edges: list[tuple[EdgeKind, str, str, bool]] = []

    def add(kind: EdgeKind, u: str, v: str, oneway: bool = False) -> None:
        raw_edges.append((kind, u, v, oneway))

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
                    add(EdgeKind.HORIZONTAL, rail_id(a, c, lv), rail_id(a, c + 1, lv))
                if c in lifts and lv + 1 < r.levels:
                    add(EdgeKind.VERTICAL, rail_id(a, c, lv), rail_id(a, c, lv + 1))

    # --- transfer loop: two one-way lanes, joined at both ends ----------------
    # Lane A (next to the aisles) flows towards higher aisles; lane B (outside) flows back.
    # Both lanes run one slot past each end (k = -1 and k = aisles) so the loop can turn.
    # One-way everywhere here means robots never meet head-on outside the aisles.
    lane = range(-1, r.aisles + 1)
    for k in lane:
        nodes[lane_a_id(k)] = Node(id=lane_a_id(k), kind=NodeKind.TRANSFER, pos=geo.lane_a(k), sensor=True)
        nodes[lane_b_id(k)] = Node(id=lane_b_id(k), kind=NodeKind.TRANSFER, pos=geo.lane_b(k), sensor=True)
    for k in lane[:-1]:
        add(EdgeKind.TRANSFER, lane_a_id(k), lane_a_id(k + 1), oneway=True)
        add(EdgeKind.TRANSFER, lane_b_id(k + 1), lane_b_id(k), oneway=True)
    add(EdgeKind.TRANSFER, lane_a_id(r.aisles), lane_b_id(r.aisles), oneway=True)  # far end: A -> B
    add(EdgeKind.TRANSFER, lane_b_id(-1), lane_a_id(-1), oneway=True)              # near end: B -> A

    # Aisle mouths: enter from A[a], leave onto A[a+1]. In and out never share a rail.
    for a in range(r.aisles):
        add(EdgeKind.ENTRY, lane_a_id(a), rail_id(a, 0, 0), oneway=True)
        add(EdgeKind.ENTRY, rail_id(a, 0, 0), lane_a_id(a + 1), oneway=True)

    # Docks are sidings off lane B: in from upstream B[a+1], out to B[a]. A robot dropping off
    # never blocks the lane, and never has to reverse out of a dead end.
    for a in cfg.docks.aisles:
        nodes[dock_id(a)] = Node(id=dock_id(a), kind=NodeKind.DOCK, pos=geo.dock(a), sensor=True, aisle=a)
        add(EdgeKind.DOCK, lane_b_id(a + 1), dock_id(a), oneway=True)
        add(EdgeKind.DOCK, dock_id(a), lane_b_id(a), oneway=True)

    # --- parking: a dead-end spur past the last column of each aisle, one per level.
    # Dead ends never lie on anyone else's shortest path, so parked robots block nothing.
    for a in range(r.aisles):
        for lv in range(r.levels):
            pid = parking_id(a, lv)
            nodes[pid] = Node(id=pid, kind=NodeKind.PARKING, pos=geo.parking(a, lv, r.columns), sensor=True, aisle=a, level=lv)
            add(EdgeKind.PARKING, rail_id(a, r.columns - 1, lv), pid)

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
        dimensions={**asdict(cfg.dimensions), "aisle_spacing": geo.aisle_spacing},
        shape=asdict(r),
    )


def _rail_has_sensor(column: int, columns: int, lifts: set[int], every: int) -> bool:
    """Sensors at rail ends, at every lift junction, and optionally every N columns."""
    return column in (0, columns - 1) or column in lifts or (every > 0 and column % every == 0)


def _assign_blocks(
    raw_edges: list[tuple[EdgeKind, str, str, bool]], nodes: dict[str, Node]
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
    for i, (_, u, v, _oneway) in enumerate(raw_edges):
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
    for i, (kind, u, v, oneway) in enumerate(raw_edges):
        bid = block_of_root.setdefault(find(i), f"B{len(block_of_root)}")
        eid = f"E{i}"
        edges.append(Edge(id=eid, kind=kind, u=u, v=v, length=math.dist(nodes[u].pos, nodes[v].pos), block=bid, oneway=oneway))
        block_edges.setdefault(bid, []).append(eid)
        block_sensors.setdefault(bid, set()).update(n for n in (u, v) if nodes[n].sensor)

    blocks = [Block(id=b, edges=block_edges[b], sensors=sorted(block_sensors[b])) for b in block_edges]
    return edges, blocks
