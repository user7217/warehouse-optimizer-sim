import { useState } from 'react'
import { fmt, fmtInt, fmtMs, fmtPct } from '../format'
import type { TestReport } from '../types'
import type { ResultRow } from '../useWorkbench'
import { Icon } from './Icons'

type Better = 'lower' | 'higher' | null

interface Column {
  key: string
  label: string
  /** column group shown in the header's first row */
  group: string
  title: string
  get: (r: ResultRow) => number | null
  format: (v: number | null) => string
  better: Better
}

const m = (f: (r: TestReport) => number | null) => (row: ResultRow) => f(row.report)

const COLUMNS: Column[] = [
  { key: 'ticks', group: 'Outcome', label: 'Ticks', title: 'Makespan: ticks until the last order was delivered (ticks run when unfinished)', get: m((r) => r.ticks), format: fmtInt, better: 'lower' },
  { key: 'thr', group: 'Outcome', label: 'Thru/100', title: 'Items delivered per 100 ticks', get: m((r) => r.metrics.throughput_per_100), format: (v) => fmt(v, 2), better: 'higher' },
  { key: 'avgDel', group: 'Delivery (ticks)', label: 'Avg', title: 'Average item delivery time: created → delivered', get: m((r) => r.metrics.avg_delivery_ticks), format: fmt, better: 'lower' },
  { key: 'p95Del', group: 'Delivery (ticks)', label: 'P95', title: '95th percentile item delivery time', get: m((r) => r.metrics.p95_delivery_ticks), format: fmt, better: 'lower' },
  { key: 'queue', group: 'Delivery (ticks)', label: 'Queue', title: 'Average item queue time: created → assigned', get: m((r) => r.metrics.avg_queue_ticks), format: fmt, better: 'lower' },
  { key: 'order', group: 'Delivery (ticks)', label: 'Order', title: 'Average order time: released → last item delivered', get: m((r) => r.metrics.avg_order_ticks), format: fmt, better: 'lower' },
  { key: 'util', group: 'Fleet', label: 'Util', title: 'Robot-ticks not idle / all robot-ticks (not ranked: busier is not necessarily better)', get: m((r) => r.metrics.utilization), format: fmtPct, better: null },
  { key: 'wait', group: 'Fleet', label: 'Wait', title: 'Robot-ticks spent blocked by another robot / all robot-ticks', get: m((r) => r.metrics.wait_fraction), format: fmtPct, better: 'lower' },
  { key: 'dist', group: 'Fleet', label: 'Dist m', title: 'Total distance driven by all robots, metres', get: m((r) => r.metrics.distance_total), format: fmtInt, better: 'lower' },
  { key: 'dead', group: 'Fleet', label: 'Dlk', title: 'Deadlocks detected', get: m((r) => r.metrics.deadlocks), format: fmtInt, better: 'lower' },
  { key: 'back', group: 'Fleet', label: 'Back', title: 'Back-offs (robots reversing to clear a deadlock)', get: m((r) => r.metrics.backoffs), format: fmtInt, better: 'lower' },
  { key: 'rMean', group: 'Router (ms)', label: 'Mean', title: 'Router.route + Router.distance: mean ms per call', get: m((r) => r.timing.route.mean_ms), format: fmtMs, better: 'lower' },
  { key: 'rP95', group: 'Router (ms)', label: 'P95', title: 'Router: 95th percentile ms per call', get: m((r) => r.timing.route.p95_ms), format: fmtMs, better: 'lower' },
  { key: 'rTot', group: 'Router (ms)', label: 'Total', title: 'Router: total ms', get: m((r) => r.timing.route.total_ms), format: fmtMs, better: 'lower' },
  { key: 'rCalls', group: 'Router (ms)', label: 'Calls', title: 'Router: number of calls', get: m((r) => r.timing.route.calls), format: fmtInt, better: null },
  { key: 'aMean', group: 'Assigner (ms)', label: 'Mean', title: 'Assigner.assign: mean ms per call', get: m((r) => r.timing.assign.mean_ms), format: fmtMs, better: 'lower' },
  { key: 'aTot', group: 'Assigner (ms)', label: 'Total', title: 'Assigner.assign: total ms', get: m((r) => r.timing.assign.total_ms), format: fmtMs, better: 'lower' },
  { key: 'tMean', group: 'Tick (ms)', label: 'Mean', title: 'Whole engine tick (including router and assigner): mean ms', get: m((r) => r.timing.tick.mean_ms), format: fmtMs, better: 'lower' },
  { key: 'tP95', group: 'Tick (ms)', label: 'P95', title: 'Whole engine tick: 95th percentile ms', get: m((r) => r.timing.tick.p95_ms), format: fmtMs, better: 'lower' },
  { key: 'wall', group: 'Wall', label: 'ms', title: 'Wall time spent inside the engine (step/run_chunk). Hover a cell for the full browser time.', get: m((r) => r.timing.wall_ms), format: fmtMs, better: 'lower' },
]

const GROUP_SPANS = COLUMNS.reduce<{ group: string; span: number }[]>((acc, c) => {
  const last = acc.at(-1)
  if (last && last.group === c.group) last.span++
  else acc.push({ group: c.group, span: 1 })
  return acc
}, [])

