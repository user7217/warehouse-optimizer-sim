import { useState, type RefObject } from 'react'
import { Group, Panel, Separator, useDefaultLayout, usePanelRef, type PanelImperativeHandle } from 'react-resizable-panels'
import { addRandomTasks, useSimState, useWorld } from './api'
import type { ColorMode } from './colors'
import { GraphView } from './components/GraphView'
import { MetricsPanel } from './components/MetricsPanel'
import { RobotSidebar } from './components/RobotSidebar'
import { Scene3D } from './components/Scene3D'
import { SimControls } from './components/SimControls'
import { TaskQueue } from './components/TaskQueue'
import type { SimState } from './types'

type PaneId = 'left' | 'scene' | 'graph'

/** Robots glide between server updates over one tick period, clamped to keep motion readable. */
function updatePeriodMs(ticksPerSecond: number): number {
  if (!(ticksPerSecond > 0)) return 100
  return Math.min(250, Math.max(25, 1000 / ticksPerSecond))
}

export default function App() {
  const { world, error } = useWorld()
  const { state, connected, apply } = useSimState()
  const [colorMode, setColorMode] = useState<ColorMode>('kind')
  const [selectedRobot, setSelectedRobot] = useState<string | null>(null)
  const [cmdError, setCmdError] = useState<string | null>(null)

  // Panel sizes persist in localStorage across reloads.
  const main = useDefaultLayout({ id: 'main', panelIds: ['left', 'scene', 'graph'] })
  const left = useDefaultLayout({ id: 'left', panelIds: ['robots', 'tasks', 'metrics'] })

  /** Fire a command. The socket pushes the resulting state; use the HTTP reply only while it is down. */
  const send = (cmd: () => Promise<SimState>) => {
    cmd().then(
      (s) => {
        setCmdError(null)
        if (!connected) apply(s)
      },
      (e: Error) => setCmdError(e.message),
    )
  }

  const refs: Record<PaneId, RefObject<PanelImperativeHandle | null>> = {
    left: usePanelRef(),
    scene: usePanelRef(),
    graph: usePanelRef(),
  }
  const [open, setOpen] = useState<Record<PaneId, boolean>>({ left: true, scene: true, graph: true })
  const track = (id: PaneId) => (size: { inPixels: number }) => setOpen((o) => (o[id] === size.inPixels > 0 ? o : { ...o, [id]: size.inPixels > 0 }))
  const toggle = (id: PaneId) => {
    const p = refs[id].current
    if (!p) return
    if (p.isCollapsed()) p.expand()
    else p.collapse()
  }

  if (error) return <div className="status">Backend unreachable: {error}. Is uvicorn running on :8000? Retrying…</div>
  if (!world) return <div className="status">Loading warehouse…</div>

  const period = updatePeriodMs(state.ticks_per_second)
  const statusText = [
    connected ? (state.running ? 'RUNNING' : 'PAUSED') : 'DISCONNECTED',
    `tick ${state.tick}`,
    `${state.robots.length} robots`,
    `${state.metrics.waiting_now} waiting`,
  ].join(' · ')

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          WAREHOUSE<span>sim</span>
        </div>
        <span className="chip">{world.name}</span>
        <span className="stats">
          {world.shape.aisles} aisles · {world.nodes.length} nodes · {world.blocks.length} blocks · {world.slots.length} slots
        </span>
        <div className="spacer" />
        <SimControls state={state} connected={connected} error={cmdError} send={send} />
        <div className="segmented">
          <span className="label">Colour</span>
          {(['kind', 'block'] as const).map((m) => (
            <button key={m} className={m === colorMode ? 'on' : ''} onClick={() => setColorMode(m)}>
              {m}
            </button>
          ))}
        </div>
        <div className="segmented">
          <span className="label">Panels</span>
          {([['left', 'Sidebar'], ['scene', '3D'], ['graph', 'Graph']] as const).map(([id, label]) => (
            <button key={id} className={open[id] ? 'on' : ''} onClick={() => toggle(id)}>
              {label}
            </button>
          ))}
        </div>
      </header>

      <Group orientation="horizontal" className="workspace" id="main" defaultLayout={main.defaultLayout} onLayoutChanged={main.onLayoutChanged}>
        <Panel id="left" panelRef={refs.left} defaultSize="20%" minSize={180} collapsible onResize={track('left')}>
          <Group orientation="vertical" id="left" defaultLayout={left.defaultLayout} onLayoutChanged={left.onLayoutChanged}>
            <Panel id="robots" defaultSize="40%" minSize={80}>
              <RobotSidebar robots={state.robots} selected={selectedRobot} onSelect={setSelectedRobot} />
            </Panel>
            <Separator className="sep-h" />
            <Panel id="tasks" defaultSize="30%" minSize={80}>
              <TaskQueue
                tasks={state.tasks}
                tick={state.tick}
                selectedRobot={selectedRobot}
                onSelectRobot={setSelectedRobot}
                onAddTasks={(n) => send(() => addRandomTasks(n))}
              />
            </Panel>
            <Separator className="sep-h" />
            <Panel id="metrics" minSize={80}>
              <MetricsPanel metrics={state.metrics} events={state.events} />
            </Panel>
          </Group>
        </Panel>
        <Separator className="sep-v" />
        <Panel id="scene" panelRef={refs.scene} minSize={240} collapsible onResize={track('scene')}>
          <Scene3D
            world={world}
            colorMode={colorMode}
            statusText={statusText}
            robots={state.robots}
            selectedRobot={selectedRobot}
            onSelectRobot={setSelectedRobot}
            updatePeriodMs={period}
          />
        </Panel>
        <Separator className="sep-v" />
        <Panel id="graph" panelRef={refs.graph} defaultSize="32%" minSize={220} collapsible onResize={track('graph')}>
          <GraphView
            world={world}
            robots={state.robots}
            colorMode={colorMode}
            selectedRobot={selectedRobot}
            onSelectRobot={setSelectedRobot}
            updatePeriodMs={period}
          />
        </Panel>
      </Group>
    </div>
  )
}
