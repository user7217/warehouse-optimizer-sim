// Promise-based client for the engine worker. Owns the worker's lifecycle: boot, requests,
// Stop (interrupt + loop cancel), and a watchdog that restarts a worker stuck in user code.

import type { Scenario, SimState } from '../types'
import type { BootStage, Envelope, Request, ResultMap, WorkerEvent, WorkerMessage } from './protocol'
import { EngineCallError } from './protocol'

export type EngineStatus =
  | { kind: 'booting'; stage: BootStage; loaded: number; total: number; detail: string; restartReason: string | null }
  | { kind: 'ready' }
  | { kind: 'failed'; message: string }

export type EngineEvent =
  | WorkerEvent
  | { type: 'status'; status: EngineStatus }
  /** the worker was killed and re-created; every session is gone */
  | { type: 'restarted'; reason: string }

/** A call that never returned because the worker was replaced. */
export class EngineRestartedError extends Error {}

/** Silence (no message from a busy worker) after which a non-isolated worker is restarted. */
export const WATCHDOG_MS = 10_000
/** open_session builds the world; give big layouts longer before calling it hung. */
const OPEN_WATCHDOG_MS = 30_000
/** After Stop, how long the worker has to acknowledge before it is replaced. */
const STOP_GRACE_MS = 3_000

interface Pending {
  type: Request['type']
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

export class EngineClient {
  /** true when the page is cross-origin isolated, so Stop can interrupt Python in place */
  readonly canInterrupt: boolean
  status: EngineStatus = { kind: 'booting', stage: 'manifest', loaded: 0, total: 0, detail: 'Starting', restartReason: null }

  private worker!: Worker
  private readonly interruptSab: SharedArrayBuffer | null
  private readonly interrupt: Uint8Array | null
  private readonly pending = new Map<number, Pending>()
  private readonly listeners = new Set<(e: EngineEvent) => void>()
  private nextId = 1
  private lastMessageAt = performance.now()
  private liveLoop = false
  /** a runTest is still inside open_session (no progress events yet) */
  private testOpening = false
  private bootPromise: Promise<ResultMap['init']> | null = null

  constructor() {
    this.canInterrupt = typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated === true
    this.interruptSab = this.canInterrupt ? new SharedArrayBuffer(1) : null
    this.interrupt = this.interruptSab ? new Uint8Array(this.interruptSab) : null
    this.spawn()
    setInterval(() => this.checkHung(), 1000)
  }

