import type { BackoffPolicy } from './backoff'

// A virtual-time simulation of many clients reconnecting. Reconnect storms need
// thousands of clients, more than a browser tab can open, but the delay logic
// is the same code the real client runs.

const TICK_MS = 100

// A small seeded PRNG (mulberry32): the same seed gives the same chart.
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface RestartScenario {
  clients: number
  downtimeMs: number
  // How many connections per second the server can accept once it's back.
  capacityPerSecond: number
  durationMs: number
}

export interface RestartResult {
  attemptsPerSecond: number[]
  // The peak once the server is back. The very first second looks similar for
  // every policy, because all clients make their first attempt right after the drop.
  peakAfterRecoveryPerSecond: number
  totalAttempts: number
  // When the last client got connected, or null if some never did.
  recoveredAtMs: number | null
}

// All clients lose the connection at t = 0. The server refuses everything during
// the downtime and then accepts up to capacityPerSecond. Failed clients ask their
// policy for the next delay, exactly as after a real failed attempt.
export function simulateRestart(
  createPolicy: () => BackoffPolicy,
  scenario: RestartScenario,
  random: () => number,
): RestartResult {
  const ticks = Math.ceil(scenario.durationMs / TICK_MS)
  const wheel: number[][] = Array.from({ length: ticks }, () => [])
  const policies = Array.from({ length: scenario.clients }, createPolicy)
  const capacityPerTick = scenario.capacityPerSecond / (1000 / TICK_MS)

  const schedule = (client: number, fromTick: number) => {
    const delayTicks = Math.max(Math.round(policies[client].nextDelay(random) / TICK_MS), 1)
    const tick = fromTick + delayTicks
    if (tick < ticks) wheel[tick].push(client)
  }

  for (let client = 0; client < scenario.clients; client++) schedule(client, 0)

  const attemptsPerSecond = new Array<number>(Math.ceil(scenario.durationMs / 1000)).fill(0)
  let totalAttempts = 0
  let connected = 0
  let recoveredAtMs: number | null = null
  let budget = 0

  for (let tick = 0; tick < ticks; tick++) {
    const now = tick * TICK_MS
    const up = now >= scenario.downtimeMs
    budget = up ? budget + capacityPerTick : 0

    for (const client of wheel[tick]) {
      totalAttempts++
      attemptsPerSecond[Math.floor(now / 1000)]++

      if (budget >= 1) {
        budget--
        connected++
        if (connected === scenario.clients) recoveredAtMs = now
      } else {
        schedule(client, tick)
      }
    }

    // Unused capacity doesn't accumulate beyond one second's worth.
    budget = Math.min(budget, scenario.capacityPerSecond)
  }

  return {
    attemptsPerSecond,
    peakAfterRecoveryPerSecond: Math.max(...attemptsPerSecond.slice(Math.ceil(scenario.downtimeMs / 1000))),
    totalAttempts,
    recoveredAtMs,
  }
}

export interface FlappingScenario {
  // How long each connection survives before the server drops it.
  lifetimeMs: number
  durationMs: number
  // 'open' resets the backoff on every successful connection;
  // 'cooldown' only after the connection has lived for cooldownMs.
  resetOn: 'open' | 'cooldown'
  cooldownMs: number
}

// One client against a server that accepts and drops every connection.
// Returns the number of connections it makes during the scenario.
export function simulateFlapping(
  policy: BackoffPolicy,
  scenario: FlappingScenario,
  random: () => number,
): number {
  let now = 0
  let attempts = 0

  for (;;) {
    now += policy.nextDelay(random)
    if (now >= scenario.durationMs) return attempts

    attempts++
    if (scenario.resetOn === 'open' || scenario.lifetimeMs >= scenario.cooldownMs) policy.reset()
    now += scenario.lifetimeMs
  }
}
