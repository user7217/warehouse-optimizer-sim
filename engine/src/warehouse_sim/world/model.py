"""The static warehouse: a graph of rail positions plus the storage slots they serve.

Algorithms only ever see this graph. The 3D picture is derived from it, never the
other way round, so a new physical layout is just a new graph builder.

Pure standard library (runs unchanged in CPython and in Pyodide in the browser).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum

Vec3 = tuple[float, float, float]  # world coordinates, metres; y is up


class NodeKind(StrEnum):
    RAIL = "rail"          # a stop on an aisle rail (horizontal and/or vertical)
    TRANSFER = "transfer"  # a stop on the one-way transfer loop across aisle mouths
    DOCK = "dock"          # drop-off station (a siding off the transfer loop)
    PARKING = "parking"    # dead-end spur at the back of each aisle, one per level


class EdgeKind(StrEnum):
    HORIZONTAL = "horizontal"  # along an aisle, same level
    VERTICAL = "vertical"      # lift, same column
    TRANSFER = "transfer"      # along the transfer loop
    ENTRY = "entry"            # transfer loop <-> aisle mouth
    DOCK = "dock"              # transfer loop <-> dock siding
    PARKING = "parking"        # aisle end <-> parking spur


@dataclass(slots=True)
class Node:
    id: str
    kind: NodeKind
    pos: Vec3
    sensor: bool  # sensors are the boundaries between signalling blocks
    aisle: int | None = None
    column: int | None = None
    level: int | None = None

    def to_dict(self) -> dict:
        return {"id": self.id, "kind": self.kind.value, "pos": list(self.pos), "sensor": self.sensor,
                "aisle": self.aisle, "column": self.column, "level": self.level}


@dataclass(slots=True)
class Edge:
    id: str
    kind: EdgeKind
    u: str
    v: str
    length: float  # metres; travel time = length / speed, decided by the sim
    block: str     # the signalling block this edge belongs to
    oneway: bool = False  # if True, travel only u -> v

    def to_dict(self) -> dict:
        return {"id": self.id, "kind": self.kind.value, "u": self.u, "v": self.v, "length": self.length,
                "block": self.block, "oneway": self.oneway}


@dataclass(slots=True)
class Block:
    """A stretch of rail between sensors. At most one robot may be inside a block."""

    id: str
    edges: list[str]
    sensors: list[str]  # boundary nodes that report entry/exit

    def to_dict(self) -> dict:
        return {"id": self.id, "edges": self.edges, "sensors": self.sensors}


@dataclass(slots=True)
class Slot:
    """One storage cell. Reached by stopping at `access_node`."""

    id: str
    aisle: int
    side: int  # -1 or +1: which rack face of the aisle
    column: int
    level: int
    depth: int  # 0 = nearest the aisle
    access_node: str
    pos: Vec3

    def to_dict(self) -> dict:
        return {"id": self.id, "aisle": self.aisle, "side": self.side, "column": self.column, "level": self.level,
                "depth": self.depth, "access_node": self.access_node, "pos": list(self.pos)}


@dataclass
class World:
    name: str
    nodes: list[Node]
    edges: list[Edge]
    blocks: list[Block]
    slots: list[Slot]
    dimensions: dict[str, float]  # echoed for the frontend's geometry
    shape: dict[str, int]
    node_by_id: dict[str, Node] = field(init=False, repr=False)
    adjacency: dict[str, list[tuple[str, Edge]]] = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self.node_by_id = {n.id: n for n in self.nodes}
        # Directed adjacency: node -> [(node you can move to, edge)]. One-way edges appear once.
        adj: dict[str, list[tuple[str, Edge]]] = {n.id: [] for n in self.nodes}
        for e in self.edges:
            adj[e.u].append((e.v, e))
            if not e.oneway:
                adj[e.v].append((e.u, e))
        self.adjacency = adj

    def neighbors(self, node_id: str) -> list[tuple[str, Edge]]:
        """Nodes reachable in one legal move from `node_id` (respects one-way edges)."""
        return self.adjacency[node_id]

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "nodes": [n.to_dict() for n in self.nodes],
            "edges": [e.to_dict() for e in self.edges],
            "blocks": [b.to_dict() for b in self.blocks],
            "slots": [s.to_dict() for s in self.slots],
            "dimensions": dict(self.dimensions),
            "shape": dict(self.shape),
        }