  subscribe(fn: (e: EngineEvent) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Boot Pyodide and the engine (idempotent until the next restart). */
  boot(): Promise<ResultMap['init']> {
    this.bootPromise ??= this.request({ type: 'init', interruptBuffer: this.interruptSab }).then(
      (r) => {
        this.setStatus({ kind: 'ready' })
        return r
      },
      (e: Error) => {
        if (!(e instanceof EngineRestartedError)) this.setStatus({ kind: 'failed', message: e.message })
        throw e
      },
    )
    return this.bootPromise
  }

  /** Throw away the worker and boot a fresh one (also used by the "Retry" button). */
  restart(reason: string) {
    this.worker.terminate()
    const err = new EngineRestartedError(reason)
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
    this.liveLoop = false
    this.testOpening = false
    this.bootPromise = null
    this.emit({ type: 'restarted', reason })
    this.spawn(reason)
    void this.boot().catch(() => {})
  }

  presets = () => this.request({ type: 'presets' })
  defaultCode = () => this.request({ type: 'defaultCode' })
  checkCode = (code: string) => this.request({ type: 'checkCode', code })
  openSession = (scenario: Scenario, code: string) => this.request({ type: 'open', scenario, code })
  step = (n: number) => this.request({ type: 'step', n })
  addOrders = (count: number) => this.request({ type: 'addOrders', count })

  async runTest(scenario: Scenario, code: string) {
    this.testOpening = true
    try {
      return await this.request({ type: 'runTest', scenario, code })
    } finally {
      this.testOpening = false
    }
  }

  async play(ticksPerSecond: number): Promise<void> {
    await this.request({ type: 'play', ticksPerSecond })
    this.liveLoop = true
  }

  pause = (): Promise<SimState | null> => this.request({ type: 'pause' })

  /**
   * Stop whatever is running: raise KeyboardInterrupt inside Python (when isolated) and cancel the
   * worker's loops. If the worker doesn't answer within a few seconds it is stuck in code that can't
   * be interrupted, so it is replaced.
   */
  async stop(): Promise<void> {
    if (this.interrupt) Atomics.store(this.interrupt, 0, 2) // 2 = SIGINT
    let timer: ReturnType<typeof setTimeout> | undefined
    const grace = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), STOP_GRACE_MS)
    })
    const ack = this.request({ type: 'stop' }).then(() => 'ok' as const)
    const r = await Promise.race([ack, grace]).catch(() => 'ok' as const)
    clearTimeout(timer)
    if (r === 'timeout') {
      this.restart(
        this.canInterrupt
          ? 'The engine did not respond to Stop within 3 s, so it was restarted.'
          : 'Your code could not be interrupted in place (this page is not cross-origin isolated), so the engine was restarted.',
      )
    }
  }

  // ------------------------------------------------------------------ internals --

  private spawn(restartReason: string | null = null) {
    this.setStatus({ kind: 'booting', stage: 'manifest', loaded: 0, total: 0, detail: 'Starting', restartReason })
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'engine' })
    w.onmessage = (ev: MessageEvent<WorkerMessage>) => this.onMessage(ev.data)
    w.onerror = (ev) => {
      ev.preventDefault()
      const msg = ev.message || 'unknown error'
      if (this.status.kind === 'booting') this.setStatus({ kind: 'failed', message: `The engine worker failed to start: ${msg}` })
      else this.restart(`The engine crashed (${msg}) and was restarted.`)
    }
    this.worker = w
    this.lastMessageAt = performance.now()
  }

  private request<R extends Request>(req: R): Promise<ResultMap[R['type']]> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      if (this.pending.size === 0) this.lastMessageAt = performance.now()
      this.pending.set(id, { type: req.type, resolve: resolve as (v: unknown) => void, reject })
      const env: Envelope = { ...req, id }
      this.worker.postMessage(env)
    })
  }

  private onMessage(m: WorkerMessage) {
    this.lastMessageAt = performance.now()
    if (m.type === 'result') {
      const p = this.pending.get(m.id)
      if (!p) return
      this.pending.delete(m.id)
      if (m.ok) p.resolve(m.value)
      else p.reject(new EngineCallError(m.error, m.interrupted))
      return
    }
    if (m.type === 'boot' && this.status.kind === 'booting') {
      this.setStatus({ ...this.status, stage: m.stage, loaded: m.loaded, total: m.total, detail: m.detail })
    }
    if (m.type === 'liveStopped') this.liveLoop = false
    if (m.type === 'session') this.testOpening = false
    this.emit(m)
  }

  /** Without an interrupt buffer, a worker that goes silent while busy is stuck in user code. */
  private checkHung() {
    if (this.canInterrupt || this.status.kind !== 'ready') return
    const busy = [...this.pending.values()].filter((p) => p.type !== 'init' && p.type !== 'stop')
    if (!busy.length && !this.liveLoop) return
    // Building a world can legitimately take a while; once a test is running it posts every chunk.
    const limit = this.testOpening || busy.some((p) => p.type === 'open') ? OPEN_WATCHDOG_MS : WATCHDOG_MS
    const silent = performance.now() - this.lastMessageAt
    if (silent > limit) {
      this.restart(
        `Your code did not return within ${Math.round(silent / 1000)} s. This page is not cross-origin isolated, so Python can't be interrupted in place; the engine was restarted.`,
      )
    }
  }

  private setStatus(status: EngineStatus) {
    this.status = status
    this.emit({ type: 'status', status })
  }

  private emit(e: EngineEvent) {
    for (const fn of this.listeners) fn(e)
  }
}

let instance: EngineClient | null = null

/** The app-wide engine (one worker per page). */
export function getEngine(): EngineClient {
  instance ??= new EngineClient()
  return instance
}
