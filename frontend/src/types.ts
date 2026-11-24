// THE CONTRACT between backend and frontend.
// Mirrors backend/src/warehouse_sim/world/model.py and backend/src/warehouse_sim/sim/state.py.
// Keep in sync by hand for now.
//
// Transport:
//   GET  /api/world                 -> World            (static layout, fetch once)
//   GET  /api/state                 -> SimState         (snapshot)
//   WS   /ws                        -> SimState JSON, pushed after every tick and after every command
//   POST /api/sim/run               -> SimState         start ticking at sim.speed ticks/s
//   POST /api/sim/pause             -> SimState
//   POST /api/sim/step              -> SimState         advance exactly one tick (works while paused)
//   POST /api/sim/reset             -> SimState         robots home, tasks cleared, tick 0
//   POST /api/sim/speed  {ticks_per_second: number}    -> SimState
//   POST /api/tasks      {count: number}               -> SimState   add `count` random pickup->dock tasks
//   POST /api/tasks      {pickup_slot: string, drop_dock: string} -> SimState  add one specific task

export type Vec3 = [number, number, number]

export type NodeKind = 'rail' | 'transfer' | 'dock' | 'parking'
export type EdgeKind = 'horizontal' | 'vertical' | 'transfer' | 'entry' | 'dock' | 'parking'

export interface WNode {
  id: string
  kind: NodeKind
  pos: Vec3
  sensor: boolean
  aisle: number | null
  column: number | null
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

export type RobotStatus = 'idle' | 'moving' | 'waiting' | 'retrieving' | 'delivering' | 'failed'

export interface Robot {
  id: string
  status: RobotStatus
  /** last node a sensor confirmed */
  node: string
  /** node it is currently travelling towards, or null when stopped at `node` */
  next_node: string | null
  /** 0..1 along the edge node -> next_node. Render position = lerp(node.pos, next_node.pos, progress). */
  progress: number
  task: string | null
  /** task ids on board (0 or 1 in the baseline) */
  payload: string[]
  /** planned node ids still ahead, excluding next_node */
  path: string[]
  /** what the robot is heading for: 'pickup' | 'drop' | 'home' | 'backoff' | null when parked */
  goal: string | null
  goal_node: string | null
  /** its parking spur */
  home: string
  /** robot id it is blocked by, when status === 'waiting' */
  waiting_for: string | null
  wait_ticks: number
  distance: number
  delivered: number
}

export type TaskStatus = 'queued' | 'assigned' | 'carried' | 'delivered' | 'stranded'

export interface Task {
  id: string
  pickup_slot: string
  pickup_node: string
  drop_dock: string
  status: TaskStatus
  robot: string | null
  created_tick: number
  picked_tick: number | null
  delivered_tick: number | null
}

export interface Metrics {
  delivered: number
  /** deliveries per 100 ticks since tick 0 */
  throughput_per_100: number
  /** mean ticks from task creation to delivery, null until the first delivery */
  avg_delivery_ticks: number | null
  /** sum over robots of ticks spent waiting on another robot */
  total_wait_ticks: number
  waiting_now: number
  deadlocks: number
  backoffs: number
}

export interface SimEvent {
  tick: number
  kind: 'assigned' | 'picked' | 'delivered' | 'deadlock' | 'backoff' | 'info'
  msg: string
}

export interface SimState {
  tick: number
  running: boolean
  ticks_per_second: number
  robots: Robot[]
  /** all non-delivered tasks plus the most recent delivered ones (capped) */
  tasks: Task[]
  metrics: Metrics
  /** most recent events, newest last (capped) */
  events: SimEvent[]
}
