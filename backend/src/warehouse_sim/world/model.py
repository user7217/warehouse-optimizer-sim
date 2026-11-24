"""The static warehouse: a graph of rail positions plus the storage slots they serve.

Algorithms only ever see this graph. The 3D picture is derived from it, never the
other way round, so a new physical layout is just a new graph builder.
"""

from __future__ import annotations

from enum import StrEnum
from functools import cached_property

from pydantic import BaseModel

Vec3 = tuple[float, float, float]  # world coordinates, metres; y is up


class NodeKind(StrEnum):
    RAIL = "rail"          # a stop on an aisle rail (horizontal and/or vertical)
    TRANSFER = "transfer"  # a stop on the floor transfer rail across aisle mouths
    DOCK = "dock"          # pickup/drop station
    PARKING = "parking"    # dead-end spur at the back of each aisle; idle robots wait here


class EdgeKind(StrEnum):
    HORIZONTAL = "horizontal"  # along an aisle, same level
    VERTICAL = "vertical"      # lift, same column
    TRANSFER = "transfer"      # along the transfer rail
    ENTRY = "entry"            # transfer rail <-> aisle mouth
    DOCK = "dock"              # transfer rail <-> dock
    PARKING = "parking"        # aisle end <-> parking spur


class Node(BaseModel):
    id: str
    kind: NodeKind
    pos: Vec3
    sensor: bool  # a sensor sits here; sensors are the boundaries between blocks
    aisle: int | None = None
    column: int | None = None
    level: int | None = None


class Edge(BaseModel):
    id: str
    kind: EdgeKind
    u: str
    v: str
    length: float  # metres; travel time = length / speed, decided by the sim
    block: str     # the signalling block this edge belongs to
    oneway: bool = False  # if True, travel only u -> v


class Block(BaseModel):
    """A stretch of rail between sensors. At most one robot may be inside a block."""

    id: str
    edges: list[str]
    sensors: list[str]  # boundary nodes that report entry/exit


class Slot(BaseModel):
    """One storage cell. Reached by stopping at `access_node`."""

    id: str
    aisle: int
    side: int  # -1 or +1: which rack face of the aisle
    column: int
    level: int
    depth: int  # 0 = nearest the aisle
    access_node: str
    pos: Vec3


class World(BaseModel):
    name: str
    nodes: list[Node]
    edges: list[Edge]
    blocks: list[Block]
    slots: list[Slot]
    # Echoed so the frontend can draw rack frames without re-deriving geometry.
    dimensions: dict[str, float]
    shape: dict[str, int]

    @cached_property
    def node_by_id(self) -> dict[str, Node]:
        return {n.id: n for n in self.nodes}

    @cached_property
    def adjacency(self) -> dict[str, list[tuple[str, Edge]]]:
        """Directed adjacency: node id -> [(node you can move to, edge)]. One-way edges appear once."""
        adj: dict[str, list[tuple[str, Edge]]] = {n.id: [] for n in self.nodes}
        for e in self.edges:
            adj[e.u].append((e.v, e))
            if not e.oneway:
                adj[e.v].append((e.u, e))
        return adj

    def neighbors(self, node_id: str) -> list[tuple[str, Edge]]:
        """Nodes reachable in one legal move from `node_id` (respects one-way edges)."""
        return self.adjacency[node_id]
