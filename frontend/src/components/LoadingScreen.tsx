import type { EngineStatus } from '../engine/client'
import type { BootStage } from '../engine/protocol'
import { fmtBytes } from '../format'
import { Logo } from './Brand'

const STAGES: { stage: BootStage; label: string }[] = [
  { stage: 'download', label: 'Download Python runtime' },
  { stage: 'start', label: 'Start Python' },
  { stage: 'engine', label: 'Load simulator' },
]
const ORDER: BootStage[] = ['manifest', 'download', 'start', 'engine', 'ready']

interface Props {
  status: Extract<EngineStatus, { kind: 'booting' | 'failed' }>
  onRetry: () => void
}

/** Full-screen boot state: Pyodide is ~13 MB on first visit, then served from the browser cache. */
export function LoadingScreen({ status, onRetry }: Props) {
  const failed = status.kind === 'failed'
  const at = failed ? -1 : ORDER.indexOf(status.stage)
  const downloading = !failed && status.stage === 'download'
  const pct = downloading && status.total > 0 ? Math.min(1, status.loaded / status.total) : null

  return (
    <div className="boot">
      <div className="boot-card">
        <div className="boot-head">
          <Logo size={36} />
          <div>
            <h1>
              Warehouse<b>Lab</b>
            </h1>
            <p className="muted">Robot routing &amp; assignment testbed. Your Python runs entirely in this browser tab.</p>
          </div>
        </div>

        {failed ? (
          <div className="boot-error">
            <h2>The engine failed to start</h2>
            <pre>{status.message}</pre>
            <button className="btn primary" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : (
          <>
            {status.restartReason && <p className="boot-note">{status.restartReason}</p>}
            <ol className="boot-steps">
              {STAGES.map(({ stage, label }) => {
                const i = ORDER.indexOf(stage)
                const state = i < at ? 'done' : i === at ? 'active' : 'todo'
                return (
                  <li key={stage} className={state}>
                    <span className="boot-dot" />
                    <span>{label}</span>
                    {stage === 'download' && downloading && status.total > 0 && (
                      <span className="mono muted boot-bytes">
                        {fmtBytes(status.loaded)} / {fmtBytes(status.total)}
                      </span>
                    )}
                  </li>
                )
              })}
            </ol>
            <div className={pct === null ? 'progress indeterminate' : 'progress'}>
              <div style={pct === null ? undefined : { width: `${pct * 100}%` }} />
            </div>
            <p className="muted small">First visit downloads about 13 MB; later visits load from cache. Nothing you write leaves your browser.</p>
          </>
        )}
      </div>
    </div>
  )
}
