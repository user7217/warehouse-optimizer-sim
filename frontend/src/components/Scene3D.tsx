import { OrbitControls } from '@react-three/drei'
import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentRef } from 'react'
import * as THREE from 'three'
import { DOCK_COLOR, PARKING_COLOR, SENSOR_COLOR, edgeColor, type ColorMode } from '../colors'
import { attachGestures } from '../hooks/gestures'
import type { Robot, Vec3, World } from '../types'
import { Robots3D } from './Robots3D'

interface Layers {
  racks: boolean
  slots: boolean
  sensors: boolean
}

interface Instance {
  pos: Vec3
  scale: Vec3
  color: string
  /** optional orientation; defaults to identity */
  quat?: THREE.Quaternion
}

const IDENTITY = new THREE.Quaternion()
const X_AXIS = new THREE.Vector3(1, 0, 0)

/** One draw call for many boxes or spheres. */
function Instanced({ items, shape = 'box', opacity = 1 }: { items: Instance[]; shape?: 'box' | 'sphere'; opacity?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    const c = new THREE.Color()
    items.forEach((it, i) => {
      m.compose(new THREE.Vector3(...it.pos), it.quat ?? IDENTITY, new THREE.Vector3(...it.scale))
      mesh.setMatrixAt(i, m)
      mesh.setColorAt(i, c.set(it.color))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [items])
  return (
    <instancedMesh key={items.length} ref={ref} args={[undefined, undefined, items.length]}>
      {shape === 'box' ? <boxGeometry /> : <sphereGeometry args={[0.5, 12, 8]} />}
      <meshStandardMaterial transparent={opacity < 1} opacity={opacity} depthWrite={opacity >= 1} />
    </instancedMesh>
  )
}

const RAIL_T = 0.06 // rail thickness, metres
const SLOT_FILL = 0.48 // drawn box size as a fraction of its cell, per dimension

function useSceneItems(world: World, colorMode: ColorMode) {
  return useMemo(() => {
    const { column_pitch: pitch, level_height: lh, slot_depth: sd, aisle_width: aw, aisle_spacing } = world.dimensions
    const { aisles, columns, levels, depth } = world.shape
    const node = new Map(world.nodes.map((n) => [n.id, n]))

    // Rails: a thin box stretched along each edge and rotated to match (dock sidings and aisle exits are diagonal).
    const rails: Instance[] = world.edges.map((e) => {
      const a = new THREE.Vector3(...node.get(e.u)!.pos)
      const b = new THREE.Vector3(...node.get(e.v)!.pos)
      const dir = b.clone().sub(a)
      const len = dir.length()
      return {
        pos: [(a.x + b.x) / 2, (a.y + b.y) / 2 - 0.12, (a.z + b.z) / 2],
        scale: [len + RAIL_T, RAIL_T, RAIL_T],
        quat: new THREE.Quaternion().setFromUnitVectors(X_AXIS, dir.normalize()),
        color: edgeColor(e.kind, e.block, colorMode),
      }
    })

    // One-way edges: a small chevron at the midpoint pointing in the direction of travel.
    const arrows: Instance[] = world.edges
      .filter((e) => e.oneway)
      .map((e) => {
        const a = new THREE.Vector3(...node.get(e.u)!.pos)
        const b = new THREE.Vector3(...node.get(e.v)!.pos)
        const dir = b.clone().sub(a).normalize()
        const mid = a.clone().lerp(b, 0.5)
        return {
          pos: [mid.x, mid.y - 0.12, mid.z],
          scale: [0.22, 0.03, 0.22],
          quat: new THREE.Quaternion().setFromUnitVectors(X_AXIS, dir).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4)),
          color: edgeColor(e.kind, e.block, colorMode),
        }
      })

    const sensors: Instance[] = world.nodes
      .filter((n) => n.sensor && n.kind !== 'dock')
      .map((n) => ({ pos: [n.pos[0], n.pos[1] - 0.12, n.pos[2]], scale: [0.14, 0.14, 0.14], color: SENSOR_COLOR }))

    const docks: Instance[] = world.nodes
      .filter((n) => n.kind === 'dock')
      .map((n) => ({ pos: [n.pos[0], -0.45 * lh, n.pos[2]], scale: [1.2, 0.1, Math.min(1.2, aisle_spacing * 0.8)], color: DOCK_COLOR }))

    // Parking spurs: dim slate pads under the rail end, smaller than docks.
    const parking: Instance[] = world.nodes
      .filter((n) => n.kind === 'parking')
      .map((n) => ({ pos: [n.pos[0], n.pos[1] - 0.16, n.pos[2]], scale: [0.8, 0.04, 0.8], color: PARKING_COLOR }))

    // Boxes are background: same cells, but drawn at about half size and muted so robots stand out.
    const slots: Instance[] = world.slots.map((s) => ({
      pos: s.pos,
      scale: [SLOT_FILL * pitch, SLOT_FILL * lh, SLOT_FILL * sd],
      color: s.depth === 0 ? '#5E564B' : '#4E483F',
    }))

    // Rack frame: uprights at every column boundary, front and back of each face, plus shelf edge beams.
    const racks: Instance[] = []
    const height = levels * lh
    for (let a = 0; a < aisles; a++) {
      for (const side of [-1, 1]) {
        const front = a * aisle_spacing + side * (aw / 2)
        const back = front + side * depth * sd
        for (let c = 0; c <= columns; c++) {
          for (const z of [front, back]) {
            racks.push({ pos: [(c - 0.5) * pitch, height / 2 - lh / 2, z], scale: [0.04, height, 0.04], color: '#4C4E50' })
          }
        }
        for (let lv = 0; lv < levels; lv++) {
          for (const z of [front, back]) {
            racks.push({ pos: [((columns - 1) * pitch) / 2, lv * lh - 0.32 * lh, z], scale: [columns * pitch, 0.035, 0.035], color: '#4C4E50' })
          }
        }
      }
    }

    return { rails, arrows, sensors, docks, parking, slots, racks }
  }, [world, colorMode])
}

