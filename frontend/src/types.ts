// Mirrors backend/src/warehouse_sim/world/model.py and sim/state.py.
// Keep in sync by hand for now; generate from OpenAPI if it starts drifting.

export type Vec3 = [number, number, number]

export type NodeKind = 'rail' | 'transfer' | 'dock'
export type EdgeKind = 'horizontal' | 'vertical' | 'transfer' | 'entry' | 'dock'

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
  node: string
  task: string | null
  payload: string[]
  path: string[]
}

export type TaskStatus = 'queued' | 'assigned' | 'carried' | 'delivered' | 'stranded'

export interface Task {
  id: string
  pickup_slot: string
  drop_dock: string
  status: TaskStatus
  robot: string | null
  created_tick: number
}

export interface SimState {
  tick: number
  robots: Robot[]
  tasks: Task[]
}
