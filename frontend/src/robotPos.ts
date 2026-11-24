import type { Robot } from './types'

type Point = readonly number[]

function lerp(a: Point, b: Point, t: number): number[] {
  return a.map((v, i) => v + (b[i] - v) * t)
}

/**
 * Where a robot should be drawn, in whatever coordinate space `posOf` maps node ids into
 * (3D world metres or 2D graph units): lerp(node, next_node, progress), or `node` when stopped.
 */
export function robotPoint(r: Robot, posOf: (id: string) => Point | undefined): number[] | null {
  const a = posOf(r.node)
  if (!a) return null
  const b = r.next_node ? posOf(r.next_node) : undefined
  if (!b) return [...a]
  return lerp(a, b, Math.min(1, Math.max(0, r.progress)))
}

/** The robot's remaining route as points: current position, next_node, then the planned path. */
export function robotRoute(r: Robot, posOf: (id: string) => Point | undefined): number[][] {
  const here = robotPoint(r, posOf)
  if (!here) return []
  const ahead = [r.next_node, ...r.path].flatMap((id) => {
    const p = id ? posOf(id) : undefined
    return p ? [[...p]] : []
  })
  return [here, ...ahead]
}