/** Separate from the items so toggling colour mode doesn't reset the camera. */
function useFraming(world: World) {
  return useMemo(() => {
    const { column_pitch: pitch, level_height: lh, aisle_spacing } = world.dimensions
    const { aisles, columns, levels } = world.shape
    const center: Vec3 = [((columns - 1) * pitch) / 2, (levels * lh) / 2, ((aisles - 1) * aisle_spacing) / 2]
    const span = Math.max(columns * pitch, aisles * aisle_spacing, levels * lh)
    return { center, span }
  }, [world])
}

// ---------------------------------------------------------------- camera ----

type Preset = 'iso' | 'top' | 'side'

function presetPosition(p: Preset, c: Vec3, span: number): Vec3 {
  if (p === 'top') return [c[0], c[1] + span * 1.5, c[2] + 0.001]
  if (p === 'side') return [c[0] - span * 1.3, c[1] + span * 0.35, c[2]] // looking down the aisles from the docks
  return [c[0] - span * 0.6, c[1] + span * 0.75, c[2] + span * 0.95]
}

type Controls = ComponentRef<typeof OrbitControls>

/**
 * Trackpad navigation, replacing OrbitControls' wheel handling:
 *   pinch = zoom · two-finger scroll = orbit · ⇧ + two-finger scroll = pan.
 * Mouse still works: left-drag orbits, right-drag pans, ⌘/Ctrl + wheel zooms.
 */
