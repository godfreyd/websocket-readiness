import { useCallback, useEffect, useState } from 'react'
import type { Fault, ServerState } from '../shared/protocol'

const POLL_INTERVAL_MS = 250

// The demo server's own view of the world: the ground truth to compare the client with.
export function useServer() {
  const [state, setState] = useState<ServerState | null>(null)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const response = await fetch('/__demo/state')
        const next = (await response.json()) as ServerState
        if (!cancelled) setState(next)
      } catch {
        // The dev server is being restarted; the next poll will try again.
      }
    }

    void poll()
    const timer = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const setFault = useCallback(async (fault: Fault) => {
    const response = await fetch('/__demo/fault', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fault }),
    })
    setState((await response.json()) as ServerState)
  }, [])

  return { state, setFault }
}

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
