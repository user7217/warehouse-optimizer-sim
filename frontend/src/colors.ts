import type { EdgeKind, RobotStatus } from './types'

export const EDGE_KIND_COLOR: Record<EdgeKind, string> = {
  horizontal: '#5b9cf5',
  vertical: '#f5a623',
  transfer: '#9b7bf0',
  entry: '#9b7bf0',
  dock: '#3ecf8e',
}

export const SENSOR_COLOR = '#ff5c7a'
export const DOCK_COLOR = '#3ecf8e'

export const STATUS_COLOR: Record<RobotStatus, string> = {
  idle: '#8a94a6',
  moving: '#5b9cf5',
  waiting: '#f5a623',
  retrieving: '#9b7bf0',
  delivering: '#3ecf8e',
  failed: '#ff5c7a',
}

/** Distinct, stable colour per block id ("B17" -> hue). Golden-angle spacing. */
export function blockColor(blockId: string): string {
  const n = Number(blockId.slice(1)) || 0
  return `hsl(${(n * 137.508) % 360}, 70%, 60%)`
}

export type ColorMode = 'kind' | 'block'

export function edgeColor(kind: EdgeKind, block: string, mode: ColorMode): string {
  return mode === 'block' ? blockColor(block) : EDGE_KIND_COLOR[kind]
}
