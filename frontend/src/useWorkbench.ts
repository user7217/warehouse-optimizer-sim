// App state and actions: engine lifecycle, code, scenario, the live session, tests, results, console.
// Nothing here is persisted: code and results live in memory and are gone on reload.

import { useCallback, useEffect, useRef, useState } from 'react'
import { EngineRestartedError, getEngine, type EngineEvent, type EngineStatus } from './engine/client'
import { EngineCallError } from './engine/protocol'
import { sameScenario, validate } from './scenario'
import type { CodeCheck, Presets, Scenario, SimState, TestReport, UserError, World } from './types'

export type ConsoleKind = 'out' | 'err' | 'info' | 'ok' | 'warn' | 'error'

export interface ConsoleEntry {
  id: number
  kind: ConsoleKind
  text: string
  error?: UserError
  tick?: number
}

export interface ResultRow {
  id: number
  label: string
  report: TestReport
  /** browser wall time for the whole test, including world build and serialisation */
  elapsedMs: number
}

/** What the views show: the world plus the code/scenario it was opened with. */
export interface Session {
  world: World
  scenario: Scenario
  code: string
  origin: 'live' | 'test'
}

export type Activity = 'idle' | 'opening' | 'stepping' | 'live' | 'testing' | 'checking'

export interface TestProgress {
  tick: number
  progress: number
  startedAt: number
}

const MAX_CONSOLE = 1000
export const SPEEDS = [5, 10, 20, 40, 80] as const

