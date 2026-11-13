import type { ClientStatus, LevelState } from '../lib/client/types'
import type { ServerState } from '../shared/protocol'

const LEVEL_STYLE: Record<LevelState, { dot: string; label: string }> = {
  untracked: { dot: 'bg-slate-300', label: 'not tracked' },
  down: { dot: 'bg-red-500', label: 'down' },
  pending: { dot: 'bg-amber-500', label: 'pending' },
  up: { dot: 'bg-emerald-500', label: 'up' },
}

function Level({ title, hint, state }: { title: string; hint: string; state: LevelState }) {
  const style = LEVEL_STYLE[state]
  return (
    <div className="flex-1 rounded border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-2">
        <span className={`h-3 w-3 rounded-full ${style.dot}`} />
        <span className="font-medium">{title}</span>
      </div>
      <div className="mt-1 text-sm">{style.label}</div>
      <div className="text-xs text-slate-500">{hint}</div>
    </div>
  )
}

// A feed message arrives every second, so a few seconds of silence is a clear signal.
const FEED_SILENCE_MS = 3000

interface StatusPanelProps {
  status: ClientStatus | null
  server: ServerState | null
  lastFeed: { seq: number; text: string; at: number } | null
  now: number
}

export function StatusPanel({ status, server, lastFeed, now }: StatusPanelProps) {
  const feedAge = lastFeed ? Math.max(now - lastFeed.at, 0) : null
  const silent = feedAge === null || feedAge > FEED_SILENCE_MS
  const ready = status?.ready ?? false
  const lying = ready && silent

  return (
    <section className="space-y-3">
      <div
        data-testid="belief"
        className={`rounded p-4 ${
          lying ? 'bg-amber-100 text-amber-900' : ready ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-900'
        }`}
      >
        <div className="text-2xl font-semibold">{ready ? 'Client says: READY' : 'Client says: NOT READY'}</div>
        <div className="mt-1 text-sm">
          {lying
            ? 'But nothing is arriving: the status is wrong.'
            : ready
              ? 'Updates are arriving, the status is right.'
              : 'The client knows it can’t work right now.'}
        </div>
      </div>

      {status && (
        <div className="flex gap-3">
          <Level title="Transport" hint="Is the WebSocket open?" state={status.transport} />
          <Level title="Protocol" hint="Is the peer alive?" state={status.protocol} />
          <Level title="Service" hint="Is the subscription confirmed?" state={status.service} />
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div className="rounded border border-slate-200 bg-white p-3">
          <div className="text-xs text-slate-500">Last update</div>
          <div className="tabular-nums">
            {lastFeed ? `${lastFeed.text}, ${((feedAge ?? 0) / 1000).toFixed(1)} s ago` : 'none yet'}
          </div>
        </div>
        <div className="rounded border border-slate-200 bg-white p-3">
          <div className="text-xs text-slate-500">Server fault</div>
          <div data-testid="server-fault">{server?.fault ?? '—'}</div>
        </div>
        <div className="rounded border border-slate-200 bg-white p-3">
          <div className="text-xs text-slate-500">Open connections on the server</div>
          <div className="tabular-nums" data-testid="server-connections">
            {server?.connections ?? '—'}
          </div>
        </div>
      </div>
    </section>
  )
}
