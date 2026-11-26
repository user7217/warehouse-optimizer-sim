// Scenario form model: field specs with ranges (from the comments in types.ts), validation,
// derived numbers, and the size limits that decide which views can render a world.

import type { Arrival, Scenario, World } from './types'

/**
 * Above these sizes a view is not mounted at all. 3D draws every slot and rack upright as instances
 * plus one mesh per robot; the SVG graph draws one element per node and edge.
 */
export const VIEW_LIMITS = {
  threeD: { slots: 4000, nodes: 3000 },
  graph: { nodes: 30000 },
} as const

export interface WorldSize {
  slots: number
  nodes: number
}

export function worldSize(w: World): WorldSize {
  return { slots: w.slots.length, nodes: w.nodes.length }
}

export function viewSupport(size: WorldSize): { threeD: boolean; graph: boolean } {
  return {
    threeD: size.slots <= VIEW_LIMITS.threeD.slots && size.nodes <= VIEW_LIMITS.threeD.nodes,
    graph: size.nodes <= VIEW_LIMITS.graph.nodes,
  }
}

/** Rough counts before a world is built. Assumes one-deep racks (the scenario has no depth knob). */
export function estimate(s: Scenario) {
  const { aisles, columns, levels, dock_every } = s.layout
  const slots = aisles * 2 * columns * levels
  const docks = Math.ceil(aisles / Math.max(1, dock_every))
  const nodes = aisles * columns * levels + aisles * levels + 2 * aisles + 2 + docks
  const robotsMax = aisles * levels
  const items = s.workload.orders * ((s.workload.items_min + s.workload.items_max) / 2)
  return { slots, nodes, docks, robotsMax, items }
}

// ----------------------------------------------------------------- fields --

export type FieldGroup = 'Layout' | 'Robots' | 'Workload' | 'Run'

interface BaseField {
  id: string
  group: FieldGroup
  label: string
  help: string
  /** hide when irrelevant (e.g. burst settings for steady arrival) */
  visible?: (s: Scenario) => boolean
}

export interface NumberField extends BaseField {
  kind: 'int' | 'float'
  get: (s: Scenario) => number
  set: (s: Scenario, v: number) => Scenario
  min: (s: Scenario) => number
  max: (s: Scenario) => number
  step: number
  unit?: string
}

export interface SelectField extends BaseField {
  kind: 'select'
  get: (s: Scenario) => string
  set: (s: Scenario, v: string) => Scenario
  options: { value: string; label: string }[]
}

export interface TextField extends BaseField {
  kind: 'text'
  get: (s: Scenario) => string
  set: (s: Scenario, v: string) => Scenario
}

export type Field = NumberField | SelectField | TextField

type Section = 'layout' | 'robots' | 'workload'

function num<S extends Section, K extends keyof Scenario[S] & string>(
  section: S,
  key: K,
  spec: Omit<NumberField, 'id' | 'get' | 'set' | 'min' | 'max'> & { min: number | ((s: Scenario) => number); max: number | ((s: Scenario) => number) },
): NumberField {
  const { min, max, ...rest } = spec
  return {
    ...rest,
    id: `${section}.${key}`,
    get: (s) => s[section][key] as number,
    set: (s, v) => ({ ...s, [section]: { ...s[section], [key]: v } }),
    min: typeof min === 'number' ? () => min : min,
    max: typeof max === 'number' ? () => max : max,
  }
}

const ARRIVALS: { value: Arrival; label: string }[] = [
  { value: 'all_at_once', label: 'All at once' },
  { value: 'steady', label: 'Steady stream' },
  { value: 'bursts', label: 'Bursts' },
]

