import type { Task, TaskStatus } from '../types'

const ORDER: TaskStatus[] = ['queued', 'assigned', 'carried', 'stranded', 'delivered']

export function TaskQueue({ tasks }: { tasks: Task[] }) {
  return (
    <aside className="panel queue">
      <h2>Task queue <span className="count">{tasks.length}</span></h2>
      {tasks.length === 0 && <p className="empty">No tasks. Adding jobs comes with robots.</p>}
      {ORDER.map((status) => {
        const group = tasks.filter((t) => t.status === status)
        if (!group.length) return null
        return (
          <section key={status}>
            <h3 className="group">{status} · {group.length}</h3>
            <ul className="list">
              {group.map((t) => (
                <li key={t.id} className="row task">
                  <span className="mono">{t.id}</span>
                  <span className="muted mono">{t.pickup_slot} → {t.drop_dock}</span>
                  <span className="muted">{t.robot ?? 'unassigned'}</span>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </aside>
  )
}
