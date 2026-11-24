import { useMemo, useRef } from 'react'
import { DOCK_COLOR, PARKING_COLOR, SENSOR_COLOR, STATUS_COLOR, edgeColor, type ColorMode } from '../colors'
import { usePanZoom, type Bounds } from '../hooks/usePanZoom'
import { robotPoint, robotRoute } from '../robotPos'
import type { Robot, WNode, World } from '../types'

const UNIT = 36 // world units per grid step
const PANEL_GAP = 1.5 // grid steps between aisle panels

/**
 * Schematic layout: each aisle is drawn as an elevation (column across, level up),
 * panels stacked top to bottom. The transfer rail and docks sit on the left,
 * at floor level of each aisle; parking spurs sit just past the last column.
 * This is the graph the planner sees, flattened.
 */
function graphPos(n: WNode, world: World): [number, number] {
  const { levels, columns } = world.shape
  const { column_pitch, aisle_spacing } = world.dimensions
  // Floor row of a (possibly fractional) aisle index; linear, so in-between nodes land in between.
  const floorRow = (k: number) => k * (levels + PANEL_GAP) + (levels - 1)
  if (n.kind === 'rail') return [n.column! * UNIT, (floorRow(n.aisle!) - n.level!) * UNIT]
  if (n.kind === 'parking') return [columns * UNIT, floorRow(n.aisle!) * UNIT]
  // Transfer lanes and docks: place from their real floor position (x across, z -> aisle rows).
  return [(n.pos[0] / column_pitch) * UNIT, floorRow(n.pos[2] / aisle_spacing) * UNIT]
}

/** Small chevron at an edge's midpoint pointing u -> v. */
function arrowPath(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2
  const len = Math.hypot(x2 - x1, y2 - y1) || 1
  const ux = (x2 - x1) / len
  const uy = (y2 - y1) / len
  const s = 6
  return `M ${mx - ux * s - uy * s} ${my - uy * s + ux * s} L ${mx + ux * s} ${my + uy * s} L ${mx - ux * s + uy * s} ${my - uy * s - ux * s}`
}

interface Props {
  world: World
  robots: Robot[]
  colorMode: ColorMode
  selectedRobot: string | null
  onSelectRobot: (id: string) => void
  /** expected ms between server updates; robot dots glide for this long */
  updatePeriodMs: number
}

export function GraphView({ world, robots, colorMode, selectedRobot, onSelectRobot, updatePeriodMs }: Props) {
  const { levels, aisles } = world.shape
  const pos = useMemo(() => new Map(world.nodes.map((n) => [n.id, graphPos(n, world)])), [world])
  const posOf = (id: string) => pos.get(id)
  const bounds = useMemo<Bounds>(() => {
    const xs = [...pos.values()].map((p) => p[0])
    const ys = [...pos.values()].map((p) => p[1])
    return { minX: Math.min(...xs) - UNIT, minY: Math.min(-UNIT * 1.4, Math.min(...ys) - UNIT), maxX: Math.max(...xs) + UNIT, maxY: Math.max(...ys) + UNIT }
  }, [pos])
  const selected = robots.find((r) => r.id === selectedRobot)
  const svgRef = useRef<SVGSVGElement>(null)
  const { viewBox, fit, zoomCenter } = usePanZoom(svgRef, bounds)

  return (
    <div className="graph-wrap">
      <svg ref={svgRef} className="graph" viewBox={viewBox}>
        {Array.from({ length: aisles }, (_, a) => (
          <text key={a} className="graph-label" x={0} y={a * (levels + PANEL_GAP) * UNIT - UNIT * 0.6}>
            Aisle {a}
          </text>
        ))}

        {world.edges.map((e) => {
          const [x1, y1] = pos.get(e.u)!
          const [x2, y2] = pos.get(e.v)!
          const color = edgeColor(e.kind, e.block, colorMode)
          return (
            <g key={e.id}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={3} strokeLinecap="round">
                <title>{`${e.id} · ${e.kind}${e.oneway ? ' · one-way' : ''} · block ${e.block} · ${e.length.toFixed(2)} m`}</title>
              </line>
              {e.oneway && <path d={arrowPath(x1, y1, x2, y2)} className="graph-arrow" stroke={color} />}
            </g>
          )
        })}

        {world.nodes.map((n) => {
          const [x, y] = pos.get(n.id)!
          const label = `${n.id}${n.sensor ? ' · sensor' : ''}`
          if (n.kind === 'parking')
            return (
              <rect key={n.id} x={x - 8} y={y - 8} width={16} height={16} rx={3} fill="none" stroke={PARKING_COLOR} strokeWidth={2}>
                <title>{label} · parking</title>
              </rect>
            )
          if (n.kind === 'dock')
            return (
              <rect key={n.id} x={x - 10} y={y - 10} width={20} height={20} rx={3} fill={DOCK_COLOR}>
                <title>{label}</title>
              </rect>
            )
          return (
            <circle key={n.id} className={n.sensor ? 'graph-sensor' : 'graph-node'} cx={x} cy={y} r={n.sensor ? 5 : 2.5} stroke={n.sensor ? SENSOR_COLOR : 'none'} strokeWidth={2}>
              <title>{label}</title>
            </circle>
          )
        })}

        {selected && <RoutePolyline robot={selected} posOf={posOf} />}

        {robots.map((r) => {
          const p = robotPoint(r, posOf)
          if (!p) return null
          const isSel = r.id === selectedRobot
          // CSS transition on the transform glides the dot between server updates.
          const style = { transform: `translate(${p[0]}px, ${p[1]}px)`, transitionDuration: `${updatePeriodMs}ms` }
          return (
            <g key={r.id} className="graph-robot" style={style} onClick={() => onSelectRobot(r.id)}>
              {isSel && <circle r={15} fill="none" className="graph-selected" strokeWidth={2.5} />}
              <circle r={9} fill={STATUS_COLOR[r.status]} />
              {r.payload.length > 0 && <rect x={-3.5} y={-3.5} width={7} height={7} className="graph-payload" />}
              <title>{`${r.id} · ${r.status}${r.payload.length ? ' · carrying' : ''}`}</title>
            </g>
          )
        })}
      </svg>

      <div className="float-bar top-right">
        <button title="Zoom out" onClick={() => zoomCenter(1 / 1.25)}>−</button>
        <button title="Zoom in" onClick={() => zoomCenter(1.25)}>+</button>
        <button title="Fit (double-click)" onClick={fit}>Fit</button>
      </div>
      <div className="hint">Pinch to zoom · two-finger scroll or drag to pan · double-click to fit</div>
    </div>
  )
}

function RoutePolyline({ robot, posOf }: { robot: Robot; posOf: (id: string) => readonly number[] | undefined }) {
  const pts = robotRoute(robot, posOf)
  if (pts.length < 2) return null
  return <polyline className="graph-route" points={pts.map((p) => `${p[0]},${p[1]}`).join(' ')} stroke={STATUS_COLOR[robot.status]} />
}