function TrackpadRig({ center, span, request }: { center: Vec3; span: number; request: { preset: Preset; seq: number } }) {
  const { camera, gl, size } = useThree()
  const controls = useRef<Controls>(null)

  useEffect(() => {
    const c = controls.current
    if (!c) return
    // Narrow panels have a narrow horizontal field of view: back off so the warehouse still fits.
    const aspectBoost = Math.max(1, 1.3 / (size.width / size.height))
    camera.position.set(...presetPosition(request.preset, center, span * aspectBoost))
    c.target.set(...center)
    c.update()
    // size intentionally omitted: re-framing on every panel drag would fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request, center, span, camera])

  useEffect(() => {
    const offset = new THREE.Vector3()
    const sph = new THREE.Spherical()
    const right = new THREE.Vector3()
    const up = new THREE.Vector3()
    return attachGestures(gl.domElement, {
      onZoom: (factor) => {
        const c = controls.current
        if (!c) return
        offset.subVectors(camera.position, c.target)
        const dist = THREE.MathUtils.clamp(offset.length() / factor, 1.5, span * 5)
        camera.position.copy(c.target).add(offset.setLength(dist))
        c.update()
      },
      onScroll: (dx, dy, shift) => {
        const c = controls.current
        if (!c) return
        offset.subVectors(camera.position, c.target)
        if (shift) {
          const perPx = offset.length() * 0.0015
          right.setFromMatrixColumn(camera.matrix, 0).multiplyScalar(dx * perPx)
          up.setFromMatrixColumn(camera.matrix, 1).multiplyScalar(-dy * perPx)
          camera.position.add(right).add(up)
          c.target.add(right).add(up)
        } else {
          sph.setFromVector3(offset)
          sph.theta -= dx * 0.005
          sph.phi = THREE.MathUtils.clamp(sph.phi - dy * 0.005, 0.05, Math.PI / 2 - 0.02)
          camera.position.copy(c.target).add(offset.setFromSpherical(sph))
        }
        c.update()
      },
    })
  }, [gl, camera, span])

  return <OrbitControls ref={controls} makeDefault enableZoom={false} maxPolarAngle={Math.PI / 2 - 0.02} />
}

// ----------------------------------------------------------------- scene ----

interface SceneProps {
  world: World
  colorMode: ColorMode
  statusText: string
  robots: Robot[]
  selectedRobot: string | null
  onSelectRobot: (id: string) => void
  /** expected ms between state updates, for motion smoothing */
  updatePeriodMs: number
}

export function Scene3D({ world, colorMode, statusText, robots, selectedRobot, onSelectRobot, updatePeriodMs }: SceneProps) {
  const { rails, arrows, sensors, docks, parking, slots, racks } = useSceneItems(world, colorMode)
  const posOf = useMemo(() => {
    const m = new Map(world.nodes.map((n) => [n.id, n.pos]))
    return (id: string) => m.get(id)
  }, [world])
  const { center, span } = useFraming(world)
  const [layers, setLayers] = useState<Layers>({ racks: true, slots: true, sensors: true })
  const [request, setRequest] = useState<{ preset: Preset; seq: number }>({ preset: 'iso', seq: 0 })
  const floorY = -0.5 * world.dimensions.level_height
  const go = (preset: Preset) => setRequest((r) => ({ preset, seq: r.seq + 1 }))

  return (
    <div className="scene-wrap">
      <Canvas dpr={[1, 2]} camera={{ position: presetPosition('iso', center, span), fov: 45 }}>
        <color attach="background" args={['#121314']} />
        <hemisphereLight args={['#ffffff', '#2A2B2C', 0.9]} />
        <directionalLight position={[10, 20, 10]} intensity={1.4} />
        <gridHelper args={[span * 3, Math.round(span * 3), '#2A2B2C', '#1C1D1E']} position={[center[0], floorY, center[2]]} />
        <Instanced items={rails} />
        <Instanced items={arrows} />
        <Instanced items={docks} />
        <Instanced items={parking} opacity={0.7} />
        {layers.sensors && <Instanced items={sensors} shape="sphere" />}
        {layers.racks && <Instanced items={racks} />}
        {layers.slots && <Instanced items={slots} opacity={0.28} />}
        <Robots3D robots={robots} posOf={posOf} selected={selectedRobot} onSelect={onSelectRobot} periodMs={updatePeriodMs} />
        <TrackpadRig center={center} span={span} request={request} />
      </Canvas>

      <div className="float-bar top-left">
        {(['iso', 'top', 'side'] as const).map((p) => (
          <button key={p} onClick={() => go(p)} className={request.preset === p ? 'on' : ''}>
            {p}
          </button>
        ))}
        <span className="sep" />
        {(['racks', 'slots', 'sensors'] as const).map((k) => (
          <label key={k} className="check">
            <input type="checkbox" checked={layers[k]} onChange={() => setLayers((l) => ({ ...l, [k]: !l[k] }))} /> {k}
          </label>
        ))}
      </div>
      <div className="status-pill">{statusText}</div>
      <div className="hint">Pinch to zoom · two-finger scroll to orbit · ⇧ + scroll to pan</div>
    </div>
  )
}
