import { useMemo, useRef } from 'react'
import { DOCK_COLOR, SENSOR_COLOR, STATUS_COLOR, edgeColor, type ColorMode } from '../colors'
import { usePanZoom, type Bounds } from '../hooks/usePanZoom'
import type { Robot, WNode, World } from '../types'

const UNIT = 36 // world units per grid step
const PANEL_GAP = 1.5 // grid steps between aisle panels

/**
 * Schematic layout: each aisle is drawn as an elevation (column across, level up),
 * panels stacked top to bottom. The transfer rail and docks sit on the left,
 * at floor level of each aisle. This is the graph the planner sees, flattened.
 */
function graphPos(n: WNode, levels: number): [number, number] {
  const a = n.aisle ?? 0
  const floorRow = a * (levels + PANEL_GAP) + (levels - 1)
  if (n.kind === 'rail') return [n.column! * UNIT, (floorRow - n.level!) * UNIT]
  if (n.kind === 'transfer') return [-1.5 * UNIT, floorRow * UNIT]
  return [-3 * UNIT, floorRow * UNIT] // dock
}

interface Props {
  world: World
  robots: Robot[]
  colorMode: ColorMode
  selectedRobot: string | null
  onSelectRobot: (id: string) => void
}

export function GraphView({ world, robots, colorMode, selectedRobot, onSelectRobot }: Props) {
  const { levels, aisles, columns } = world.shape
  const pos = useMemo(() => new Map(world.nodes.map((n) => [n.id, graphPos(n, levels)])), [world, levels])
  const bounds = useMemo<Bounds>(
    () => ({
      minX: -3 * UNIT - UNIT,
      minY: -UNIT * 1.4,
      maxX: (columns - 1) * UNIT + UNIT,
      maxY: ((aisles - 1) * (levels + PANEL_GAP) + levels - 1) * UNIT + UNIT,
    }),
    [aisles, columns, levels],
  )
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
          return (
            <line key={e.id} x1={x1} y1={y1} x2={x2} y2={y2} stroke={edgeColor(e.kind, e.block, colorMode)} strokeWidth={3} strokeLinecap="round">
              <title>{`${e.id} · ${e.kind} · block ${e.block} · ${e.length.toFixed(2)} m`}</title>
            </line>
          )
        })}

        {world.nodes.map((n) => {
          const [x, y] = pos.get(n.id)!
          const label = `${n.id}${n.sensor ? ' · sensor' : ''}`
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

        {robots.map((r) => {
          const p = pos.get(r.node)
          if (!p) return null
          const selected = r.id === selectedRobot
          return (
            <g key={r.id} className="graph-robot" onClick={() => onSelectRobot(r.id)}>
              {selected && <circle cx={p[0]} cy={p[1]} r={14} fill="none" className="graph-selected" strokeWidth={2} />}
              <circle cx={p[0]} cy={p[1]} r={9} fill={STATUS_COLOR[r.status]} />
              <title>{`${r.id} · ${r.status}`}</title>
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
