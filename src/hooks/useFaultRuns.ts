import { useCallback, useEffect, useRef, useState } from 'react'
import type { StageId } from '../lib/client/stages'
import type { Fault, ServerState } from '../shared/protocol'
import type { RequestEntry } from './useDemoClient'

export interface FaultRun {
  id: number
  stage: StageId
  fault: Fault
  // From the fault until the client admits it isn't ready. Null: it never did.
  detectedMs: number | null
  // From the fault being over until the client is ready again.
  // Null: not yet, or the client never noticed the fault in the first place.
  recoveredMs: number | null
  attempts: number
  peakConnections: number
  failedRequests: number
  pendingRequests: number
}

interface ActiveRun {
  startedAt: number
  endedAt: number | null
  // The poll can still report the state from before the fault was injected.
  serverSawFault: boolean
  attemptsAtStart: number
  requestsBefore: Set<number>
  run: FaultRun
}

const MAX_RUNS = 30

// Turns "inject a fault, then end it" into one row of measurements.
export function useFaultRuns(
  stage: StageId,
  ready: boolean,
  server: ServerState | null,
  requests: RequestEntry[],
) {
  const [runs, setRuns] = useState<FaultRun[]>([])
  const active = useRef<ActiveRun | null>(null)
  const nextId = useRef(1)

  const publish = useCallback((run: FaultRun) => {
    setRuns((previous) =>
      previous.some((item) => item.id === run.id)
        ? previous.map((item) => (item.id === run.id ? run : item))
        : [run, ...previous].slice(0, MAX_RUNS),
    )
  }, [])

  const update = useCallback(
    (patch: Partial<FaultRun>) => {
      if (!active.current) return
      active.current.run = { ...active.current.run, ...patch }
      publish(active.current.run)
    },
    [publish],
  )

  const startRun = useCallback(
    (fault: Fault) => {
      active.current = {
        startedAt: Date.now(),
        endedAt: null,
        serverSawFault: false,
        attemptsAtStart: server?.totalAttempts ?? 0,
        requestsBefore: new Set(requests.map((request) => request.id)),
        run: {
          id: nextId.current++,
          stage,
          fault,
          detectedMs: null,
          recoveredMs: null,
          attempts: 0,
          peakConnections: 0,
          failedRequests: 0,
          pendingRequests: 0,
        },
      }
      publish(active.current.run)
    },
    [publish, requests, server, stage],
  )

  const endRun = useCallback(() => {
    if (active.current && active.current.endedAt === null) active.current.endedAt = Date.now()
  }, [])

  // A stage switch ends the measurement: the new client has nothing to do with it.
  useEffect(() => {
    active.current = null
  }, [stage])

  useEffect(() => {
    const current = active.current
    if (!current) return

    if (!ready && current.run.detectedMs === null) {
      update({ detectedMs: Date.now() - current.startedAt })
    }
    if (ready && current.endedAt !== null && current.run.detectedMs !== null && current.run.recoveredMs === null) {
      update({ recoveredMs: Date.now() - current.endedAt })
    }
  }, [ready, update])

  useEffect(() => {
    const current = active.current
    if (!current || !server) return

    if (server.fault === current.run.fault) current.serverSawFault = true
    // A restart ends by itself on the server side.
    if (server.fault === 'normal' && current.serverSawFault) endRun()

    update({
      attempts: server.totalAttempts - current.attemptsAtStart,
      peakConnections: Math.max(current.run.peakConnections, server.connections),
    })
    if (ready && current.endedAt !== null && current.run.detectedMs !== null && current.run.recoveredMs === null) {
      update({ recoveredMs: Date.now() - current.endedAt })
    }
  }, [server, ready, endRun, update])

  useEffect(() => {
    const current = active.current
    if (!current) return

    const during = requests.filter((request) => !current.requestsBefore.has(request.id))
    update({
      failedRequests: during.filter((request) => request.outcome === 'failed').length,
      pendingRequests: during.filter((request) => request.outcome === 'pending').length,
    })
  }, [requests, update])

  return { runs, startRun, endRun }
}
