import { useCallback, useEffect, useRef, useState } from 'react'
import type { Stage } from '../lib/client/stages'
import type { ClientStatus, ConnectionClient, LogKind } from '../lib/client/types'

export interface LogEntry {
  id: number
  at: number
  kind: LogKind
  text: string
}

export interface RequestEntry {
  id: number
  startedAt: number
  finishedAt: number | null
  outcome: 'pending' | 'ok' | 'failed'
  detail: string
}

const MAX_LOG = 200
const MAX_REQUESTS = 300
export const AUTO_REQUEST_INTERVAL_MS = 2000

function socketUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${location.host}/ws`
}

// Runs the client of the selected stage and collects everything the UI shows.
// A new stage gets a new client and a clean slate.
export function useDemoClient(stage: Stage, autoRequests: boolean) {
  const [status, setStatus] = useState<ClientStatus | null>(null)
  const [log, setLog] = useState<LogEntry[]>([])
  const [requests, setRequests] = useState<RequestEntry[]>([])
  const [lastFeed, setLastFeed] = useState<{ seq: number; text: string; at: number } | null>(null)
  const clientRef = useRef<ConnectionClient | null>(null)
  const nextId = useRef(1)

  const [previousStage, setPreviousStage] = useState(stage)
  if (stage !== previousStage) {
    setPreviousStage(stage)
    setLog([])
    setRequests([])
    setLastFeed(null)
  }

  useEffect(() => {
    const client = stage.create({
      url: socketUrl(),
      hooks: {
        onStatus: setStatus,
        onFeed: (seq, text) => setLastFeed({ seq, text, at: Date.now() }),
        onLog: (kind, text) => {
          const entry = { id: nextId.current++, at: Date.now(), kind, text }
          setLog((previous) => [entry, ...previous].slice(0, MAX_LOG))
        },
      },
    })
    clientRef.current = client
    client.start()

    return () => {
      clientRef.current = null
      client.stop()
    }
  }, [stage])

  const sendRequest = useCallback(() => {
    const client = clientRef.current
    if (!client) return

    const id = nextId.current++
    const startedAt = Date.now()
    setRequests((previous) =>
      [{ id, startedAt, finishedAt: null, outcome: 'pending' as const, detail: '' }, ...previous].slice(
        0,
        MAX_REQUESTS,
      ),
    )

    const finish = (outcome: RequestEntry['outcome'], detail: string) => {
      setRequests((previous) =>
        previous.map((entry) => (entry.id === id ? { ...entry, finishedAt: Date.now(), outcome, detail } : entry)),
      )
    }

    client.request('echo', { id }).then(
      () => finish('ok', ''),
      (error: Error) => finish('failed', `${error.name}: ${error.message}`),
    )
  }, [])

  useEffect(() => {
    if (!autoRequests) return
    const timer = setInterval(sendRequest, AUTO_REQUEST_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [autoRequests, sendRequest, stage])

  return { status, log, requests, lastFeed, sendRequest }
}
