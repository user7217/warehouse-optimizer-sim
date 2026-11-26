import type { EdgeKind, RobotStatus } from './types'

// Palette from VS Code's "Dark 2026" theme: charts.* colours, accent #3994BC, errorForeground.
// Rails are a step dimmer than robots so moving robots stay the most visible thing.
export const EDGE_KIND_COLOR: Record<EdgeKind, string> = {
  horizontal: '#2F7EA3', // accent, dimmed
  vertical: '#E0B97F', //   charts.yellow: lifts
  transfer: '#AD80D7', //   charts.purple: one-way loop
  entry: '#AD80D7',
  dock: '#86CF86', //       charts.green
  parking: '#5A5D5F',
}

export const SENSOR_COLOR = '#F48771' // errorForeground
export const DOCK_COLOR = '#86CF86'
export const PARKING_COLOR = '#5A5D5F'
/** A carried box on top of a robot. */
export const PAYLOAD_COLOR = '#FFA657' // entity.name orange

export const STATUS_COLOR: Record<RobotStatus, string> = {
  idle: '#8C8C8C', //       descriptionForeground
  moving: '#57A3F8', //     charts.blue
  waiting: '#CD861A', //    charts.orange
  retrieving: '#AD80D7', // charts.purple
  delivering: '#86CF86', // charts.green
  failed: '#F48771', //     errorForeground
}

/** Distinct, stable colour per block id ("B17" -> hue). Golden-angle spacing. */
export function blockColor(blockId: string): string {
  const n = Number(blockId.slice(1)) || 0
  return `hsl(${(n * 137.508) % 360}, 55%, 62%)`
}

export type ColorMode = 'kind' | 'block'

export function edgeColor(kind: EdgeKind, block: string, mode: ColorMode): string {
  return mode === 'block' ? blockColor(block) : EDGE_KIND_COLOR[kind]
}
