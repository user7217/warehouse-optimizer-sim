"""
Your warehouse algorithms. Edit, then press Run test (Cmd/Ctrl + Enter).

Define Router, Assigner, both, or neither. Anything missing uses the built-in baseline.
This file starts as the baseline itself, so you have a working reference to change.

WHAT THE SIMULATOR CALLS
    Router.route(start, goal)    -> list of node ids from start (excluded) to goal (included)
                                    []   if start == goal
                                    None = "no route right now, ask me again next tick"
    Router.distance(start, goal) -> metres, math.inf if unreachable
                                    (optional: derived from route() if you leave it out)
    Assigner.assign(tasks, robots, origin) -> list of (task_id, robot_id) pairs

Every call is timed and every answer is checked. An illegal move, unknown id or double
assignment stops the test with an error pointing at your line.

WHAT YOU GET
    world.nodes, world.edges, world.slots, world.node_by_id
    world.neighbors(node_id) -> [(next_node_id, edge), ...]   legal moves (respects one-way)
        edge.length (metres), edge.oneway, edge.block, edge.kind
        node.kind ('rail' | 'transfer' | 'dock' | 'parking'), node.pos, node.aisle/column/level
    view.tick, view.robots, view.open_tasks
    view.reservations   {resource: robot_id}   "N:<node>" sensor nodes, "B:<block>" rail blocks
    view.resource_at(node_id)

Robots move only when the block signalling allows it, so your routes can't cause collisions.
They can cause waiting and deadlocks, which the metrics measure.

Any standard-library module works (heapq, itertools, math, random, collections, ...).
print() goes to the Console panel.
"""
import heapq
import math


class Router:
    """Baseline: Dijkstra on edge length. Each robot alone; ignores the other robots."""

    def __init__(self, world, view):
        self.world = world
        self.view = view
        self.cache = {}  # source node -> (dist, prev)

    def _tree(self, source):
        if source not in self.cache:
            if len(self.cache) > 256:  # keep memory bounded on big layouts
                self.cache.clear()
            dist, prev = {source: 0.0}, {}
            heap = [(0.0, source)]
            while heap:
                d, u = heapq.heappop(heap)
                if d > dist[u]:
                    continue
                for v, edge in self.world.neighbors(u):
                    nd = d + edge.length
                    if nd < dist.get(v, math.inf):
                        dist[v], prev[v] = nd, u
                        heapq.heappush(heap, (nd, v))
            self.cache[source] = (dist, prev)
        return self.cache[source]

    def route(self, start, goal):
        dist, prev = self._tree(start)
        if goal not in dist:
            return None
        path = []
        node = goal
        while node != start:
            path.append(node)
            node = prev[node]
        return path[::-1]

    def distance(self, start, goal):
        return self._tree(start)[0].get(goal, math.inf)


class Assigner:
    """Baseline: greedy. The oldest queued task gets the nearest free robot."""

    def __init__(self, world, view, router):
        self.router = router  # your Router (timed and checked)

    def assign(self, tasks, robots, origin):
        # tasks:  queued Task objects, oldest first
        #         (t.id, t.order, t.pickup_node, t.drop_dock, t.created_tick)
        # robots: free Robot objects (r.id, r.node, r.status, ...)
        # origin: robot id -> node it would start from
        free = {r.id for r in robots}
        pairs = []
        for task in tasks:
            if not free:
                break
            best = min(sorted(free), key=lambda rid: self.router.distance(origin[rid], task.pickup_node))
            if self.router.distance(origin[best], task.pickup_node) == math.inf:
                continue
            pairs.append((task.id, best))
            free.remove(best)
        return pairs
