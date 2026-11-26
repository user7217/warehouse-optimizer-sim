// Messages between the UI thread (client.ts) and the engine Web Worker (worker.ts).
//
// Requests carry an `id`; the worker answers each with exactly one `result` message.
// Events (no id) stream progress, captured stdout/stderr, and states from worker-side loops.
//
// Runaway Python is stopped out-of-band: the client writes 2 (SIGINT) into a SharedArrayBuffer
// registered with pyodide.setInterruptBuffer, then sends `stop` so loops end and the flag is cleared.

import type { CodeCheck, OpenResult, Presets, Scenario, SimState, TestReport, UserError, World } from '../types'

// ---------------------------------------------------------------- requests --

export type Request =
  | { type: 'init'; interruptBuffer: SharedArrayBuffer | null }
  | { type: 'presets' }
  | { type: 'defaultCode' }
  | { type: 'checkCode'; code: string }
  | { type: 'open'; scenario: Scenario; code: string }
  | { type: 'step'; n: number }
  | { type: 'addOrders'; count: number }
  /** start (or re-speed) the worker-side live loop */
  | { type: 'play'; ticksPerSecond: number }
  /** stop the live loop; resolves with the last state */
  | { type: 'pause' }
  /** open a fresh session and run it headless via run_chunk until done or stopped */
  | { type: 'runTest'; scenario: Scenario; code: string }
  /** end any loop and clear the interrupt flag */
  | { type: 'stop' }

export type RequestType = Request['type']

/** What each request resolves to. */
export interface ResultMap {
  init: { pyodideVersion: string; engineFiles: number }
  presets: Presets
  defaultCode: string
  checkCode: CodeCheck
  open: OpenResult
  step: SimState
  addOrders: SimState
  play: null
  pause: SimState | null
  runTest: TestOutcome
  stop: null
}

export type TestOutcome =
  | { status: 'done'; report: TestReport; elapsedMs: number }
  /** stopped by the user (loop flag or KeyboardInterrupt) */
  | { status: 'stopped'; interrupted: boolean }
  /** open_session failed (bad scenario or user code that doesn't import) */
  | { status: 'error'; error: UserError }

export type Envelope = Request & { id: number }

// ------------------------------------------------------------------ events --

export type BootStage = 'manifest' | 'download' | 'start' | 'engine' | 'ready'

export type ConsoleStream = 'out' | 'err'

export type LiveStopReason = 'paused' | 'finished' | 'error' | 'interrupted' | 'stopped' | 'failed'

export type WorkerEvent =
  | { type: 'boot'; stage: BootStage; loaded: number; total: number; detail: string }
  | { type: 'stdout'; lines: { stream: ConsoleStream; text: string }[]; dropped: number }
  /** a session was opened inside runTest; the UI can show its world */
  | { type: 'session'; world: World; state: SimState; origin: 'test' }
  | { type: 'liveState'; state: SimState }
  | { type: 'liveStopped'; reason: LiveStopReason; message: string | null }
  | { type: 'testProgress'; tick: number; progress: number; state: SimState | null }

export type WorkerMessage =
  | WorkerEvent
  | { type: 'result'; id: number; ok: true; value: unknown }
  | { type: 'result'; id: number; ok: false; error: string; interrupted: boolean }

/** Upper bound on live states posted per second, whatever the tick rate. */
export const MAX_LIVE_POSTS_PER_SEC = 15
/** run_chunk budget: long enough to amortise call overhead, short enough to stay responsive. */
export const CHUNK_BUDGET_MS = 40
/** During a test, full states (for the views) are posted at most this often. */
export const TEST_STATE_INTERVAL_MS = 250
/** During a test, light progress events are posted at most this often. */
export const TEST_PROGRESS_INTERVAL_MS = 100

/** Distinguishes a deliberate Stop (KeyboardInterrupt) from other failures in result errors. */
export class EngineCallError extends Error {
  readonly interrupted: boolean
  constructor(message: string, interrupted: boolean) {
    super(message)
    this.interrupted = interrupted
  }
}
