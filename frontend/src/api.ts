import { useEffect, useState } from 'react'
import type { SimState, World } from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init)
  if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

const getJson = <T>(path: string) => request<T>(path)

const postJson = <T>(path: string, body?: unknown) =>
  request<T>(path, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const WORLD_RETRY_MS = 2000

/** The static layout. Fetched once; retried every 2 s until the backend answers. */
export function useWorld() {
  const [world, setWorld] = useState<World | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () =>
      getJson<World>('/api/world').then(
        (w) => {
          if (!alive) return
          setError(null)
          setWorld(w)
        },
        (e: Error) => {
          if (!alive) return
          setError(e.message)
          timer = setTimeout(load, WORLD_RETRY_MS)
        },
      )
    load()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [])
  return { world, error }
}

export const EMPTY_STATE: SimState = {
  tick: 0,
  running: false,
  ticks_per_second: 0,
  robots: [],
  tasks: [],
  metrics: {
    delivered: 0,
    throughput_per_100: 0,
    avg_delivery_ticks: null,
    total_wait_ticks: 0,
    waiting_now: 0,
    deadlocks: 0,
    backoffs: 0,
  },
  events: [],
}

const RECONNECT_MIN_MS = 500
const RECONNECT_MAX_MS = 8000

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/ws`
}

/**
 * Dynamic state, streamed over the /ws WebSocket (one full SimState per message).
 * Seeds itself with GET /api/state, reconnects with exponential backoff,
 * and keeps the last known state while disconnected.
 * `apply` lets callers push a state obtained elsewhere (e.g. a command's response).
 */
export function useSimState() {
  const [state, apply] = useState<SimState>(EMPTY_STATE)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    let alive = true
    let ws: WebSocket | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    let delay = RECONNECT_MIN_MS

    getJson<SimState>('/api/state').then(
      (s) => {
        if (alive) apply(s)
      },
      () => {},
    )

    const connect = () => {
      if (!alive) return
      ws = new WebSocket(wsUrl())
      ws.onopen = () => {
        delay = RECONNECT_MIN_MS
        setConnected(true)
      }
      ws.onmessage = (ev: MessageEvent<string>) => {
        try {
          apply(JSON.parse(ev.data) as SimState)
        } catch {
          // Ignore a malformed frame; the next one carries a full snapshot.
        }
      }
      // onerror is always followed by onclose, which schedules the retry.
      ws.onclose = () => {
        setConnected(false)
        if (!alive) return
        timer = setTimeout(connect, delay)
        delay = Math.min(delay * 2, RECONNECT_MAX_MS)
      }
    }
    connect()

    return () => {
      alive = false
      clearTimeout(timer)
      ws?.close()
    }
  }, [])

  return { state, connected, apply }
}

// ------------------------------------------------------------- commands ----
// Each resolves to the post-command SimState. The socket pushes the same state,
// so the return value only matters while the socket is down.

export const run = () => postJson<SimState>('/api/sim/run')
export const pause = () => postJson<SimState>('/api/sim/pause')
export const step = () => postJson<SimState>('/api/sim/step')
export const reset = () => postJson<SimState>('/api/sim/reset')
export const setSpeed = (ticksPerSecond: number) => postJson<SimState>('/api/sim/speed', { ticks_per_second: ticksPerSecond })
export const addRandomTasks = (count: number) => postJson<SimState>('/api/tasks', { count })
