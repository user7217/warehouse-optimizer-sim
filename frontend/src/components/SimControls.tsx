import { fmtInt, fmtPct } from '../format'
import { MOD_KEY } from '../keys'
import type { SimState } from '../types'
import { SPEEDS, type Activity, type TestProgress } from '../useWorkbench'
import { Icon } from './Icons'

interface Props {
  ready: boolean
  activity: Activity
  sim: SimState | null
  hasSession: boolean
  /** the live session predates the current code/scenario */
  stale: boolean
  scenarioValid: boolean
  speed: number
  onSpeed: (tps: number) => void
  onPlay: () => void
  onPause: () => void
  onStep: () => void
  onReset: () => void
  onRunTest: () => void
  onStop: () => void
  test: TestProgress | null
}

/** Top-bar controls: the live (visual) run on the left, the headless benchmark on the right. */
export function SimControls(p: Props) {
  const { ready, activity, sim, hasSession, stale, scenarioValid, speed, test } = p
  const idle = activity === 'idle'
  const live = activity === 'live'
  const testing = activity === 'testing'
  const ended = !!sim && (sim.finished || !!sim.error)
  const canRun = ready && scenarioValid && (idle || live)
  const playLabel = live ? 'Pause' : !hasSession || stale ? 'Apply & run' : ended ? 'Restart' : 'Run'
  const playTitle = live
    ? 'Pause the live run'
    : !hasSession || stale
      ? 'Open a new live session with the current code and scenario, then run it'
      : ended
        ? 'Start a fresh live session'
        : 'Run the live session'

  return (
    <div className="sim-controls">
      <div className="control-group" role="group" aria-label="Live run">
        <span className="group-label">Live</span>
        <button className={live ? 'btn on' : 'btn'} disabled={!canRun} onClick={live ? p.onPause : p.onPlay} title={playTitle}>
          <Icon name={live ? 'pause' : 'play'} />
          {playLabel}
        </button>
        <button className="btn icon-only" disabled={!ready || !idle || !scenarioValid} onClick={p.onStep} title="Advance one tick">
          <Icon name="step" />
        </button>
        <button className="btn icon-only" disabled={!ready || !idle || !scenarioValid} onClick={p.onReset} title="New live session with the current code and scenario">
          <Icon name="reset" />
        </button>
        <select className="input compact" value={speed} onChange={(e) => p.onSpeed(Number(e.target.value))} title="Live speed" disabled={!ready}>
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s} ticks/s
            </option>
          ))}
        </select>
      </div>

      <div className="control-group" role="group" aria-label="Benchmark">
        {testing && test ? (
          <div className="test-progress" title="Headless test running in the engine worker">
            <div className="progress small">
              <div style={{ width: `${Math.min(100, test.progress * 100)}%` }} />
            </div>
            <span className="mono">{fmtPct(test.progress)}</span>
            <span className="mono muted">tick {fmtInt(test.tick)}</span>
            {sim && <span className="mono muted">{fmtInt(sim.metrics.delivered)} items</span>}
          </div>
        ) : (
          <button
            className="btn primary"
            disabled={!ready || !scenarioValid || !(idle || live)}
            onClick={p.onRunTest}
            title={`Run a headless benchmark with the current code and scenario (${MOD_KEY}+Enter)`}
          >
            <Icon name="bolt" />
            Run test
          </button>
        )}
        {!idle && (
          <button className="btn danger" onClick={p.onStop} title="Stop the running code">
            <Icon name="stop" />
            Stop
          </button>
        )}
      </div>
    </div>
  )
}
