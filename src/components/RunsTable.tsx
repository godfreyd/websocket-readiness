import type { FaultRun } from '../hooks/useFaultRuns'

const formatDuration = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)} s`)

export function RunsTable({ runs }: { runs: FaultRun[] }) {
  if (runs.length === 0) {
    return <p className="text-sm text-slate-500">Inject a fault, then press Normal. Each attempt adds a row here.</p>
  }

  return (
    <table className="w-full text-left text-xs tabular-nums [&_td]:pr-2 [&_th]:pr-2" data-testid="runs">
      <thead className="text-slate-500">
        <tr>
          <th className="font-normal">stage</th>
          <th className="font-normal">fault</th>
          <th className="font-normal">noticed</th>
          <th className="font-normal">back</th>
          <th className="font-normal">conn. tries</th>
          <th className="font-normal">peak open</th>
          <th className="font-normal">failed / hung</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.id} className="border-t border-slate-200">
            <td>{run.stage}</td>
            <td>{run.fault}</td>
            <td>{run.detectedMs === null ? 'never' : formatDuration(run.detectedMs)}</td>
            <td>{formatDuration(run.recoveredMs)}</td>
            <td>{run.attempts}</td>
            <td>{run.peakConnections}</td>
            <td>
              {run.failedRequests} / {run.pendingRequests}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
