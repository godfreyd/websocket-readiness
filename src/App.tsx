import { useState } from 'react'
import { LogPanel } from './components/LogPanel'
import { RequestsPanel } from './components/RequestsPanel'
import { RunsTable } from './components/RunsTable'
import { StatusPanel } from './components/StatusPanel'
import { StormPanel } from './components/StormPanel'
import { useDemoClient } from './hooks/useDemoClient'
import { useFaultRuns } from './hooks/useFaultRuns'
import { useNow, useServer } from './hooks/useServer'
import { STAGES, type StageId } from './lib/client/stages'
import type { Fault } from './shared/protocol'

type Tab = 'live' | 'storm'

const FAULTS: Array<{ fault: Fault; title: string; hint: string }> = [
  { fault: 'normal', title: 'Normal', hint: 'Everything works.' },
  { fault: 'frozen', title: 'Freeze', hint: 'TCP stays open, nothing is read or written.' },
  { fault: 'service-down', title: 'Service down', hint: 'Heartbeat is fine, the service behind it is gone.' },
  { fault: 'slow-replies', title: 'Slow replies', hint: 'Responses take 8 s.' },
  { fault: 'flapping', title: 'Flapping', hint: 'Connections are dropped after 300 ms.' },
  { fault: 'restart', title: 'Restart', hint: 'All connections die, 3 s of refusals, then normal.' },
]

// The stage lives in the URL, so the article can link to a specific one.
function readInitialStage(): StageId {
  const stage = Number(new URLSearchParams(location.search).get('stage'))
  return (STAGES.some((item) => item.id === stage) ? stage : 0) as StageId
}

export default function App() {
  const [stageId, setStageId] = useState<StageId>(readInitialStage)
  const [tab, setTab] = useState<Tab>('live')
  const [autoRequests, setAutoRequests] = useState(true)
  const stage = STAGES[stageId]

  const now = useNow(250)
  const { state: server, setFault } = useServer()
  const { status, log, requests, lastFeed, sendRequest } = useDemoClient(stage, autoRequests)
  const { runs, startRun, endRun } = useFaultRuns(stageId, status?.ready ?? false, server, requests)

  const changeStage = (next: StageId) => {
    setStageId(next)
    history.replaceState(null, '', `?stage=${next}`)
    void setFault('normal')
  }

  const applyFault = (fault: Fault) => {
    if (fault === 'normal') endRun()
    else startRun(fault)
    void setFault(fault)
  }

  return (
    <div className="flex h-full flex-col bg-slate-50 text-slate-900 lg:flex-row">
      <aside className="w-full shrink-0 space-y-5 overflow-y-auto border-slate-200 bg-white p-4 lg:w-[420px] lg:border-r">
        <div>
          <h1 className="text-lg font-semibold">WebSocket is open, the app doesn’t work</h1>
          <p className="mt-1 text-sm text-slate-600">
            Pick a stage, break the server, and compare what the client says with what is really happening.
          </p>
        </div>

        <section className="space-y-2">
          <div className="text-xs font-medium text-slate-500 uppercase">Stage</div>
          <div className="space-y-1">
            {STAGES.map((item) => (
              <button
                key={item.id}
                onClick={() => changeStage(item.id)}
                className={`flex w-full items-center justify-between gap-2 rounded border px-3 py-2 text-left text-sm ${
                  stageId === item.id ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300 hover:bg-slate-100'
                }`}
              >
                <span>
                  {item.id}. {item.title}
                </span>
                <span className={`text-xs ${stageId === item.id ? 'text-sky-100' : 'text-slate-500'}`}>
                  {item.fixes}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <div className="text-xs font-medium text-slate-500 uppercase">Server</div>
          <div className="space-y-1">
            {FAULTS.map((item) => (
              <button
                key={item.fault}
                onClick={() => applyFault(item.fault)}
                className={`w-full rounded border px-3 py-1.5 text-left text-sm ${
                  server?.fault === item.fault
                    ? 'border-slate-800 bg-slate-800 text-white'
                    : 'border-slate-300 hover:bg-slate-100'
                }`}
              >
                <span className="font-medium">{item.title}</span>
                <span className={`ml-2 text-xs ${server?.fault === item.fault ? 'text-slate-300' : 'text-slate-500'}`}>
                  {item.hint}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2">
          <div className="text-xs font-medium text-slate-500 uppercase">Measurements</div>
          <RunsTable runs={runs} />
        </section>
      </aside>

      <main className="flex min-h-0 flex-1 flex-col">
        <nav className="flex gap-1 border-b border-slate-200 bg-white px-4 pt-3">
          {(
            [
              ['live', 'Live connection'],
              ['storm', 'Reconnect storm'],
            ] as const
          ).map(([value, title]) => (
            <button
              key={value}
              onClick={() => setTab(value)}
              className={`rounded-t border-b-2 px-3 py-1.5 text-sm ${
                tab === value ? 'border-sky-600 font-medium text-sky-700' : 'border-transparent text-slate-600'
              }`}
            >
              {title}
            </button>
          ))}
        </nav>

        {tab === 'live' ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
            <StatusPanel status={status} server={server} lastFeed={lastFeed} now={now} />
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-2">
              <RequestsPanel
                requests={requests}
                now={now}
                autoRequests={autoRequests}
                onAutoRequestsChange={setAutoRequests}
                onSend={sendRequest}
              />
              <LogPanel log={log} />
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <StormPanel />
          </div>
        )}
      </main>
    </div>
  )
}
