import type { RequestEntry } from '../hooks/useDemoClient'

const OUTCOME_STYLE: Record<RequestEntry['outcome'], string> = {
  pending: 'text-amber-700',
  ok: 'text-emerald-700',
  failed: 'text-red-700',
}

interface RequestsPanelProps {
  requests: RequestEntry[]
  now: number
  autoRequests: boolean
  onAutoRequestsChange(value: boolean): void
  onSend(): void
}

export function RequestsPanel({ requests, now, autoRequests, onAutoRequestsChange, onSend }: RequestsPanelProps) {
  const pending = requests.filter((request) => request.outcome === 'pending').length
  const failed = requests.filter((request) => request.outcome === 'failed').length
  const ok = requests.filter((request) => request.outcome === 'ok').length

  return (
    <section className="flex min-h-0 flex-col rounded border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-3">
        <h2 className="font-medium">Requests</h2>
        <button onClick={onSend} className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-100">
          Send request
        </button>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={autoRequests}
            onChange={(event) => onAutoRequestsChange(event.target.checked)}
          />
          Every 2 s
        </label>
        <div className="ml-auto text-sm tabular-nums" data-testid="request-counts">
          {ok} ok · {failed} failed · {pending} pending
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2 text-xs">
        {requests.slice(0, 50).map((request) => (
          <li key={request.id} className="flex gap-2 py-0.5">
            <span className={`w-14 shrink-0 font-medium ${OUTCOME_STYLE[request.outcome]}`}>{request.outcome}</span>
            <span className="w-14 shrink-0 text-right tabular-nums">
              {(((request.finishedAt ?? now) - request.startedAt) / 1000).toFixed(1)} s
            </span>
            <span className="truncate text-slate-600">{request.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
