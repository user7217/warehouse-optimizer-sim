// THE CONTRACT between the Python engine (running in Pyodide inside a Web Worker) and the UI.
// Mirrors engine/src/warehouse_sim/runner.py and the dataclasses it serialises.
//
// Nothing here talks to a server. The engine and the user's algorithm code both run in the
// visitor's browser. The server only serves static files.
//
// Python entry points (module `warehouse_sim.runner`). Every function takes/returns JSON strings
// unless noted, and never raises: failures come back as `UserError` objects.
//
//   presets()                       -> Presets
//   default_code()                  -> string (plain Python source: the editor template)
//   check_code(code: str)           -> CodeCheck          compile + interface check, no simulation
//   open_session(scenario_json, code) -> OpenResult       build world + sim; code "" = baselines
//   step(n: int)                    -> SimState           advance up to n ticks (stops at finish/error)
//   get_state()                     -> SimState
//   add_orders(count: int)          -> SimState           extra orders now, using the scenario's order sizes
//   run_chunk(budget_ms: float)     -> ChunkResult        headless: advance as many ticks as fit in budget_ms
//   report()                        -> TestReport         for the current session
//
// User code: Python source defining optionally `class Router` and/or `class Assigner`
// (see default_code()). Missing classes fall back to the built-in baselines. print() output is
// the worker's job to capture (redirect sys.stdout/sys.stderr before calling into Python).

export type Vec3 = [number, number, number]

// ------------------------------------------------------------------ world --

export type NodeKind = 'rail' | 'transfer' | 'dock' | 'parking'
export type EdgeKind = 'horizontal' | 'vertical' | 'transfer' | 'entry' | 'dock' | 'parking'

export interface WNode {
  id: string
  kind: NodeKind
  pos: Vec3
  sensor: boolean
  aisle: number | null
  column: number | null
  /** set for rail and parking nodes (parking spurs exist at every level of each aisle's back end) */
  level: number | null
}

export interface WEdge {
  id: string
  kind: EdgeKind
  u: string
  v: string
  length: number
  block: string
  /** if true, robots travel only u -> v */
  oneway: boolean
}

export interface Block {
  id: string
  edges: string[]
  sensors: string[]
}

export interface Slot {
  id: string
  aisle: number
  side: -1 | 1
  column: number
  level: number
  depth: number
  access_node: string
  pos: Vec3
}

export interface World {
  name: string
  nodes: WNode[]
  edges: WEdge[]
  blocks: Block[]
  slots: Slot[]
  dimensions: {
    column_pitch: number
    level_height: number
    slot_depth: number
    aisle_width: number
    aisle_spacing: number
  }
  shape: { aisles: number; columns: number; levels: number; depth: number }
}

// --------------------------------------------------------------- scenario --

export type Arrival = 'all_at_once' | 'steady' | 'bursts'

/** One test configuration. Everything a run depends on; same scenario + same code = same result. */
export interface Scenario {
  name: string
  layout: {
    aisles: number //        1..200
    columns: number //       2..100
    levels: number //        1..20
    lift_every: number //    lifts at column 0, every N columns, and the last column
    sensor_every: number //  extra sensors every N columns (0 = only ends + junctions)
    dock_every: number //    a dock for every Nth aisle (1 = every aisle)
  }
  robots: {
    count: number //         1..(aisles * levels)  (one parking spur per aisle per level)
    speed: number //         metres per tick
    pick_ticks: number
    drop_ticks: number
    delay_prob: number //    0..0.9, chance per tick a moving robot stalls
  }
  workload: {
    orders: number //              total orders in the test
    items_min: number //           items per order: uniform in [items_min, items_max]
    items_max: number //           (1, 1) = single-item orders
    arrival: Arrival
    rate_per_100_ticks: number //  'steady': orders released per 100 ticks
    burst_size: number //          'bursts': orders per burst
    burst_every: number //         'bursts': ticks between bursts
  }
  seed: number
  max_ticks: number //             test stops (unfinished) after this many ticks
}

export interface Presets {
  default: string
  presets: Record<string, Scenario>
}

// ------------------------------------------------------------- user code --

export interface UserError {
  /** where it went wrong */
  phase: 'compile' | 'init' | 'router' | 'assigner' | 'validation' | 'scenario' | 'engine'
  message: string
  /** Python traceback, trimmed to the user's file where possible */
  traceback: string
  /** 1-based line in the user's code, when known */
  line: number | null
}