/** Best value per ranked column, among completed runs only (unfinished runs aren't comparable). */
function bestValues(rows: ResultRow[]): Record<string, number> {
  const best: Record<string, number> = {}
  const done = rows.filter((r) => r.report.reason === 'complete')
  if (done.length < 2) return best
  for (const c of COLUMNS) {
    if (!c.better) continue
    const vals = done.map(c.get).filter((v): v is number => v !== null && Number.isFinite(v))
    if (vals.length < 2) continue
    const b = c.better === 'lower' ? Math.min(...vals) : Math.max(...vals)
    // No highlight when everyone ties.
    if (vals.some((v) => v !== b)) best[c.key] = b
  }
  return best
}

function scenarioSummary(r: TestReport): string {
  const s = r.scenario
  return `${s.name}: ${s.layout.aisles}×${s.layout.columns}×${s.layout.levels} (aisles×cols×levels), ${s.robots.count} robots, ${s.workload.orders} orders (${s.workload.arrival}), seed ${s.seed}`
}

interface Props {
  rows: ResultRow[]
  onRename: (id: number, label: string) => void
  onRemove: (id: number) => void
  onClear: () => void
}

export function ResultsTable({ rows, onRename, onRemove, onClear }: Props) {
  const [selected, setSelected] = useState<number[]>([])
  const live = selected.filter((id) => rows.some((r) => r.id === id))
  const best = bestValues(rows)
  const pair = live.length === 2 ? live.map((id) => rows.find((r) => r.id === id)!) : null

  const toggle = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s.filter((x) => rows.some((r) => r.id === x)), id].slice(-2)))

  if (!rows.length)
    return (
      <div className="pane results-empty">
        <p className="empty">
          No results yet. Press <b>Run test</b> to benchmark your code on the current scenario; each run adds a row here so you can compare algorithms side by side.
        </p>
      </div>
    )

  return (
    <div className="pane results-pane">
      <div className="pane-toolbar">
        <span className="muted small">
          {rows.length} run{rows.length === 1 ? '' : 's'} · best per column highlighted among completed runs · tick the boxes of two runs to compare · timings are measured in this browser
          (Pyodide), so compare runs from the same machine
        </span>
        <span className="spacer" />
        <button className="btn small" onClick={onClear}>
          <Icon name="trash" size={12} />
          Clear
        </button>
      </div>
      <div className="table-scroll">
        <table className="results">
          <thead>
            <tr className="group-row">
              <th colSpan={3} />
              {GROUP_SPANS.map((g) => (
                <th key={g.group} colSpan={g.span} className="group-th">
                  {g.group}
                </th>
              ))}
              <th />
            </tr>
            <tr>
              <th className="sel" />
              <th className="label-col">Run</th>
              <th>Status</th>
              {COLUMNS.map((c) => (
                <th key={c.key} title={c.title} className="num">
                  {c.label}
                  {c.better && <span className="dir">{c.better === 'lower' ? '↓' : '↑'}</span>}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={live.includes(r.id) ? 'selected' : undefined}>
                <td className="sel">
                  <input type="checkbox" checked={live.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`Compare ${r.label}`} />
                </td>
                <td className="label-col">
                  <input className="label-input" value={r.label} onChange={(e) => onRename(r.id, e.target.value)} title={scenarioSummary(r.report)} />
                </td>
                <td>
                  <StatusBadge report={r.report} />
                </td>
                {COLUMNS.map((c) => {
                  const v = c.get(r)
                  const isBest = best[c.key] !== undefined && v === best[c.key] && r.report.reason === 'complete'
                  return (
                    <td key={c.key} className={isBest ? 'num best' : 'num'} title={c.key === 'wall' ? `Browser time for the whole test: ${fmtMs(r.elapsedMs)} ms` : undefined}>
                      {c.format(v)}
                    </td>
                  )
                })}
                <td>
                  <button className="icon-btn" onClick={() => onRemove(r.id)} title="Remove this row" aria-label="Remove">
                    <Icon name="x" size={12} />
                  </button>
                </td>
              </tr>
            ))}
            {pair && <DeltaRow a={pair[0]} b={pair[1]} />}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StatusBadge({ report }: { report: TestReport }) {
  if (report.reason === 'complete') return <span className="badge ok">complete</span>
  if (report.reason === 'max_ticks')
    return (
      <span className="badge warn" title={`${report.metrics.orders_done} of ${report.metrics.orders_planned} orders done`}>
        max ticks
      </span>
    )
  return (
    <span className="badge danger" title={report.error ? `${report.error.phase}: ${report.error.message}` : undefined}>
      error
    </span>
  )
}

/** Second selected run relative to the first, as a percentage; green when it moved the right way. */
function DeltaRow({ a, b }: { a: ResultRow; b: ResultRow }) {
  return (
    <tr className="delta-row">
      <td className="sel">Δ</td>
      <td className="label-col muted" colSpan={2} title={`${b.label} relative to ${a.label}`}>
        #{b.id} vs #{a.id}
      </td>
      {COLUMNS.map((c) => {
        const va = c.get(a)
        const vb = c.get(b)
        if (va === null || vb === null || !Number.isFinite(va) || !Number.isFinite(vb)) return <td key={c.key} className="num muted">—</td>
        if (va === vb) return <td key={c.key} className="num muted">0</td>
        const pct = va === 0 ? null : ((vb - va) / Math.abs(va)) * 100
        const good = c.better === null ? null : c.better === 'lower' ? vb < va : vb > va
        const cls = good === null ? 'num' : good ? 'num delta-good' : 'num delta-bad'
        return (
          <td key={c.key} className={cls} title={`${c.format(va)} → ${c.format(vb)}`}>
            {pct === null ? (vb > va ? '+' : '−') : `${pct > 0 ? '+' : ''}${pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`}
          </td>
        )
      })}
      <td />
    </tr>
  )
}
