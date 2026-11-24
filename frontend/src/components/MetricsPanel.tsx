import { useLayoutEffect, useRef } from 'react'
import type { Metrics, SimEvent } from '../types'

interface Props {
  metrics: Metrics
  events: SimEvent[]
}

export function MetricsPanel({ metrics, events }: Props) {
  return (
    <aside className="panel metrics-panel">
      <h2>Metrics</h2>
      <MetricsCard m={metrics} />
      <h3 className="group">Events</h3>
      <EventLog events={events} />
    </aside>
  )
}

function MetricsCard({ m }: { m: Metrics }) {
  const rows: [string, string, boolean?][] = [
    ['Delivered', String(m.delivered)],
    ['Throughput / 100 ticks', m.throughput_per_100.toFixed(2)],
    ['Avg delivery', m.avg_delivery_ticks === null ? '—' : `${m.avg_delivery_ticks.toFixed(1)} ticks`],
    ['Total wait', `${m.total_wait_ticks} ticks`],
    ['Waiting now', String(m.waiting_now), m.waiting_now > 0],
    ['Deadlocks', String(m.deadlocks), m.deadlocks > 0],
    ['Back-offs', String(m.backoffs), m.backoffs > 0],
  ]
  return (
    <dl className="metrics">
      {rows.map(([label, value, warn]) => (
        <div key={label} className="metric">
          <dt>{label}</dt>
          <dd className={warn ? 'mono warn' : 'mono'}>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Newest at the bottom. Sticks to the bottom unless the user has scrolled up to read. */
function EventLog({ events }: { events: SimEvent[] }) {
  const ref = useRef<HTMLOListElement>(null)
  const pinned = useRef(true)

  useLayoutEffect(() => {
    const el = ref.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [events])

  const onScroll = () => {
    const el = ref.current
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  if (events.length === 0) return <p className="empty">No events yet.</p>
  return (
    <ol ref={ref} className="event-log" onScroll={onScroll}>
      {events.map((e, i) => (
        <li key={`${e.tick}-${i}-${e.kind}`} className={`event ev-${e.kind}`}>
          <span className="mono muted">{e.tick}</span>
          <span className="ev-kind">{e.kind}</span>
          <span className="ev-msg">{e.msg}</span>
        </li>
      ))}
    </ol>
  )
}
