import { STATUS_COLOR } from '../colors'
import type { Robot } from '../types'

interface Props {
  robots: Robot[]
  selected: string | null
  onSelect: (id: string | null) => void
}

export function RobotSidebar({ robots, selected, onSelect }: Props) {
  const robot = robots.find((r) => r.id === selected)
  return (
    <aside className="panel sidebar">
      <h2>Robots <span className="count">{robots.length}</span></h2>
      {robots.length === 0 ? (
        <p className="empty">No robots yet. They arrive in the next build step.</p>
      ) : (
        <ul className="list">
          {robots.map((r) => (
            <li key={r.id} className={r.id === selected ? 'row selected' : 'row'} onClick={() => onSelect(r.id === selected ? null : r.id)}>
              <span className="dot" style={{ background: STATUS_COLOR[r.status] }} />
              <span className="mono">{r.id}</span>
              <span className="muted">{r.status}</span>
            </li>
          ))}
        </ul>
      )}

      {robot && (
        <section className="detail">
          <h3>{robot.id}</h3>
          <dl>
            <dt>Status</dt>
            <dd style={{ color: STATUS_COLOR[robot.status] }}>{robot.status}</dd>
            <dt>Position</dt>
            <dd className="mono">{robot.node}</dd>
            <dt>Task</dt>
            <dd className="mono">{robot.task ?? '—'}</dd>
            <dt>Payload</dt>
            <dd className="mono">{robot.payload.length ? robot.payload.join(', ') : 'empty'}</dd>
            <dt>Path ahead</dt>
            <dd className="mono">{robot.path.length ? `${robot.path.length} nodes → ${robot.path.at(-1)}` : '—'}</dd>
          </dl>
        </section>
      )}
    </aside>
  )
}
