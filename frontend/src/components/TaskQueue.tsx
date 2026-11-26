import type { Task, TaskStatus } from '../types'

const ORDER: TaskStatus[] = ['queued', 'assigned', 'carried', 'stranded', 'delivered']
/** Rows rendered per status group; big tests can have thousands of open tasks. */
const MAX_ROWS = 150

interface Props {
  tasks: Task[]
  tick: number
  selectedRobot: string | null
  onSelectRobot: (id: string) => void
  /** null when orders can't be added right now */
  onAddOrders: ((count: number) => void) | null
}

/** Delivered tasks report how long they took; open ones report how long they have waited. */
function age(t: Task, tick: number): string {
  if (t.delivered_tick !== null) return `took ${t.delivered_tick - t.created_tick} ticks`
  return `${tick - t.created_tick} ticks`
}

export function TaskQueue({ tasks, tick, selectedRobot, onSelectRobot, onAddOrders }: Props) {
  return (
    <aside className="panel queue">
      <h2>
        Tasks <span className="count">{tasks.length}</span>
        <span className="spacer" />
        <button className="mini" disabled={!onAddOrders} onClick={() => onAddOrders?.(1)} title="Release one extra order now">
          +1 order
        </button>
        <button className="mini" disabled={!onAddOrders} onClick={() => onAddOrders?.(10)} title="Release ten extra orders now">
          +10
        </button>
      </h2>
      {tasks.length === 0 && <p className="empty">No open tasks. Orders release as the run advances, or add some above.</p>}
      {ORDER.map((status) => {
        const group = tasks.filter((t) => t.status === status)
        if (!group.length) return null
        // Delivered: newest first. Open tasks: oldest first.
        const shown = status === 'delivered' ? group.slice(-MAX_ROWS).reverse() : group.slice(0, MAX_ROWS)
        return (
          <section key={status}>
            <h3 className="group">
              {status} · {group.length}
            </h3>
            <ul className="list">
              {shown.map((t) => {
                const robot = t.robot
                const cls = ['row', 'task', robot ? 'clickable' : '', robot && robot === selectedRobot ? 'selected' : ''].join(' ')
                return (
                  <li key={t.id} className={cls} onClick={robot ? () => onSelectRobot(robot) : undefined}>
                    <span className="task-line">
                      <span className="mono">{t.id}</span>
                      <span className="muted">{age(t, tick)}</span>
                    </span>
                    <span className="muted mono">
                      {t.pickup_slot} → {t.drop_dock}
                    </span>
                    <span className="muted">
                      {t.order} · {robot ?? 'unassigned'}
                    </span>
                  </li>
                )
              })}
            </ul>
            {group.length > shown.length && <p className="more muted">+ {group.length - shown.length} more</p>}
          </section>
        )
      })}
    </aside>
  )
}
