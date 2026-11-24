import { pause, reset, run, setSpeed, step } from '../api'
import type { SimState } from '../types'

const SPEEDS = [2, 5, 10, 20, 40]

interface Props {
  state: SimState
  connected: boolean
  /** last command failure, if any */
  error: string | null
  send: (cmd: () => Promise<SimState>) => void
}

export function SimControls({ state, connected, error, send }: Props) {
  const tps = state.ticks_per_second
  const speeds = SPEEDS.includes(tps) || !(tps > 0) ? SPEEDS : [...SPEEDS, tps].sort((a, b) => a - b)

  return (
    <div className="sim-controls">
      <span className={connected ? 'conn live' : 'conn down'} title={connected ? 'Live stream connected' : 'Stream disconnected; showing last known state. Reconnecting…'}>
        <span className="dot" />
        {connected ? 'live' : 'disconnected'}
      </span>
      <span className="chip mono">tick {state.tick}</span>
      <button className={state.running ? 'on' : ''} onClick={() => send(state.running ? pause : run)}>
        {state.running ? '❚❚ Pause' : '▶ Run'}
      </button>
      <button onClick={() => send(step)} disabled={state.running} title={state.running ? 'Pause to step' : 'Advance one tick'}>
        ⏭ Step
      </button>
      <button onClick={() => send(reset)}>↺ Reset</button>
      <label className="speed">
        <select value={tps > 0 ? String(tps) : ''} onChange={(e) => send(() => setSpeed(Number(e.target.value)))}>
          {!(tps > 0) && <option value="">speed</option>}
          {speeds.map((s) => (
            <option key={s} value={String(s)}>
              {s} ticks/s
            </option>
          ))}
        </select>
      </label>
      {error && (
        <span className="cmd-error" title={error}>
          command failed
        </span>
      )}
    </div>
  )
}
