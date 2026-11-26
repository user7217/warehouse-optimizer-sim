import { STATUS_COLOR } from '../colors'
import type { Robot } from '../types'

/** Rows rendered; the largest layouts allow thousands of robots. */
const MAX_ROWS = 300

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
        <p className="empty">No robots yet. Open a live session or run a test.</p>
      ) : (
        <ul className="list">
          {robots.slice(0, MAX_ROWS).map((r) => (
            <li key={r.id} className={r.id === selected ? 'row selected' : 'row'} onClick={() => onSelect(r.id === selected ? null : r.id)}>
              <span className="dot" style={{ background: STATUS_COLOR[r.status] }} />
              <span className="mono">{r.id}</span>
              <span className="muted">{r.status}</span>
              {r.payload.length > 0 && <span className="tag">carrying</span>}
            </li>
          ))}
        </ul>
      )}
      {robots.length > MAX_ROWS && <p className="more muted">+ {robots.length - MAX_ROWS} more (select robots in the views)</p>}

      {robot && <RobotDetail robot={robot} onSelect={onSelect} />}
    </aside>
  )
}

function position(r: Robot): string {
  if (!r.next_node) return r.node
  return `${r.node} → ${r.next_node} (${Math.round(r.progress * 100)}%)`
}

function RobotDetail({ robot, onSelect }: { robot: Robot; onSelect: (id: string) => void }) {
  return (
    <section className="detail">
      <h3>{robot.id}</h3>
      <dl>
        <dt>Status</dt>
        <dd style={{ color: STATUS_COLOR[robot.status] }}>{robot.status}</dd>
        <dt>Goal</dt>
        <dd className="mono">{robot.goal ? `${robot.goal}${robot.goal_node ? ` · ${robot.goal_node}` : ''}` : '—'}</dd>
        <dt>Position</dt>
        <dd className="mono">{position(robot)}</dd>
        <dt>Task</dt>
        <dd className="mono">{robot.task ?? '—'}</dd>
        <dt>Payload</dt>
        <dd className="mono">{robot.payload.length ? robot.payload.join(', ') : 'empty'}</dd>
        <dt>Waiting for</dt>
        <dd className="mono">
          {robot.waiting_for ? (
            <button className="link" onClick={() => onSelect(robot.waiting_for!)}>
              {robot.waiting_for}
            </button>
          ) : (
            '—'
          )}
        </dd>
        <dt>Wait ticks</dt>
        <dd className="mono">{robot.wait_ticks}</dd>
        <dt>Distance</dt>
        <dd className="mono">{robot.distance.toFixed(1)} m</dd>
        <dt>Delivered</dt>
        <dd className="mono">{robot.delivered}</dd>
        <dt>Path ahead</dt>
        <dd className="mono">{robot.path.length ? `${robot.path.length} nodes → ${robot.path.at(-1)}` : '—'}</dd>
        <dt>Home</dt>
        <dd className="mono">{robot.home}</dd>
      </dl>
    </section>
  )
}
