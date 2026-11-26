"""Block signalling: the safety layer. Not an algorithm you swap; every planner runs on top of it.

Resources:
  "N:<node>"  a sensor node (rail end, junction, dock, parking...). One robot may stand there.
  "B:<block>" a stretch of rail between sensors. One robot may be inside it.

A robot stopped at a sensor node holds that node. A robot stopped at an interior node, or travelling
along an edge, holds the edge's block. Before stepping a -> b a robot must acquire, atomically:
  - the block of edge (a, b)
  - node b, if b is a sensor
If either is held by someone else it waits. This makes collisions and head-on swaps impossible,
whatever the planner does, as long as robots only move through `try_depart`.
"""

from __future__ import annotations

from warehouse_sim.world import Edge, World


class Signalling:
    def __init__(self, world: World):
        self.world = world
        self.holder: dict[str, str] = {}  # resource -> robot id
        self._edge_between: dict[tuple[str, str], Edge] = {}
        for e in world.edges:
            self._edge_between[(e.u, e.v)] = e
            self._edge_between[(e.v, e.u)] = e
        # an interior (sensor-less) node sits inside exactly one block
        self._block_of_node: dict[str, str] = {}
        for e in world.edges:
            for n in (e.u, e.v):
                if not world.node_by_id[n].sensor:
                    self._block_of_node[n] = e.block

    # ------------------------------------------------------------ queries --
    def edge(self, a: str, b: str) -> Edge:
        return self._edge_between[(a, b)]

    def resource_at(self, node: str) -> str:
        """What a robot standing still at `node` holds."""
        return f"N:{node}" if self.world.node_by_id[node].sensor else f"B:{self._block_of_node[node]}"

    def needs_for_step(self, a: str, b: str) -> list[str]:
        need = [f"B:{self.edge(a, b).block}"]
        if self.world.node_by_id[b].sensor:
            need.append(f"N:{b}")
        return need

    def blocker(self, robot_id: str, resources: list[str]) -> str | None:
        """First robot (other than `robot_id`) holding any of `resources`, else None."""
        for r in resources:
            h = self.holder.get(r)
            if h is not None and h != robot_id:
                return h
        return None

    def held_by(self, robot_id: str) -> list[str]:
        return [r for r, h in self.holder.items() if h == robot_id]

    # ------------------------------------------------------------ actions --
    def place(self, robot_id: str, node: str) -> None:
        """Put a robot at a node at start-up. Raises if occupied."""
        res = self.resource_at(node)
        if res in self.holder:
            raise ValueError(f"{node} already occupied by {self.holder[res]}")
        self.holder[res] = robot_id

    def try_depart(self, robot_id: str, a: str, b: str) -> str | None:
        """Acquire what stepping a -> b needs. Returns None on success, else the blocking robot id."""
        need = self.needs_for_step(a, b)
        blocking = self.blocker(robot_id, need)
        if blocking is not None:
            return blocking
        for r in need:
            self.holder[r] = robot_id
        if self.world.node_by_id[a].sensor:  # physically left the sensor at a
            self.holder.pop(f"N:{a}", None)
        return None

    def arrive(self, robot_id: str, a: str, b: str) -> None:
        """Robot finished edge a -> b. Leaving the block if b is a sensor (block boundary)."""
        if self.world.node_by_id[b].sensor:
            block = f"B:{self.edge(a, b).block}"
            if self.holder.get(block) == robot_id:
                del self.holder[block]

    def clear(self) -> None:
        self.holder.clear()
