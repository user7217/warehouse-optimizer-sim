// Number formatting shared by the metrics panel, test progress, and the results table.

const DASH = '—'

export function fmt(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  return v.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  return Math.round(v).toLocaleString()
}

export function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  return `${(v * 100).toFixed(1)}%`
}

/** Milliseconds with precision that suits the magnitude (µs-level calls up to whole-run totals). */
export function fmtMs(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return DASH
  if (v === 0) return '0'
  if (v < 0.01) return v.toFixed(4)
  if (v < 1) return v.toFixed(3)
  if (v < 100) return v.toFixed(2)
  return Math.round(v).toLocaleString()
}

export function fmtBytes(n: number): string {
  return `${(n / 1e6).toFixed(1)} MB`
}
