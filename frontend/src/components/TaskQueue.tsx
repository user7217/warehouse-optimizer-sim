import type { Task, TaskStatus } from '../types'

const ORDER: TaskStatus[] = ['queued', 'assigned', 'carried', 'stranded', 'delivered']

interface Props {
  tasks: Task[]
  tick: number
  selectedRobot: string | null
  onSelectRobot: (id: string) => void
  onAddTasks: (count: number) => void
}

/** Delivered tasks report how long they took; open ones report how long they have waited. */
function age(t: Task, tick: number): string {
  if (t.delivered_tick !== null) return `took ${t.delivered_tick - t.created_tick} ticks`
  return `${tick - t.created_tick} ticks`
}

export function TaskQueue({ tasks, tick, selectedRobot, onSelectRobot, onAddTasks }: Props) {
  return (
    <aside className="panel queue">
      <h2>
        Task queue <span className="count">{tasks.length}</span>
        <span className="spacer" />
        <button className="mini" onClick={() => onAddTasks(1)}>+1 task</button>
        <button className="mini" onClick={() => onAddTasks(10)}>+10 tasks</button>
      </h2>
      {tasks.length === 0 && <p className="empty">No tasks. Add some with the buttons above.</p>}
      {ORDER.map((status) => {
        const group = tasks.filter((t) => t.status === status)
        if (!group.length) return null
        return (
          <section key={status}>
            <h3 className="group">{status} · {group.length}</h3>
            <ul className="list">
              {group.map((t) => {
                const robot = t.robot
                const cls = ['row', 'task', robot ? 'clickable' : '', robot && robot === selectedRobot ? 'selected' : ''].join(' ')
                return (
                  <li key={t.id} className={cls} onClick={robot ? () => onSelectRobot(robot) : undefined}>
                    <span className="task-line">
                      <span className="mono">{t.id}</span>
                      <span className="muted">{age(t, tick)}</span>
                    </span>
                    <span className="muted mono">{t.pickup_slot} → {t.drop_dock}</span>
                    <span className="muted">{robot ?? 'unassigned'}</span>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </aside>
  )
}
