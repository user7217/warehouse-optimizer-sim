import { useLayoutEffect, useRef } from 'react'
import { fmt, fmtInt, fmtMs, fmtPct } from '../format'
import type { CallStats, Metrics, SimEvent, Timing } from '../types'

interface Props {
  metrics: Metrics | null
  timing: Timing | null
  events: SimEvent[]
}

export function MetricsPanel({ metrics, timing, events }: Props) {
  return (
    <aside className="panel metrics-panel">
      <h2>Metrics</h2>
      {metrics ? <MetricsCard m={metrics} /> : <p className="empty">No session.</p>}
      {timing && (
        <>
          <h3 className="group">
            Timing <span className="muted small-case">ms, measured in this browser</span>
          </h3>
          <TimingTable t={timing} />
        </>
      )}
      <h3 className="group">Events</h3>
      <EventLog events={events} />
    </aside>
  )
}

function MetricsCard({ m }: { m: Metrics }) {
  const orderPct = m.orders_planned > 0 ? m.orders_done / m.orders_planned : 0
  const rows: [string, string, boolean?][] = [
    ['Delivered', `${fmtInt(m.delivered)} / ${fmtInt(m.tasks_total)}`],
    ['Thru / 100 t', fmt(m.throughput_per_100, 2)],
    ['Avg delivery', fmt(m.avg_delivery_ticks)],
    ['P95 delivery', fmt(m.p95_delivery_ticks)],
    ['Avg queue', fmt(m.avg_queue_ticks)],
    ['Avg order', fmt(m.avg_order_ticks)],
    ['Utilization', fmtPct(m.utilization)],
    ['Wait share', fmtPct(m.wait_fraction), m.wait_fraction > 0.25],
    ['Distance', `${fmtInt(m.distance_total)} m`],
    ['Waiting now', fmtInt(m.waiting_now), m.waiting_now > 0],
    ['Deadlocks', fmtInt(m.deadlocks), m.deadlocks > 0],
    ['Back-offs', fmtInt(m.backoffs), m.backoffs > 0],
  ]
  return (
    <>
      <div className="order-progress" title={`${m.orders_total} released so far`}>
        <div className="order-progress-head">
          <span className="muted">Orders</span>
          <span className="mono">
            {fmtInt(m.orders_done)} / {fmtInt(m.orders_planned)}
          </span>
        </div>
        <div className="progress small">
          <div style={{ width: `${Math.min(100, orderPct * 100)}%` }} />
        </div>
      </div>
      <dl className="metrics">
        {rows.map(([label, value, warn]) => (
          <div key={label} className="metric">
            <dt>{label}</dt>
            <dd className={warn ? 'mono warn' : 'mono'}>{value}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}

function TimingTable({ t }: { t: Timing }) {
  const row = (label: string, s: CallStats) => (
    <tr>
      <th>{label}</th>
      <td>{fmtMs(s.mean_ms)}</td>
      <td>{fmtMs(s.p95_ms)}</td>
      <td>{fmtMs(s.total_ms)}</td>
      <td>{fmtInt(s.calls)}</td>
    </tr>
  )
  return (
    <table className="timing">
      <thead>
        <tr>
          <th />
          <th>mean</th>
          <th>p95</th>
          <th>total</th>
          <th>calls</th>
        </tr>
      </thead>
      <tbody>
        {row('Route', t.route)}
        {row('Assign', t.assign)}
        {row('Tick', t.tick)}
        <tr className="wall">
          <th>Wall</th>
          <td colSpan={4}>{fmtMs(t.wall_ms)} ms in engine</td>
        </tr>
      </tbody>
    </table>
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
