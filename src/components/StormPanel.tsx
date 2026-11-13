import { useMemo, useState } from 'react'
import {
  exponential,
  exponentialFullJitter,
  fixedDelay,
  linearWithRandomStart,
  type BackoffPolicy,
} from '../lib/backoff'
import { seededRandom, simulateFlapping, simulateRestart, type RestartResult } from '../lib/fleet'

const SCENARIO = { clients: 10_000, downtimeMs: 10_000, capacityPerSecond: 500, durationMs: 90_000 }
const FLAPPING = { lifetimeMs: 300, durationMs: 60_000, cooldownMs: 5000 }
const SEED = 42

const POLICIES: Array<{ title: string; create(): BackoffPolicy }> = [
  { title: 'Fixed 1 s', create: () => fixedDelay(1000) },
  { title: 'Exponential 1–30 s, no jitter', create: () => exponential(1000, 30_000) },
  { title: 'Random start, +1 s per failure', create: () => linearWithRandomStart(1000, 1000) },
  { title: 'Exponential 1–30 s, full jitter', create: () => exponentialFullJitter(1000, 30_000) },
]

const CHART_HEIGHT = 80
const BAR_STEP = 7
const BAR_WIDTH = 5

// One series per chart and one shared y-scale, so the charts compare directly.
function AttemptsChart({ result, maxValue }: { result: RestartResult; maxValue: number }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const data = result.attemptsPerSecond
  const width = data.length * BAR_STEP
  const capacityY = CHART_HEIGHT - (SCENARIO.capacityPerSecond / maxValue) * CHART_HEIGHT

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${CHART_HEIGHT + 1}`}
        className="h-24 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label="Connection attempts per second"
        onMouseLeave={() => setHovered(null)}
      >
        {data.map((value, second) => {
          const height = value === 0 ? 0 : Math.max((value / maxValue) * CHART_HEIGHT, 1)
          return (
            <g key={second} onMouseEnter={() => setHovered(second)}>
              <rect x={second * BAR_STEP} y={0} width={BAR_STEP} height={CHART_HEIGHT} fill="transparent" />
              <rect
                x={second * BAR_STEP + 1}
                y={CHART_HEIGHT - height}
                width={BAR_WIDTH}
                height={height}
                rx={1}
                fill="#2a78d6"
                opacity={hovered === null || hovered === second ? 1 : 0.5}
              />
            </g>
          )
        })}
        <line x1={0} x2={width} y1={CHART_HEIGHT} y2={CHART_HEIGHT} stroke="#cbd5e1" />
        <line
          x1={0}
          x2={width}
          y1={capacityY}
          y2={capacityY}
          stroke="#52514e"
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-1 flex justify-between text-xs text-slate-500 tabular-nums">
        <span>0 s</span>
        <span>peak {Math.max(...data).toLocaleString('en-US')} per second</span>
        <span>{data.length} s</span>
      </div>
      {hovered !== null && (
        <div className="pointer-events-none absolute top-0 right-0 rounded bg-slate-800 px-2 py-1 text-xs text-white tabular-nums">
          {hovered}–{hovered + 1} s: {data[hovered].toLocaleString('en-US')} attempts
        </div>
      )}
    </div>
  )
}

const formatRecovery = (ms: number | null) => (ms === null ? 'not within 90 s' : `${(ms / 1000).toFixed(0)} s`)

export function StormPanel() {
  const restart = useMemo(
    () =>
      POLICIES.map((policy) => ({
        title: policy.title,
        result: simulateRestart(policy.create, SCENARIO, seededRandom(SEED)),
      })),
    [],
  )

  const flapping = useMemo(() => {
    const onOpen = (create: () => BackoffPolicy) =>
      simulateFlapping(create(), { ...FLAPPING, resetOn: 'open' }, seededRandom(SEED))
    const onCooldown = (create: () => BackoffPolicy) =>
      simulateFlapping(create(), { ...FLAPPING, resetOn: 'cooldown' }, seededRandom(SEED))

    return POLICIES.slice(1).map((policy) => ({
      title: policy.title,
      resetOnOpen: onOpen(policy.create),
      resetOnCooldown: onCooldown(policy.create),
    }))
  }, [])

  const maxValue = Math.max(...restart.flatMap(({ result }) => result.attemptsPerSecond))

  return (
    <div className="space-y-6 p-4">
      <section className="space-y-3">
        <div>
          <h2 className="font-medium">Server restart: connection attempts per second</h2>
          <p className="text-sm text-slate-600">
            {SCENARIO.clients.toLocaleString('en-US')} clients drop at 0 s. The server is down for{' '}
            {SCENARIO.downtimeMs / 1000} s, then accepts {SCENARIO.capacityPerSecond} connections per second (dashed
            line). Simulated in virtual time with the same backoff code as stage 5. All charts share one scale, 0–
            {SCENARIO.durationMs / 1000} s.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {restart.map(({ title, result }) => (
            <div key={title} className="rounded border border-slate-200 bg-white p-3">
              <div className="mb-2 text-sm font-medium">{title}</div>
              <AttemptsChart result={result} maxValue={maxValue} />
            </div>
          ))}
        </div>
        <table className="w-full max-w-3xl text-left text-sm tabular-nums" data-testid="storm-table">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="font-normal">policy</th>
              <th className="font-normal">peak after the server is back, /s</th>
              <th className="font-normal">total attempts</th>
              <th className="font-normal">everyone connected at</th>
            </tr>
          </thead>
          <tbody>
            {restart.map(({ title, result }) => (
              <tr key={title} className="border-t border-slate-200">
                <td className="py-1">{title}</td>
                <td>{result.peakAfterRecoveryPerSecond.toLocaleString('en-US')}</td>
                <td>{result.totalAttempts.toLocaleString('en-US')}</td>
                <td>{formatRecovery(result.recoveredAtMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="font-medium">Flapping server: connections per client per minute</h2>
          <p className="text-sm text-slate-600">
            The server accepts every connection and drops it after {FLAPPING.lifetimeMs} ms. Resetting the backoff on
            every open defeats it; a {FLAPPING.cooldownMs / 1000} s cooldown preserves it.
          </p>
        </div>
        <table className="w-full max-w-3xl text-left text-sm tabular-nums" data-testid="flapping-table">
          <thead className="text-xs text-slate-500">
            <tr>
              <th className="font-normal">policy</th>
              <th className="font-normal">reset on open</th>
              <th className="font-normal">reset after cooldown</th>
            </tr>
          </thead>
          <tbody>
            {flapping.map((row) => (
              <tr key={row.title} className="border-t border-slate-200">
                <td className="py-1">{row.title}</td>
                <td>{row.resetOnOpen}</td>
                <td>{row.resetOnCooldown}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
