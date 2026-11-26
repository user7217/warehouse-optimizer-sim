import { Edges, Line } from '@react-three/drei'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import { PAYLOAD_COLOR, STATUS_COLOR } from '../colors'
import { robotPoint, robotRoute } from '../robotPos'
import type { Robot, Vec3 } from '../types'

const BODY: Vec3 = [0.6, 0.35, 0.6] // metres; fits a 1.0 m lane
const LIFT = 0.08 // body centre above node height (rails are drawn 0.12 below nodes)
const SNAP_DIST = 4 // metres; bigger jumps (reset, fast test updates) teleport instead of gliding
const PATH_COLOR = '#ffffff'

type PosOf = (id: string) => Vec3 | undefined

interface RobotsProps {
  robots: Robot[]
  posOf: PosOf
  selected: string | null
  onSelect: (id: string) => void
  /** expected time between state updates; one glide spans this long */
  periodMs: number
}

export function Robots3D({ robots, posOf, selected, onSelect, periodMs }: RobotsProps) {
  const sel = robots.find((r) => r.id === selected)
  return (
    <group>
      {robots.map((r) => {
        const p = robotPoint(r, posOf)
        if (!p) return null
        return <RobotMesh key={r.id} robot={r} x={p[0]} y={p[1] + LIFT} z={p[2]} selected={r.id === selected} onSelect={onSelect} periodMs={periodMs} />
      })}
      {sel && <PlannedPath robot={sel} posOf={posOf} />}
    </group>
  )
}

interface RobotMeshProps {
  robot: Robot
  x: number
  y: number
  z: number
  selected: boolean
  onSelect: (id: string) => void
  periodMs: number
}

/**
 * Glides linearly from where it is drawn now to the latest engine position over one update
 * period, so motion looks continuous between snapshots (at the cost of one period of lag).
 */
function RobotMesh({ robot, x, y, z, selected, onSelect, periodMs }: RobotMeshProps) {
  const group = useRef<THREE.Group>(null)
  const anim = useRef({ from: new THREE.Vector3(), to: new THREE.Vector3(), t0: 0, placed: false })

  useLayoutEffect(() => {
    const g = group.current
    if (!g) return
    const a = anim.current
    a.to.set(x, y, z)
    if (!a.placed || g.position.distanceTo(a.to) > SNAP_DIST) {
      g.position.copy(a.to)
      a.placed = true
    }
    a.from.copy(g.position)
    a.t0 = performance.now()
  }, [x, y, z])

  useFrame(() => {
    const g = group.current
    if (!g) return
    const a = anim.current
    const t = Math.min(1, (performance.now() - a.t0) / periodMs)
    g.position.lerpVectors(a.from, a.to, t)
  })

  const color = STATUS_COLOR[robot.status]
  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    onSelect(robot.id)
  }
  const hover = (on: boolean) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation()
    document.body.style.cursor = on ? 'pointer' : ''
  }

  return (
    <group ref={group} onClick={click} onPointerOver={hover(true)} onPointerOut={hover(false)}>
      <mesh>
        <boxGeometry args={BODY} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected ? 0.9 : 0.5} />
        {selected && <Edges color="#ffffff" scale={1.12} lineWidth={2} />}
      </mesh>
      {robot.payload.length > 0 && (
        <mesh position={[0, BODY[1] / 2 + 0.14, 0]}>
          <boxGeometry args={[0.3, 0.28, 0.3]} />
          <meshStandardMaterial color={PAYLOAD_COLOR} />
        </mesh>
      )}
      {selected && (
        <mesh position={[0, -BODY[1] / 2 - 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.52, 0.64, 40]} />
          <meshBasicMaterial color="#ffffff" side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  )
}

function PlannedPath({ robot, posOf }: { robot: Robot; posOf: PosOf }) {
  const points = robotRoute(robot, posOf).map((p): Vec3 => [p[0], p[1], p[2]])
  if (points.length < 2) return null
  return <Line points={points} color={PATH_COLOR} lineWidth={2.5} dashed dashSize={0.25} gapSize={0.15} transparent opacity={0.85} depthTest={false} renderOrder={10} />
}
