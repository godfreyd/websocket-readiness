// Reconnect delay policies. Pure and clock-free, so the real client (stage 5) and
// the fleet simulator (lib/fleet.ts) run exactly the same logic.

export interface BackoffPolicy {
  // The delay before the next attempt. Each call counts as one more attempt.
  nextDelay(random: () => number): number
  reset(): void
}

// Every client waits the same second. After a restart, they all come back together.
export function fixedDelay(delayMs: number): BackoffPolicy {
  return { nextDelay: () => delayMs, reset: () => {} }
}

// Exponential growth, no randomness: clients that dropped together keep
// retrying together, just less and less often.
export function exponential(baseMs: number, capMs: number): BackoffPolicy {
  let attempt = 0
  return {
    nextDelay() {
      const delay = Math.min(capMs, baseMs * 2 ** attempt)
      attempt++
      return delay
    },
    reset() {
      attempt = 0
    },
  }
}

// A random first delay, then a constant step per failure. The first
// attempt is spread out, but the growth is slow and has no ceiling.
export function linearWithRandomStart(maxStartMs: number, stepMs: number): BackoffPolicy {
  let delay: number | null = null
  return {
    nextDelay(random) {
      delay = delay === null ? random() * maxStartMs : delay + stepMs
      return delay
    },
    reset() {
      delay = null
    },
  }
}

// "Full jitter": a uniform random delay up to the exponential ceiling. Each
// attempt is spread over the whole window, so synchronized clients fall apart.
export function exponentialFullJitter(baseMs: number, capMs: number): BackoffPolicy {
  let attempt = 0
  return {
    nextDelay(random) {
      const ceiling = Math.min(capMs, baseMs * 2 ** attempt)
      attempt++
      return random() * ceiling
    },
    reset() {
      attempt = 0
    },
  }
}
