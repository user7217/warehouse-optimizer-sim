import { useLayoutEffect, useRef } from 'react'
import type { ConsoleEntry } from '../useWorkbench'
import { Icon } from './Icons'

interface Props {
  entries: ConsoleEntry[]
  onClear: () => void
  /** jump the editor to a 1-based line of the user's code */
  onJumpToLine: (line: number) => void
}

const KIND_LABEL: Record<ConsoleEntry['kind'], string> = {
  out: '',
  err: 'stderr',
  info: 'info',
  ok: 'ok',
  warn: 'warn',
  error: 'error',
}

/** print() output, engine messages and user-code errors. Sticks to the bottom unless scrolled up. */
export function ConsolePanel({ entries, onClear, onJumpToLine }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  useLayoutEffect(() => {
    const el = ref.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [entries])

  const onScroll = () => {
    const el = ref.current
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  return (
    <div className="pane console-pane">
      <div className="pane-toolbar">
        <span className="muted small">Your print() output and errors appear here.</span>
        <span className="spacer" />
        <button className="btn small" onClick={onClear} disabled={!entries.length}>
          <Icon name="trash" size={12} />
          Clear
        </button>
      </div>
      <div ref={ref} className="console" onScroll={onScroll}>
        {entries.length === 0 && <p className="muted console-empty">Nothing yet.</p>}
        {entries.map((e) => (
          <div key={e.id} className={`console-line c-${e.kind}`}>
            <span className="c-tag">{KIND_LABEL[e.kind]}</span>
            <div className="c-body">
              <span className="c-text">
                {e.text}
                {e.tick !== undefined && <span className="c-tick"> · tick {e.tick.toLocaleString()}</span>}
              </span>
              {e.error && (
                <>
                  {e.error.line !== null && (
                    <button className="link c-jump" onClick={() => onJumpToLine(e.error!.line!)}>
                      line {e.error.line}
                    </button>
                  )}
                  {e.error.traceback && <pre className="c-trace">{e.error.traceback.trimEnd()}</pre>}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