export interface CodeCheck {
  ok: boolean
  error: UserError | null
  /** which classes the code defines (others use the baselines) */
  provides: { router: boolean; assigner: boolean }
}

export interface OpenResult {
  ok: boolean
  error: UserError | null
  world: World | null
  state: SimState | null
}

// ------------------------------------------------------------------ state --

export type RobotStatus = 'idle' | 'moving' | 'waiting' | 'retrieving' | 'delivering' | 'failed'

export interface Robot {
  id: string
  status: RobotStatus
  /** last node a sensor confirmed */
  node: string
  /** node it is travelling towards, or null when stopped at `node` */
  next_node: string | null
  /** 0..1 along node -> next_node. Render position = lerp(node.pos, next_node.pos, progress). */
  progress: number
  task: string | null
  payload: string[]
  /** planned node ids still ahead, excluding next_node */
  path: string[]
  /** 'pickup' | 'drop' | 'home' | 'backoff' | null when parked */
  goal: string | null
  goal_node: string | null
  home: string
  waiting_for: string | null
  wait_ticks: number
  distance: number
  delivered: number
}

export type TaskStatus = 'queued' | 'assigned' | 'carried' | 'delivered' | 'stranded'

/** One item of an order: pick it from a slot, deliver it to the order's dock. */
export interface Task {
  id: string
  order: string
  pickup_slot: string
  pickup_node: string
  drop_dock: string
  status: TaskStatus
  robot: string | null
  created_tick: number
  assigned_tick: number | null
  picked_tick: number | null
  delivered_tick: number | null
}

export interface Metrics {
  orders_total: number //         orders released so far
  orders_done: number
  orders_planned: number //       orders the scenario will release in total
  tasks_total: number
  delivered: number //            tasks (items) delivered
  throughput_per_100: number //   items delivered per 100 ticks
  avg_delivery_ticks: number | null //  item: created -> delivered
  p95_delivery_ticks: number | null
  max_delivery_ticks: number | null
  avg_queue_ticks: number | null //     item: created -> assigned
  avg_order_ticks: number | null //     order: released -> last item delivered
  total_wait_ticks: number //     robot-ticks spent blocked by another robot
  waiting_now: number
  utilization: number //          0..1, robot-ticks not idle / all robot-ticks
  wait_fraction: number //        0..1, robot-ticks waiting / all robot-ticks
  distance_total: number //       metres, all robots
  deadlocks: number
  backoffs: number
}

/** Wall-clock cost of code, measured in the browser with time.perf_counter. Milliseconds. */
export interface CallStats {
  calls: number
  total_ms: number
  mean_ms: number
  p95_ms: number
  max_ms: number
}

export interface Timing {
  route: CallStats //   Router.route + Router.distance calls (user or baseline)
  assign: CallStats //  Assigner.assign calls
  tick: CallStats //    whole engine tick, including the above
  wall_ms: number //    total wall time spent inside step()/run_chunk() so far
}

export interface SimEvent {
  tick: number
  kind: 'assigned' | 'picked' | 'delivered' | 'order_done' | 'deadlock' | 'backoff' | 'info' | 'error'
  msg: string
}

export interface SimState {
  tick: number
  /** all orders released and delivered */
  finished: boolean
  /** set when user code failed; the sim stops until a new session is opened */
  error: UserError | null
  robots: Robot[]
  /** all open tasks plus the most recent delivered ones (capped) */
  tasks: Task[]
  metrics: Metrics
  timing: Timing
  /** most recent events, newest last (capped) */
  events: SimEvent[]
}

// ------------------------------------------------------------------ tests --

export interface ChunkResult {
  done: boolean
  tick: number
  /** 0..1, best estimate: max(orders_done / orders_planned, tick / max_ticks) */
  progress: number
  /** present when done */
  report: TestReport | null
  /** latest state, for live metrics while a test runs */
  state: SimState
}

export interface TestReport {
  scenario: Scenario
  provides: { router: boolean; assigner: boolean }
  finished: boolean
  reason: 'complete' | 'max_ticks' | 'error'
  /** ticks until the last order was delivered (makespan), or ticks run when unfinished */
  ticks: number
  metrics: Metrics
  timing: Timing
  error: UserError | null
}