export const FIELDS: Field[] = [
  // Layout
  num('layout', 'aisles', { group: 'Layout', label: 'Aisles', help: 'Parallel aisles (robot lanes).', kind: 'int', min: 1, max: 200, step: 1 }),
  num('layout', 'columns', { group: 'Layout', label: 'Columns', help: 'Rail positions along each aisle.', kind: 'int', min: 2, max: 100, step: 1 }),
  num('layout', 'levels', { group: 'Layout', label: 'Levels', help: 'Storage levels: one horizontal rail per level.', kind: 'int', min: 1, max: 20, step: 1 }),
  num('layout', 'lift_every', {
    group: 'Layout',
    label: 'Lift every',
    help: 'Vertical rails at column 0, every N columns, and the last column.',
    kind: 'int',
    min: 1,
    max: (s) => Math.max(1, s.layout.columns - 1),
    step: 1,
    unit: 'cols',
  }),
  num('layout', 'sensor_every', {
    group: 'Layout',
    label: 'Sensor every',
    help: 'Extra sensors every N columns (0 = only ends and junctions).',
    kind: 'int',
    min: 0,
    max: (s) => s.layout.columns,
    step: 1,
    unit: 'cols',
  }),
  num('layout', 'dock_every', {
    group: 'Layout',
    label: 'Dock every',
    help: 'A dock for every Nth aisle (1 = every aisle).',
    kind: 'int',
    min: 1,
    max: (s) => s.layout.aisles,
    step: 1,
    unit: 'aisles',
  }),
  // Robots
  num('robots', 'count', {
    group: 'Robots',
    label: 'Robots',
    help: 'One parking spur per aisle per level, so at most aisles × levels.',
    kind: 'int',
    min: 1,
    max: (s) => s.layout.aisles * s.layout.levels,
    step: 1,
  }),
  num('robots', 'speed', { group: 'Robots', label: 'Speed', help: 'Metres per tick.', kind: 'float', min: 0.01, max: 1, step: 0.05, unit: 'm/tick' }),
  num('robots', 'pick_ticks', { group: 'Robots', label: 'Pick time', help: 'Ticks to retrieve a box at its slot.', kind: 'int', min: 0, max: 1000, step: 1, unit: 'ticks' }),
  num('robots', 'drop_ticks', { group: 'Robots', label: 'Drop time', help: 'Ticks to hand a box over at a dock.', kind: 'int', min: 0, max: 1000, step: 1, unit: 'ticks' }),
  num('robots', 'delay_prob', {
    group: 'Robots',
    label: 'Stall chance',
    help: 'Chance per tick that a moving robot stalls (stress-tests the signalling).',
    kind: 'float',
    min: 0,
    max: 0.9,
    step: 0.05,
  }),
  // Workload
  num('workload', 'orders', { group: 'Workload', label: 'Orders', help: 'Total orders in the test.', kind: 'int', min: 1, max: 5000, step: 10 }),
  num('workload', 'items_min', { group: 'Workload', label: 'Items min', help: 'Items per order are uniform in [min, max].', kind: 'int', min: 1, max: 20, step: 1 }),
  num('workload', 'items_max', {
    group: 'Workload',
    label: 'Items max',
    help: '(1, 1) = single-item orders.',
    kind: 'int',
    min: (s) => s.workload.items_min,
    max: 20,
    step: 1,
  }),
  {
    id: 'workload.arrival',
    group: 'Workload',
    label: 'Arrival',
    help: 'How orders are released over time.',
    kind: 'select',
    options: ARRIVALS,
    get: (s) => s.workload.arrival,
    set: (s, v) => ({ ...s, workload: { ...s.workload, arrival: v as Arrival } }),
  },
  num('workload', 'rate_per_100_ticks', {
    group: 'Workload',
    label: 'Rate',
    help: 'Orders released per 100 ticks.',
    kind: 'float',
    min: 0.01,
    max: 1000,
    step: 1,
    unit: '/100 ticks',
    visible: (s) => s.workload.arrival === 'steady',
  }),
  num('workload', 'burst_size', {
    group: 'Workload',
    label: 'Burst size',
    help: 'Orders per burst.',
    kind: 'int',
    min: 1,
    max: 5000,
    step: 1,
    visible: (s) => s.workload.arrival === 'bursts',
  }),
  num('workload', 'burst_every', {
    group: 'Workload',
    label: 'Burst every',
    help: 'Ticks between bursts.',
    kind: 'int',
    min: 1,
    max: 100000,
    step: 10,
    unit: 'ticks',
    visible: (s) => s.workload.arrival === 'bursts',
  }),
  // Run
  {
    id: 'name',
    group: 'Run',
    label: 'Name',
    help: 'Shown in the results table.',
    kind: 'text',
    get: (s) => s.name,
    set: (s, v) => ({ ...s, name: v }),
  },
  {
    id: 'seed',
    group: 'Run',
    label: 'Seed',
    help: 'Same scenario + same code + same seed = same result.',
    kind: 'int',
    get: (s) => s.seed,
    set: (s, v) => ({ ...s, seed: v }),
    min: () => 0,
    max: () => 2 ** 31 - 1,
    step: 1,
  },
  {
    id: 'max_ticks',
    group: 'Run',
    label: 'Max ticks',
    help: 'The test stops (unfinished) after this many ticks.',
    kind: 'int',
    get: (s) => s.max_ticks,
    set: (s, v) => ({ ...s, max_ticks: v }),
    min: () => 10,
    max: () => 1_000_000,
    step: 100,
    unit: 'ticks',
  },
]

export const GROUPS: FieldGroup[] = ['Layout', 'Robots', 'Workload', 'Run']

/** Field id -> message, for every invalid visible field. Empty when the scenario is valid. */
export function validate(s: Scenario): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const f of FIELDS) {
    if (f.visible && !f.visible(s)) continue
    if (f.kind === 'text') {
      if (!f.get(s).trim()) errors[f.id] = 'Required'
      continue
    }
    if (f.kind === 'select') continue
    const v = f.get(s)
    const lo = f.min(s)
    const hi = f.max(s)
    if (!Number.isFinite(v)) errors[f.id] = 'Enter a number'
    else if (f.kind === 'int' && !Number.isInteger(v)) errors[f.id] = 'Whole number'
    else if (v < lo || v > hi) errors[f.id] = `${lo} – ${hi}`
  }
  return errors
}

export function sameScenario(a: Scenario, b: Scenario): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
