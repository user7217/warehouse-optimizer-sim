// The engine worker: boots Pyodide, loads the warehouse_sim package into its filesystem, and
// serves requests from client.ts (see protocol.ts). Live runs and tests loop here, inside the
// worker, so the UI thread only receives finished states.

import type { PyodideAPI } from 'pyodide'
import type { ChunkResult, CodeCheck, OpenResult, Presets, SimState, TestReport, UserError } from '../types'
import {
  CHUNK_BUDGET_MS,
  MAX_LIVE_POSTS_PER_SEC,
  TEST_PROGRESS_INTERVAL_MS,
  TEST_STATE_INTERVAL_MS,
  type BootStage,
  type ConsoleStream,
  type Envelope,
  type LiveStopReason,
  type Request,
  type ResultMap,
  type TestOutcome,
  type WorkerMessage,
} from './protocol'

// The tsconfig uses the DOM lib, not WebWorker; describe the bits of the worker scope we use.
interface WorkerScope {
  postMessage(message: WorkerMessage): void
  onmessage: ((ev: MessageEvent<Envelope>) => void) | null
  fetch: typeof fetch
}
const scope = self as unknown as WorkerScope
const post = (m: WorkerMessage) => scope.postMessage(m)

// Engine sources, bundled at build time. Keys look like '../../../engine/src/warehouse_sim/sim/engine.py'.
const ENGINE_SOURCES = import.meta.glob('../../../engine/src/warehouse_sim/**/*.py', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const ENGINE_ROOT = '/engine'
const PYODIDE_URL = new URL(`${import.meta.env.BASE_URL}pyodide/`, self.location.origin).href

type RunnerFn = 'presets' | 'default_code' | 'check_code' | 'open_session' | 'step' | 'get_state' | 'add_orders' | 'run_chunk' | 'report'
const RUNNER_FNS: RunnerFn[] = ['presets', 'default_code', 'check_code', 'open_session', 'step', 'get_state', 'add_orders', 'run_chunk', 'report']

let pyodide: PyodideAPI | null = null
const runner = new Map<RunnerFn, (...args: unknown[]) => unknown>()

// ------------------------------------------------------------ console capture --

const MAX_LINES_PER_FLUSH = 500
const MAX_LINE_CHARS = 2000
const FLUSH_MS = 100

const out = { lines: [] as { stream: ConsoleStream; text: string }[], dropped: 0, timer: undefined as ReturnType<typeof setTimeout> | undefined }

function captureLine(stream: ConsoleStream, text: string) {
  if (out.lines.length >= MAX_LINES_PER_FLUSH) out.dropped++
  else out.lines.push({ stream, text: text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS)}…` : text })
  out.timer ??= setTimeout(flushConsole, FLUSH_MS)
}

function flushConsole() {
  clearTimeout(out.timer)
  out.timer = undefined
  if (!out.lines.length && !out.dropped) return
  post({ type: 'stdout', lines: out.lines, dropped: out.dropped })
  out.lines = []
  out.dropped = 0
}

// ----------------------------------------------------------------------- boot --

function bootEvent(stage: BootStage, detail: string, loaded = 0, total = 0) {
  post({ type: 'boot', stage, loaded, total, detail })
}

/**
 * Count bytes of the big runtime files as they stream in. The response is cloned and the clone is
 * drained in parallel, so Pyodide still gets the original (keeping the browser's wasm code cache).
 */
function withDownloadProgress(sizes: Record<string, number>): () => void {
  const realFetch = scope.fetch
  const total = Object.values(sizes).reduce((a, b) => a + b, 0)
  let loaded = 0
  let lastPost = 0
  const report = (force = false) => {
    const now = performance.now()
    if (!force && now - lastPost < 80) return
    lastPost = now
    // Once the bytes are in, Pyodide compiles the wasm and starts the interpreter.
    if (total > 0 && loaded >= total) bootEvent('start', 'Starting Python')
    else bootEvent('download', 'Downloading the Python runtime', Math.min(loaded, total), total)
  }
  scope.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await realFetch(input, init)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const name = url.split('?')[0].split('/').pop() ?? ''
    if (!(name in sizes) || !res.ok || !res.body) return res
    const reader = res.clone().body!.getReader()
    void (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          loaded += value.byteLength
          report()
        }
      } catch {
        // Progress is cosmetic; Pyodide reports real failures itself.
      }
      report(true)
    })()
    return res
  }
  return () => {
    scope.fetch = realFetch
  }
}

async function boot(interruptBuffer: SharedArrayBuffer | null): Promise<ResultMap['init']> {
  bootEvent('manifest', 'Preparing')
  let sizes: Record<string, number> = {}
  try {
    const manifest = (await (await fetch(`${PYODIDE_URL}files.json`)).json()) as { files: Record<string, number> }
    // Only files fetched with fetch() can be counted (the .mjs files go through import()).
    sizes = Object.fromEntries(Object.entries(manifest.files).filter(([f]) => !f.endsWith('.mjs')))
  } catch {
    // No manifest: show an indeterminate bar.
  }

  const restoreFetch = withDownloadProgress(sizes)
  bootEvent('download', 'Downloading the Python runtime', 0, Object.values(sizes).reduce((a, b) => a + b, 0))
  let py: PyodideAPI
  try {
    const mod = (await import(/* @vite-ignore */ `${PYODIDE_URL}pyodide.mjs`)) as typeof import('pyodide')
    py = await mod.loadPyodide({
      indexURL: PYODIDE_URL,
      stdout: (s) => captureLine('out', s),
      stderr: (s) => captureLine('err', s),
    })
  } finally {
    restoreFetch()
  }

  bootEvent('start', 'Starting Python')
  py.setStdout({ batched: (s: string) => captureLine('out', s) })
  py.setStderr({ batched: (s: string) => captureLine('err', s) })
  if (interruptBuffer) py.setInterruptBuffer(new Uint8Array(interruptBuffer))

  bootEvent('engine', 'Loading the simulator')
  let count = 0
  for (const [key, source] of Object.entries(ENGINE_SOURCES)) {
    const rel = key.slice(key.indexOf('warehouse_sim/'))
    const path = `${ENGINE_ROOT}/${rel}`
    py.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')))
    py.FS.writeFile(path, source)
    count++
  }
  if (count === 0) throw new Error('No engine sources were bundled (engine/src/warehouse_sim/**/*.py).')
  py.runPython(`import sys\nif ${JSON.stringify(ENGINE_ROOT)} not in sys.path:\n    sys.path.insert(0, ${JSON.stringify(ENGINE_ROOT)})`)

  let mod: { [k: string]: unknown }
  try {
    mod = py.pyimport('warehouse_sim.runner') as unknown as { [k: string]: unknown }
  } catch (e) {
    throw new Error(`Could not import warehouse_sim.runner:\n${errorText(e)}`)
  }
  for (const name of RUNNER_FNS) {
    const fn = mod[name]
    if (typeof fn !== 'function') throw new Error(`warehouse_sim.runner is missing ${name}()`)
    runner.set(name, fn as (...args: unknown[]) => unknown)
  }
  pyodide = py
  flushConsole()
  bootEvent('ready', 'Ready')
  return { pyodideVersion: py.version, engineFiles: count }
}

// ---------------------------------------------------------------- python calls --

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function isInterrupt(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  return (e as { type?: string }).type === 'KeyboardInterrupt' || /\bKeyboardInterrupt\b/.test(e.message)
}

/** A UserError caused by our own interrupt (in case the runner catches BaseException). */
function isInterruptError(err: UserError | null): boolean {
  return !!err && /\bKeyboardInterrupt\b/.test(`${err.message}\n${err.traceback}`)
}

function callRaw(name: RunnerFn, ...args: unknown[]): string {
  const fn = runner.get(name)
  if (!pyodide || !fn) throw new Error('The engine is not loaded yet.')
  return String(fn(...args))
}

function call<T>(name: RunnerFn, ...args: unknown[]): T {
  return JSON.parse(callRaw(name, ...args)) as T
}

/**
 * For calls that return a SimState / ChunkResult / TestReport: the runner answers
 * {ok: false, error} instead when there is no session. Surface that as a failure.
 */
function callSession<T>(name: RunnerFn, ...args: unknown[]): T {
  const r = call<T | { ok: false; error: UserError | null }>(name, ...args)
  if (r && typeof r === 'object' && 'ok' in r && r.ok === false) throw new Error(r.error?.message ?? `${name}() failed`)
  return r as T
}

// ------------------------------------------------------------------------ loops --

/** Bumped to cancel whichever loop is running; each loop checks its own token. */
let loopToken = 0
let live: { token: number; tps: number; acc: number; last: number; timer: ReturnType<typeof setTimeout> | undefined } | null = null
let lastState: SimState | null = null

function stopLoops() {
  loopToken++
  if (live) clearTimeout(live.timer)
  live = null
}

/** Cancel loops before another request takes over the session; tells the UI if a live run ended. */
function haltLoops() {
  const wasLive = !!live
  stopLoops()
  if (wasLive) post({ type: 'liveStopped', reason: 'stopped', message: null })
}

function endLive(reason: LiveStopReason, message: string | null) {
  stopLoops()
  flushConsole()
  post({ type: 'liveStopped', reason, message })
}

function startLive(tps: number) {
  if (live) {
    live.tps = tps
    return
  }
  const token = ++loopToken
  live = { token, tps, acc: 1, last: performance.now(), timer: undefined }
  liveTick(token)
}

function liveTick(token: number) {
  const l = live
  if (!l || l.token !== token) return
  const now = performance.now()
  // Accumulate due ticks from real elapsed time; cap the backlog so a slow tick can't snowball.
  l.acc = Math.min(l.acc + ((now - l.last) * l.tps) / 1000, Math.max(1, l.tps / 2))
  l.last = now
  const k = Math.floor(l.acc)
  if (k >= 1) {
    l.acc -= k
    let state: SimState
    try {
      state = callSession<SimState>('step', k)
    } catch (e) {
      endLive(isInterrupt(e) ? 'interrupted' : 'failed', isInterrupt(e) ? null : errorText(e))
      return
    }
    lastState = state
    post({ type: 'liveState', state })
    if (state.error) {
      endLive(isInterruptError(state.error) ? 'interrupted' : 'error', state.error.message)
      return
    }
    if (state.finished) {
      endLive('finished', null)
      return
    }
  }
  if (live?.token !== token) return
  const interval = Math.max(1000 / l.tps, 1000 / MAX_LIVE_POSTS_PER_SEC)
  const spent = performance.now() - now
  l.timer = setTimeout(() => liveTick(token), Math.max(0, interval - spent))
}

/** Yield to the event loop (so `stop` can arrive) without setTimeout's 4 ms clamp. */
function yieldToEvents(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel()
    ch.port1.onmessage = () => {
      ch.port1.close()
      resolve()
    }
    ch.port2.postMessage(null)
  })
}

async function runTest(scenarioJson: string, code: string): Promise<TestOutcome> {
  const token = ++loopToken
  const t0 = performance.now()
  let opened: OpenResult
  try {
    opened = call<OpenResult>('open_session', scenarioJson, code)
  } catch (e) {
    if (isInterrupt(e)) return { status: 'stopped', interrupted: true }
    throw e
  }
  if (!opened.ok || !opened.world || !opened.state) {
    if (isInterruptError(opened.error)) return { status: 'stopped', interrupted: true }
    return { status: 'error', error: opened.error ?? engineError('open_session failed without an error') }
  }
  lastState = opened.state
  post({ type: 'session', world: opened.world, state: opened.state, origin: 'test' })

  let lastProgress = 0
  let lastFull = 0
  for (;;) {
    await yieldToEvents()
    if (token !== loopToken) return { status: 'stopped', interrupted: false }
    let r: ChunkResult
    try {
      r = callSession<ChunkResult>('run_chunk', CHUNK_BUDGET_MS)
    } catch (e) {
      if (isInterrupt(e)) return { status: 'stopped', interrupted: true }
      throw e
    }
    lastState = r.state
    const now = performance.now()
    if (r.done || now - lastFull >= TEST_STATE_INTERVAL_MS) {
      lastFull = lastProgress = now
      post({ type: 'testProgress', tick: r.tick, progress: r.progress, state: r.state })
    } else if (now - lastProgress >= TEST_PROGRESS_INTERVAL_MS) {
      lastProgress = now
      post({ type: 'testProgress', tick: r.tick, progress: r.progress, state: null })
    }
    if (r.done) {
      const report = r.report ?? callSession<TestReport>('report')
      if (report.reason === 'error' && isInterruptError(report.error)) return { status: 'stopped', interrupted: true }
      return { status: 'done', report, elapsedMs: performance.now() - t0 }
    }
  }
}

function engineError(message: string): UserError {
  return { phase: 'engine', message, traceback: '', line: null }
}

// ------------------------------------------------------------------- dispatch --

async function handle(req: Request): Promise<unknown> {
  switch (req.type) {
    case 'init':
      return boot(req.interruptBuffer)
    case 'presets':
      return call<Presets>('presets')
    case 'defaultCode':
      return callRaw('default_code')
    case 'checkCode':
      return call<CodeCheck>('check_code', req.code)
    case 'open': {
      haltLoops()
      const r = call<OpenResult>('open_session', JSON.stringify(req.scenario), req.code)
      lastState = r.state
      return r
    }
    case 'step':
      haltLoops()
      return (lastState = callSession<SimState>('step', req.n))
    case 'addOrders':
      // Allowed during a live run: it lands between two loop iterations.
      return (lastState = callSession<SimState>('add_orders', req.count))
    case 'play':
      startLive(req.ticksPerSecond)
      return null
    case 'pause':
      if (live) endLive('paused', null)
      return lastState
    case 'runTest':
      haltLoops()
      return runTest(JSON.stringify(req.scenario), req.code)
    case 'stop':
      haltLoops()
      return null
  }
}

let interruptView: Uint8Array | null = null

scope.onmessage = (ev) => {
  const { id, ...req } = ev.data
  if (req.type === 'init' && req.interruptBuffer) interruptView = new Uint8Array(req.interruptBuffer)
  // The client sets the interrupt flag, then sends `stop`. By the time `stop` is handled no Python is
  // running (the worker is single-threaded), so any call it could have interrupted already was.
  // Clear it now so it can't hit the next, unrelated call.
  if (req.type === 'stop' && interruptView) Atomics.store(interruptView, 0, 0)
  handle(req as Request).then(
    (value) => {
      flushConsole()
      post({ type: 'result', id, ok: true, value })
    },
    (e: unknown) => {
      flushConsole()
      post({ type: 'result', id, ok: false, error: errorText(e), interrupted: isInterrupt(e) })
    },
  )
}