export function providesLabel(p: { router: boolean; assigner: boolean }): string {
  if (p.router && p.assigner) return 'custom router + assigner'
  if (p.router) return 'custom router'
  if (p.assigner) return 'custom assigner'
  return 'baselines'
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function useWorkbench() {
  const engine = getEngine()
  const [status, setStatus] = useState<EngineStatus>(engine.status)
  const [presets, setPresets] = useState<Presets | null>(null)
  const [presetName, setPresetName] = useState<string>('')
  const [scenario, setScenario] = useState<Scenario | null>(null)
  const [template, setTemplate] = useState<string | null>(null)
  const [code, setCodeState] = useState('')
  // Actions read the latest code from here, so a click right after a keystroke never sees stale code.
  const codeRef = useRef('')
  const setCode = useCallback((c: string) => {
    codeRef.current = c
    setCodeState(c)
  }, [])
  const [check, setCheck] = useState<{ code: string; result: CodeCheck } | null>(null)
  const [errorLine, setErrorLine] = useState<number | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [sim, setSim] = useState<SimState | null>(null)
  const [activity, setActivity] = useState<Activity>('idle')
  const [speed, setSpeedState] = useState<number>(10)
  const [test, setTest] = useState<TestProgress | null>(null)
  const [results, setResults] = useState<ResultRow[]>([])
  const [log, setLog] = useState<ConsoleEntry[]>([])
  const [unreadErrors, setUnreadErrors] = useState(0)

  const nextId = useRef(1)
  const runCount = useRef(0)
  const simRef = useRef<SimState | null>(null)
  const booted = useRef(false)
  /** Stop was pressed since the current action started: a resulting user error is just the interrupt */
  const stopRequested = useRef(false)
  /** code + scenario of the test in flight, for the session it opens */
  const pendingTest = useRef<{ scenario: Scenario; code: string } | null>(null)

  // ------------------------------------------------------------- console --

  const append = useCallback((entries: Omit<ConsoleEntry, 'id'>[]) => {
    if (!entries.length) return
    const withIds = entries.map((e) => ({ ...e, id: nextId.current++ }))
    setLog((l) => {
      const next = l.concat(withIds)
      return next.length > MAX_CONSOLE ? next.slice(next.length - MAX_CONSOLE) : next
    })
    const errs = entries.filter((e) => e.kind === 'error').length
    if (errs) setUnreadErrors((n) => n + errs)
  }, [])

  const info = useCallback((kind: ConsoleKind, text: string, tick?: number) => append([{ kind, text, tick }]), [append])

  const logUserError = useCallback(
    (error: UserError, tick?: number) => {
      append([{ kind: 'error', text: `${error.phase} error: ${error.message}`, error, tick }])
      if (error.line !== null) setErrorLine(error.line)
    },
    [append],
  )

  const showState = useCallback((s: SimState | null) => {
    simRef.current = s
    setSim(s)
  }, [])

  // -------------------------------------------------------- engine events --

  useEffect(() => {
    const onEvent = (e: EngineEvent) => {
      switch (e.type) {
        case 'status':
          setStatus(e.status)
          break
        case 'stdout': {
          const entries: Omit<ConsoleEntry, 'id'>[] = e.lines.map((l) => ({ kind: l.stream, text: l.text }))
          if (e.dropped) entries.push({ kind: 'warn', text: `… ${e.dropped.toLocaleString()} more output lines dropped (output is rate-limited)` })
          append(entries)
          break
        }
        case 'liveState':
          showState(e.state)
          break
        case 'liveStopped': {
          setActivity((a) => (a === 'live' ? 'idle' : a))
          const s = simRef.current
          if (e.reason === 'finished' && s) info('ok', `All orders delivered at tick ${s.tick.toLocaleString()}.`, s.tick)
          else if (e.reason === 'error' && stopRequested.current) info('warn', 'Stopped. Reset to start a fresh session.', s?.tick)
          else if (e.reason === 'error' && s?.error) logUserError(s.error, s.tick)
          else if (e.reason === 'interrupted') info('warn', 'Stopped (KeyboardInterrupt). Reset to start a fresh session.', s?.tick)
          else if (e.reason === 'failed') info('error', `Engine failure: ${e.message ?? 'unknown'}`, s?.tick)
          break
        }
        case 'session': {
          const p = pendingTest.current
          if (p) setSession({ world: e.world, scenario: p.scenario, code: p.code, origin: 'test' })
          showState(e.state)
          break
        }
        case 'testProgress':
          setTest((t) => (t ? { ...t, tick: e.tick, progress: e.progress } : t))
          if (e.state) showState(e.state)
          break
        case 'restarted':
          setSession(null)
          showState(null)
          setActivity('idle')
          setTest(null)
          info('warn', e.reason)
          break
        case 'boot':
          break
      }
    }
    return engine.subscribe(onEvent)
  }, [engine, append, info, logUserError, showState])

  // ----------------------------------------------------------------- boot --

  useEffect(() => {
    void engine.boot().catch(() => {})
  }, [engine])

  // First time the engine is ready (also after a Retry): load presets and the template, then open a
  // live session so a warehouse is on screen straight away. Later restarts don't auto-open, so code
  // that hangs while opening can't cause a restart loop.
  useEffect(() => {
    if (status.kind !== 'ready' || booted.current) return
    booted.current = true
    let loaded = false
    void (async () => {
      try {
        const r = await engine.boot()
        info(
          'info',
          `Engine ready · Pyodide ${r.pyodideVersion} · ${r.engineFiles} engine files · ${
            engine.canInterrupt ? 'Stop interrupts running code' : 'not cross-origin isolated: runaway code is stopped by restarting the engine'
          }`,
        )
        const [p, tpl] = await Promise.all([engine.presets(), engine.defaultCode()])
        const name = p.presets[p.default] ? p.default : Object.keys(p.presets)[0]
        setPresets(p)
        setTemplate(tpl)
        setCode(tpl)
        loaded = true
        void engine.checkCode(tpl).then((c) => setCheck((prev) => prev ?? { code: tpl, result: c }), () => {})
        if (!name) return
        const first = p.presets[name]
        setPresetName(name)
        setScenario(first)
        setActivity('opening')
        const res = await engine.openSession(first, tpl)
        if (res.ok && res.world && res.state) {
          setSession({ world: res.world, scenario: first, code: tpl, origin: 'live' })
          showState(res.state)
        } else if (res.error) logUserError(res.error)
      } catch (e) {
        if (!(e instanceof EngineRestartedError)) info('error', `Engine setup failed: ${describe(e)}`)
        // Retry on the next ready only if presets never arrived (not after a hang in the first open).
        if (!loaded) booted.current = false
      } finally {
        setActivity('idle')
      }
    })()
  }, [status.kind, engine, info, logUserError, showState, setCode])

  // -------------------------------------------------------------- helpers --

  const ready = status.kind === 'ready'
  const scenarioErrors = scenario ? validate(scenario) : {}
  const scenarioValid = !!scenario && Object.keys(scenarioErrors).length === 0
  const stale = !!session && !!scenario && (session.code !== code || !sameScenario(session.scenario, scenario))

  /** Run an engine call; restarts and interrupts are reported via events, other failures here. */
  const guard = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | null> => {
      try {
        return await fn()
      } catch (e) {
        if (e instanceof EngineRestartedError) return null
        if (e instanceof EngineCallError && e.interrupted) info('warn', 'Stopped (KeyboardInterrupt).')
        else info('error', `Engine call failed: ${describe(e)}`)
        return null
      }
    },
    [info],
  )

  /** Open a fresh live session with the current code and scenario. */
  const open = useCallback(async (): Promise<boolean> => {
    if (!scenario) return false
    const code = codeRef.current
    stopRequested.current = false
    setActivity('opening')
    setErrorLine(null)
    const res = await guard(() => engine.openSession(scenario, code))
    setActivity('idle')
    if (!res) return false
    if (!res.ok || !res.world || !res.state) {
      if (stopRequested.current) info('warn', 'Stopped.')
      else if (res.error) logUserError(res.error)
      return false
    }
    setSession({ world: res.world, scenario, code, origin: 'live' })
    showState(res.state)
    return true
  }, [engine, scenario, guard, info, logUserError, showState])

  /** A session that can still advance with the current code and scenario, opening one if needed. */
  const ensureSession = useCallback(async (): Promise<boolean> => {
    const s = simRef.current
    if (session && !stale && s && !s.finished && !s.error) return true
    return open()
  }, [session, stale, open])

  const play = useCallback(async () => {
    stopRequested.current = false
    if (!(await ensureSession())) return
    const ok = await guard(() => engine.play(speed).then(() => true))
    if (ok) setActivity('live')
  }, [engine, ensureSession, guard, speed])

  const pause = useCallback(async () => {
    const s = await guard(() => engine.pause())
    if (s) showState(s)
    setActivity('idle')
  }, [engine, guard, showState])

  const step = useCallback(async () => {
    stopRequested.current = false
    if (!(await ensureSession())) return
    setActivity('stepping')
    const s = await guard(() => engine.step(1))
    setActivity('idle')
    if (!s) return
    const hadError = !!simRef.current?.error
    showState(s)
    if (s.error && !hadError) {
      if (stopRequested.current) info('warn', 'Stopped. Reset to start a fresh session.', s.tick)
      else logUserError(s.error, s.tick)
    }
    else if (s.finished) info('ok', `All orders delivered at tick ${s.tick.toLocaleString()}.`, s.tick)
  }, [engine, ensureSession, guard, showState, logUserError, info])

  const setSpeed = useCallback(
    (tps: number) => {
      setSpeedState(tps)
      if (activity === 'live') void guard(() => engine.play(tps))
    },
    [activity, engine, guard],
  )

  const addOrders = useCallback(
    async (count: number) => {
      if (!session) return
      const s = await guard(() => engine.addOrders(count))
      // During a live run the loop posts the next state anyway; only apply when paused.
      if (s && activity !== 'live') showState(s)
      if (s) info('info', `Added ${count} order${count === 1 ? '' : 's'}.`, s.tick)
    },
    [engine, session, activity, guard, showState, info],
  )

  const runTest = useCallback(async () => {
    if (!scenario || !scenarioValid) return
    const usedScenario = scenario
    const usedCode = codeRef.current
    stopRequested.current = false
    setErrorLine(null)
    setActivity('testing')
    setTest({ tick: 0, progress: 0, startedAt: performance.now() })
    pendingTest.current = { scenario: usedScenario, code: usedCode }
    info('info', `Test started · ${usedScenario.name}`)
    const outcome = await guard(() => engine.runTest(usedScenario, usedCode))
    pendingTest.current = null
    setTest(null)
    setActivity('idle')
    if (!outcome) return
    if (outcome.status === 'error') {
      if (stopRequested.current) info('warn', 'Test stopped.')
      else logUserError(outcome.error)
      return
    }
    if (outcome.status === 'stopped') {
      info('warn', outcome.interrupted ? 'Test stopped (KeyboardInterrupt).' : 'Test stopped.')
      return
    }
    const { report, elapsedMs } = outcome
    if (report.reason === 'error' && stopRequested.current) {
      // The engine turned our KeyboardInterrupt into a user error; it's a stop, not a result.
      info('warn', 'Test stopped.')
      return
    }
    runCount.current += 1
    const label = `Run ${runCount.current} · ${report.scenario.name} · ${providesLabel(report.provides)}`
    setResults((r) => [...r, { id: runCount.current, label, report, elapsedMs }])
    if (report.error) logUserError(report.error, report.ticks)
    const verdict =
      report.reason === 'complete'
        ? `complete in ${report.ticks.toLocaleString()} ticks`
        : report.reason === 'max_ticks'
          ? `hit max ticks (${report.ticks.toLocaleString()}), ${report.metrics.orders_done}/${report.metrics.orders_planned} orders done`
          : `failed at tick ${report.ticks.toLocaleString()}`
    info(report.reason === 'complete' ? 'ok' : report.reason === 'error' ? 'error' : 'warn', `${label}: ${verdict} · ${(elapsedMs / 1000).toFixed(2)} s`)
  }, [engine, scenario, scenarioValid, guard, info, logUserError])

  const stop = useCallback(async () => {
    stopRequested.current = true
    await engine.stop()
  }, [engine])

  const checkCode = useCallback(async () => {
    stopRequested.current = false
    setActivity((a) => (a === 'idle' ? 'checking' : a))
    const checked = codeRef.current
    const r = await guard(() => engine.checkCode(checked))
    setActivity((a) => (a === 'checking' ? 'idle' : a))
    if (!r) return
    setCheck({ code: checked, result: r })
    if (r.ok) {
      setErrorLine(null)
      info('ok', `Code OK · ${providesLabel(r.provides)}`)
    } else if (r.error) logUserError(r.error)
  }, [engine, guard, info, logUserError])

  const resetCode = useCallback(() => {
    if (template === null) return
    setCode(template)
    setErrorLine(null)
  }, [template, setCode])

  const selectPreset = useCallback(
    (name: string) => {
      const p = presets?.presets[name]
      if (!p) return
      setPresetName(name)
      setScenario(p)
    },
    [presets],
  )

  const presetModified = !!presets && !!scenario && !!presets.presets[presetName] && !sameScenario(presets.presets[presetName], scenario)

  return {
    engine,
    status,
    ready,
    presets,
    presetName,
    presetModified,
    selectPreset,
    scenario,
    setScenario,
    scenarioErrors,
    scenarioValid,
    template,
    code,
    setCode,
    resetCode,
    check: check && check.code === code ? check.result : null,
    lastCheck: check?.result ?? null,
    checkCode,
    errorLine,
    setErrorLine,
    session,
    stale,
    sim,
    activity,
    speed,
    setSpeed,
    test,
    open,
    play,
    pause,
    step,
    addOrders,
    runTest,
    stop,
    results,
    renameResult: (id: number, label: string) => setResults((r) => r.map((x) => (x.id === id ? { ...x, label } : x))),
    removeResult: (id: number) => setResults((r) => r.filter((x) => x.id !== id)),
    clearResults: () => setResults([]),
    log,
    clearLog: () => {
      setLog([])
      setUnreadErrors(0)
    },
    unreadErrors,
    markErrorsRead: () => setUnreadErrors(0),
  }
}

export type Workbench = ReturnType<typeof useWorkbench>
