import { describe, expect, it } from 'vitest'
import { exponential, exponentialFullJitter, fixedDelay, linearWithRandomStart } from './backoff'
import { seededRandom, simulateFlapping, simulateRestart } from './fleet'

const always = (value: number) => () => value

describe('backoff policies', () => {
  it('fixed delay never changes', () => {
    const policy = fixedDelay(1000)
    expect([1, 2, 3].map(() => policy.nextDelay(always(0.5)))).toEqual([1000, 1000, 1000])
  })

  it('exponential doubles up to the cap and restarts after reset', () => {
    const policy = exponential(1000, 5000)
    expect([1, 2, 3, 4].map(() => policy.nextDelay(always(0.5)))).toEqual([1000, 2000, 4000, 5000])
    policy.reset()
    expect(policy.nextDelay(always(0.5))).toBe(1000)
  })

  it('full jitter stays within the exponential ceiling', () => {
    const policy = exponentialFullJitter(1000, 5000)
    expect([1, 2, 3, 4].map(() => policy.nextDelay(always(0.5)))).toEqual([500, 1000, 2000, 2500])
    expect(exponentialFullJitter(1000, 5000).nextDelay(always(0))).toBe(0)
  })

  it('linear starts at a random point and grows by a constant step', () => {
    const policy = linearWithRandomStart(1000, 500)
    expect([1, 2, 3].map(() => policy.nextDelay(always(0.2)))).toEqual([200, 700, 1200])
  })
})

describe('simulateRestart', () => {
  const scenario = { clients: 2000, downtimeMs: 5000, capacityPerSecond: 200, durationMs: 120_000 }

  it('connects every client with a jittered policy', () => {
    const result = simulateRestart(() => exponentialFullJitter(1000, 30_000), scenario, seededRandom(1))
    expect(result.recoveredAtMs).not.toBeNull()
    expect(result.totalAttempts).toBeGreaterThanOrEqual(scenario.clients)
  })

  it('jitter reduces the load once the server is back', () => {
    const fixed = simulateRestart(() => fixedDelay(1000), scenario, seededRandom(1))
    const jittered = simulateRestart(() => exponentialFullJitter(1000, 30_000), scenario, seededRandom(1))
    expect(fixed.peakAfterRecoveryPerSecond).toBe(scenario.clients)
    expect(jittered.peakAfterRecoveryPerSecond).toBeLessThan(fixed.peakAfterRecoveryPerSecond / 2)
  })

  it('is reproducible with the same seed', () => {
    const run = () => simulateRestart(() => exponentialFullJitter(1000, 30_000), scenario, seededRandom(7))
    expect(run()).toEqual(run())
  })

  it('never accepts more than the capacity per second', () => {
    const result = simulateRestart(() => fixedDelay(1000), { ...scenario, durationMs: 40_000 }, seededRandom(1))
    expect(result.recoveredAtMs).toBeGreaterThanOrEqual(scenario.downtimeMs + 9000)
  })
})

describe('simulateFlapping', () => {
  const scenario = { lifetimeMs: 300, durationMs: 60_000, cooldownMs: 5000 }

  it('a reset on every open defeats the backoff, the cooldown preserves it', () => {
    const onOpen = simulateFlapping(exponential(1000, 30_000), { ...scenario, resetOn: 'open' }, seededRandom(1))
    const onCooldown = simulateFlapping(exponential(1000, 30_000), { ...scenario, resetOn: 'cooldown' }, seededRandom(1))
    expect(onOpen).toBeGreaterThan(40)
    expect(onCooldown).toBeLessThan(10)
  })
})
