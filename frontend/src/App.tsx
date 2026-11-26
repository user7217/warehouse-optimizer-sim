import { lazy, Suspense, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Group, Panel, Separator, useDefaultLayout, usePanelRef, type PanelImperativeHandle } from 'react-resizable-panels'
import type { ColorMode } from './colors'
import { Brand } from './components/Brand'
import type { CodeEditorHandle } from './components/CodeEditor'
import { ConsolePanel } from './components/ConsolePanel'
import { EditorPanel } from './components/EditorPanel'
import { GraphView } from './components/GraphView'
import { LoadingScreen } from './components/LoadingScreen'
import { MetricsPanel } from './components/MetricsPanel'
import { ResultsTable } from './components/ResultsTable'
import { RobotSidebar } from './components/RobotSidebar'
import { ScenarioPanel } from './components/ScenarioPanel'
import { SimControls } from './components/SimControls'
import { TaskQueue } from './components/TaskQueue'
import { fmtInt } from './format'
import { viewSupport, VIEW_LIMITS, worldSize } from './scenario'
import { MAX_LIVE_POSTS_PER_SEC, TEST_STATE_INTERVAL_MS } from './engine/protocol'
import { useWorkbench, type Activity, type Workbench } from './useWorkbench'

// three.js + drei are the bulk of the bundle; load them only when a world small enough for 3D opens.
const Scene3D = lazy(() => import('./components/Scene3D').then((m) => ({ default: m.Scene3D })))

type PaneId = 'left' | 'right' | 'bottom' | 'scene' | 'graph'
type LeftTab = 'code' | 'scenario'
type BottomTab = 'results' | 'console'

/** Robots glide between state updates over one update period. */
function updatePeriodMs(activity: Activity, speed: number): number {
  if (activity === 'testing') return TEST_STATE_INTERVAL_MS
  if (activity === 'live') return Math.min(250, Math.max(1000 / speed, 1000 / MAX_LIVE_POSTS_PER_SEC))
  return 120
}

function usePane(id: PaneId, setOpen: (f: (o: Record<PaneId, boolean>) => Record<PaneId, boolean>) => void) {
  const ref = usePanelRef()
  const onResize = (size: { inPixels: number }) => setOpen((o) => (o[id] === size.inPixels > 0 ? o : { ...o, [id]: size.inPixels > 0 }))
  return { ref, onResize }
}

function toggle(ref: RefObject<PanelImperativeHandle | null>) {
  const p = ref.current
  if (!p) return
  if (p.isCollapsed()) p.expand()
  else p.collapse()
}

function expand(ref: RefObject<PanelImperativeHandle | null>) {
  const p = ref.current
  if (p?.isCollapsed()) p.expand()
}

