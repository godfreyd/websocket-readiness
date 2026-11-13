import { exponentialFullJitter, type BackoffPolicy } from '../backoff'
import { ServiceReadinessClient } from './stage4ServiceReadiness'
import type { ClientOptions, Levels } from './types'

export const BACKOFF_BASE_MS = 1000
export const BACKOFF_CAP_MS = 30_000
export const COOLDOWN_MS = 5000

export const CLOSE_BACK_ONLINE = 4001

export interface ReconnectPolicyOptions extends ClientOptions {
  backoff?: BackoffPolicy
  random?(): number
}

// Stage 5. Reconnecting is a load problem, not just a retry loop:
//   - jitter spreads out clients that lost the connection at the same moment;
//   - exponential growth with a ceiling stops hammering a server that's down;
//   - the backoff resets only after the connection has been ready for a whole
//     cooldown. Otherwise a flapping server resets it on every brief success;
//   - while the device is offline, attempts are pointless and don't count.
export class ReconnectPolicyClient extends ServiceReadinessClient {
  private readonly backoff: BackoffPolicy
  private readonly random: () => number
  private cooldownTimer: ReturnType<typeof setTimeout> | undefined
  private offline = false

  constructor(options: ReconnectPolicyOptions) {
    super(options)
    this.backoff = options.backoff ?? exponentialFullJitter(BACKOFF_BASE_MS, BACKOFF_CAP_MS)
    this.random = options.random ?? Math.random
  }

  override start(): void {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline)
      window.addEventListener('offline', this.handleOffline)
    }
    super.start()
  }

  override stop(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline)
      window.removeEventListener('offline', this.handleOffline)
    }
    clearTimeout(this.cooldownTimer)
    this.cooldownTimer = undefined
    super.stop()
  }

  protected override nextReconnectDelay(): number {
    return this.backoff.nextDelay(this.random)
  }

  protected override scheduleReconnect(): void {
    if (this.offline) {
      this.log('info', 'Device is offline, waiting for the network')
      return
    }
    super.scheduleReconnect()
  }

  protected override setLevels(levels: Partial<Levels>): void {
    super.setLevels(levels)

    if (!this.isReady()) {
      clearTimeout(this.cooldownTimer)
      this.cooldownTimer = undefined
    } else if (this.cooldownTimer === undefined) {
      this.cooldownTimer = setTimeout(() => {
        this.backoff.reset()
        this.log('info', `Stable for ${COOLDOWN_MS} ms, backoff reset`)
      }, COOLDOWN_MS)
    }
  }

  private readonly handleOffline = () => {
    this.offline = true
    this.clearReconnectTimers()
  }

  // The network is back, so this attempt doesn't have to wait for its backoff.
  private readonly handleOnline = () => {
    this.offline = false
    this.backoff.reset()
    this.clearReconnectTimers()
    this.forceReconnect(CLOSE_BACK_ONLINE, 'network changed')
  }

}
