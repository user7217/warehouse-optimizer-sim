import { useEffect, useState } from 'react'
import type { SimState, World } from './types'

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${path}: ${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

/** The static layout. Fetched once. */
export function useWorld() {
  const [world, setWorld] = useState<World | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    getJson<World>('/api/world').then(setWorld, (e: Error) => setError(e.message))
  }, [])
  return { world, error }
}

/** Dynamic state. Polled for now; becomes a WebSocket stream once robots move. */
export function useSimState(intervalMs = 1000) {
  const [state, setState] = useState<SimState>({ tick: 0, robots: [], tasks: [] })
  useEffect(() => {
    let alive = true
    const poll = () => getJson<SimState>('/api/state').then((s) => alive && setState(s), () => {})
    poll()
    const id = setInterval(poll, intervalMs)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [intervalMs])
  return state
}