export default function App() {
  const wb = useWorkbench()
  const editorRef = useRef<CodeEditorHandle>(null)
  const [leftTab, setLeftTab] = useState<LeftTab>('code')
  const [bottomTab, setBottomTab] = useState<BottomTab>('results')
  const [colorMode, setColorMode] = useState<ColorMode>('kind')
  const [selectedRobot, setSelectedRobot] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<PaneId, boolean>>({ left: true, right: true, bottom: true, scene: true, graph: true })

  const panes = {
    left: usePane('left', setOpen),
    right: usePane('right', setOpen),
    bottom: usePane('bottom', setOpen),
    scene: usePane('scene', setOpen),
    graph: usePane('graph', setOpen),
  }

  // Panel sizes persist in localStorage (layout only; code and results are never stored).
  const mainLayout = useDefaultLayout({ id: 'wl-main', panelIds: ['left', 'work'] })
  const workLayout = useDefaultLayout({ id: 'wl-work', panelIds: ['top', 'bottom'] })
  const topLayout = useDefaultLayout({ id: 'wl-top', panelIds: ['views', 'right'] })
  const rightLayout = useDefaultLayout({ id: 'wl-right', panelIds: ['metrics', 'robots', 'tasks'] })

  // A new world invalidates the robot selection.
  const world = wb.session?.world ?? null
  const [seenWorld, setSeenWorld] = useState(world)
  if (seenWorld !== world) {
    setSeenWorld(world)
    setSelectedRobot(null)
  }

  // Surface new errors in the console and new results in the table.
  const [seenErrors, setSeenErrors] = useState(0)
  const [seenResults, setSeenResults] = useState(0)
  if (wb.unreadErrors !== seenErrors) {
    setSeenErrors(wb.unreadErrors)
    if (wb.unreadErrors > seenErrors) setBottomTab('console')
  }
  if (wb.results.length !== seenResults) {
    setSeenResults(wb.results.length)
    const last = wb.results.at(-1)
    if (wb.results.length > seenResults && last && last.report.reason !== 'error') setBottomTab('results')
  }
  useEffect(() => {
    if (bottomTab === 'console' && wb.unreadErrors > 0) wb.markErrorsRead()
  }, [bottomTab, wb])
  useEffect(() => {
    if (bottomTab === 'console' && wb.unreadErrors > 0) expand(panes.bottom.ref)
  }, [bottomTab, wb.unreadErrors, panes.bottom.ref])

  // Cmd/Ctrl+Enter runs a test from anywhere (the editor binds it too).
  const runTestRef = useRef<() => unknown>(() => {})
  const canTest = wb.ready && wb.scenarioValid && (wb.activity === 'idle' || wb.activity === 'live')
  useEffect(() => {
    runTestRef.current = canTest ? wb.runTest : () => {}
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.defaultPrevented) {
        e.preventDefault()
        void runTestRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const jumpToLine = (line: number) => {
    setLeftTab('code')
    expand(panes.left.ref)
    requestAnimationFrame(() => editorRef.current?.jumpTo(line))
  }

  const sim = wb.sim
  const support = world ? viewSupport(worldSize(world)) : null
  const period = updatePeriodMs(wb.activity, wb.speed)
  const statusText = sim
    ? [`tick ${fmtInt(sim.tick)}`, `${sim.robots.length} robots`, `${sim.metrics.waiting_now} waiting`, wb.session?.origin === 'test' ? 'test session' : null, wb.stale ? 'outdated: Reset to apply edits' : null]
        .filter(Boolean)
        .join(' · ')
    : ''

  const viewProps = world && sim ? { world, robots: sim.robots, colorMode, selectedRobot, onSelectRobot: setSelectedRobot, updatePeriodMs: period } : null

  let views: ReactNode
  if (!viewProps || !support) {
    views = (
      <div className="placeholder">
        {wb.activity === 'opening' ? <p>Building the warehouse…</p> : <p>No session. Press <b>Run</b> for a live view or <b>Run test</b> to benchmark.</p>}
      </div>
    )
  } else if (support.threeD) {
    views = (
      <Group orientation="horizontal" id="wl-views">
        <Panel id="scene" panelRef={panes.scene.ref} minSize={200} collapsible onResize={panes.scene.onResize}>
          <Suspense fallback={<div className="placeholder"><p>Loading 3D view…</p></div>}>
            <Scene3D {...viewProps} statusText={statusText} />
          </Suspense>
        </Panel>
        <Separator className="sep-v" />
        <Panel id="graph" panelRef={panes.graph.ref} defaultSize="42%" minSize={200} collapsible onResize={panes.graph.onResize}>
          <GraphView {...viewProps} />
        </Panel>
      </Group>
    )
  } else if (support.graph) {
    views = (
      <div className="views-big">
        <div className="notice">
          Large layout ({fmtInt(world!.slots.length)} slots, {fmtInt(world!.nodes.length)} nodes): 3D is off above {fmtInt(VIEW_LIMITS.threeD.slots)} slots or{' '}
          {fmtInt(VIEW_LIMITS.threeD.nodes)} nodes. Showing the graph only.
        </div>
        <div className="views-big-body">
          <GraphView {...viewProps} statusText={statusText} />
        </div>
      </div>
    )
  } else {
    views = (
      <div className="placeholder">
        <p>
          This layout has {fmtInt(world!.nodes.length)} nodes, too many to draw (limit {fmtInt(VIEW_LIMITS.graph.nodes)}). Metrics, robots and tasks still update.
        </p>
        <p className="mono muted">{statusText}</p>
      </div>
    )
  }

  const paneToggles: [PaneId, string][] = [
    ['left', 'Code'],
    ...(support?.threeD ? ([['scene', '3D'], ['graph', 'Graph']] as [PaneId, string][]) : []),
    ['right', 'Inspector'],
    ['bottom', 'Output'],
  ]

  return (
    <div className="app">
      <header className="topbar">
        <Brand />
        <EngineBadge wb={wb} />
        {world && (
          <span className="stats" title={`${world.blocks.length} signalling blocks`}>
            {world.shape.aisles}×{world.shape.columns}×{world.shape.levels} · {fmtInt(world.nodes.length)} nodes · {fmtInt(world.slots.length)} slots
          </span>
        )}
        <div className="spacer" />
        <SimControls
          ready={wb.ready}
          activity={wb.activity}
          sim={sim}
          hasSession={!!wb.session}
          stale={wb.stale}
          scenarioValid={wb.scenarioValid}
          speed={wb.speed}
          onSpeed={wb.setSpeed}
          onPlay={() => void wb.play()}
          onPause={() => void wb.pause()}
          onStep={() => void wb.step()}
          onReset={() => void wb.open()}
          onRunTest={() => void wb.runTest()}
          onStop={() => void wb.stop()}
          test={wb.test}
        />
        <div className="segmented" title="Edge colouring">
          {(['kind', 'block'] as const).map((m) => (
            <button key={m} className={m === colorMode ? 'on' : ''} onClick={() => setColorMode(m)}>
              {m}
            </button>
          ))}
        </div>
        <div className="segmented" title="Show or hide panels">
          {paneToggles.map(([id, label]) => (
            <button key={id} className={open[id] ? 'on' : ''} onClick={() => toggle(panes[id].ref)}>
              {label}
            </button>
          ))}
        </div>
      </header>

      <Group orientation="horizontal" className="workspace" id="wl-main" defaultLayout={mainLayout.defaultLayout} onLayoutChanged={mainLayout.onLayoutChanged}>
        <Panel id="left" panelRef={panes.left.ref} defaultSize="32%" minSize={300} collapsible onResize={panes.left.onResize}>
          <div className="tabbed">
            <Tabs
              value={leftTab}
              onChange={setLeftTab}
              tabs={[
                { id: 'code', label: 'Code' },
                { id: 'scenario', label: 'Scenario', badge: Object.keys(wb.scenarioErrors).length ? '!' : wb.presetModified ? '•' : undefined },
              ]}
            />
            <div className="tab-body" hidden={leftTab !== 'code'}>
              <EditorPanel
                code={wb.code}
                onChange={wb.setCode}
                check={wb.check}
                lastCheck={wb.lastCheck}
                canCheck={wb.ready && wb.activity !== 'testing' && wb.activity !== 'opening'}
                checking={wb.activity === 'checking'}
                onCheck={() => void wb.checkCode()}
                canReset={wb.template !== null && wb.code !== wb.template}
                onReset={wb.resetCode}
                onRunTest={() => void runTestRef.current()}
                errorLine={wb.errorLine}
                editorRef={editorRef}
              />
            </div>
            <div className="tab-body" hidden={leftTab !== 'scenario'}>
              {wb.presets && wb.scenario ? (
                <ScenarioPanel
                  presets={wb.presets}
                  presetName={wb.presetName}
                  presetModified={wb.presetModified}
                  onSelectPreset={wb.selectPreset}
                  scenario={wb.scenario}
                  onChange={wb.setScenario}
                  errors={wb.scenarioErrors}
                  stale={wb.stale}
                />
              ) : (
                <div className="placeholder">
                  <p>Loading presets…</p>
                </div>
              )}
            </div>
          </div>
        </Panel>
        <Separator className="sep-v" />
        <Panel id="work" minSize={420}>
          <Group orientation="vertical" id="wl-work" defaultLayout={workLayout.defaultLayout} onLayoutChanged={workLayout.onLayoutChanged}>
            <Panel id="top" minSize={200}>
              <Group orientation="horizontal" id="wl-top" defaultLayout={topLayout.defaultLayout} onLayoutChanged={topLayout.onLayoutChanged}>
                <Panel id="views" minSize={260}>
                  <div className="views">{views}</div>
                </Panel>
                <Separator className="sep-v" />
                <Panel id="right" panelRef={panes.right.ref} defaultSize="26%" minSize={220} collapsible onResize={panes.right.onResize}>
                  <Group orientation="vertical" id="wl-right" defaultLayout={rightLayout.defaultLayout} onLayoutChanged={rightLayout.onLayoutChanged}>
                    <Panel id="metrics" defaultSize="46%" minSize={90}>
                      <MetricsPanel metrics={sim?.metrics ?? null} timing={sim?.timing ?? null} events={sim?.events ?? []} />
                    </Panel>
                    <Separator className="sep-h" />
                    <Panel id="robots" defaultSize="28%" minSize={70}>
                      <RobotSidebar robots={sim?.robots ?? []} selected={selectedRobot} onSelect={setSelectedRobot} />
                    </Panel>
                    <Separator className="sep-h" />
                    <Panel id="tasks" minSize={70}>
                      <TaskQueue
                        tasks={sim?.tasks ?? []}
                        tick={sim?.tick ?? 0}
                        selectedRobot={selectedRobot}
                        onSelectRobot={setSelectedRobot}
                        onAddOrders={wb.session && sim && !sim.error && (wb.activity === 'idle' || wb.activity === 'live') ? (n) => void wb.addOrders(n) : null}
                      />
                    </Panel>
                  </Group>
                </Panel>
              </Group>
            </Panel>
            <Separator className="sep-h" />
            <Panel id="bottom" panelRef={panes.bottom.ref} defaultSize="30%" minSize={110} collapsible onResize={panes.bottom.onResize}>
              <div className="tabbed">
                <Tabs
                  value={bottomTab}
                  onChange={setBottomTab}
                  tabs={[
                    { id: 'results', label: 'Results', badge: wb.results.length ? String(wb.results.length) : undefined },
                    { id: 'console', label: 'Console', badge: wb.unreadErrors ? String(wb.unreadErrors) : undefined, danger: wb.unreadErrors > 0 },
                  ]}
                />
                <div className="tab-body" hidden={bottomTab !== 'results'}>
                  <ResultsTable rows={wb.results} onRename={wb.renameResult} onRemove={wb.removeResult} onClear={wb.clearResults} />
                </div>
                <div className="tab-body" hidden={bottomTab !== 'console'}>
                  <ConsolePanel entries={wb.log} onClear={wb.clearLog} onJumpToLine={jumpToLine} />
                </div>
              </div>
            </Panel>
          </Group>
        </Panel>
      </Group>

      {wb.status.kind !== 'ready' && <LoadingScreen status={wb.status} onRetry={() => wb.engine.restart('Retrying…')} />}
    </div>
  )
}

function EngineBadge({ wb }: { wb: Workbench }) {
  const { status, activity } = wb
  let cls = 'ok'
  let label = 'Ready'
  let title = wb.engine.canInterrupt ? 'Python engine ready. Stop interrupts running code.' : 'Python engine ready. Page is not cross-origin isolated: Stop restarts the engine.'
  if (status.kind === 'booting') {
    cls = 'warn pulse'
    label = 'Loading'
    title = status.detail
  } else if (status.kind === 'failed') {
    cls = 'danger'
    label = 'Error'
    title = status.message
  } else if (activity === 'live') {
    cls = 'accent pulse'
    label = 'Running'
  } else if (activity === 'testing') {
    cls = 'accent pulse'
    label = 'Testing'
  } else if (activity !== 'idle') {
    cls = 'accent'
    label = 'Busy'
  }
  return (
    <span className={`engine-badge ${cls}`} title={title}>
      <span className="dot" />
      {label}
    </span>
  )
}

interface TabSpec<T extends string> {
  id: T
  label: string
  badge?: string
  danger?: boolean
}

function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: TabSpec<T>[] }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === value} className={t.id === value ? 'tab on' : 'tab'} onClick={() => onChange(t.id)}>
          {t.label}
          {t.badge && <span className={t.danger ? 'tab-badge danger' : 'tab-badge'}>{t.badge}</span>}
        </button>
      ))}
    </div>
  )
}
