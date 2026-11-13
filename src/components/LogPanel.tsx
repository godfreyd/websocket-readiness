import type { LogEntry } from '../hooks/useDemoClient'
import type { LogKind } from '../lib/client/types'

const KIND_STYLE: Record<LogKind, string> = {
  info: 'text-slate-600',
  warn: 'text-amber-700',
  error: 'text-red-700',
}

const formatTime = (at: number) => new Date(at).toLocaleTimeString('en-GB')

export function LogPanel({ log }: { log: LogEntry[] }) {
  return (
    <section className="flex min-h-0 flex-col rounded border border-slate-200 bg-white">
      <h2 className="border-b border-slate-200 p-3 font-medium">Client log</h2>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2 text-xs" data-testid="client-log">
        {log.map((entry) => (
          <li key={entry.id} className={`flex gap-2 py-0.5 ${KIND_STYLE[entry.kind]}`}>
            <span className="shrink-0 tabular-nums text-slate-400">{formatTime(entry.at)}</span>
            <span>{entry.text}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
