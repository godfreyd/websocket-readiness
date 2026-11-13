import { FEED_SERVICE, type ServerMessage } from '../../shared/protocol'
import { StaleEventsClient } from './stage3StaleEvents'
import type { ClientOptions } from './types'

export const SUBSCRIBE_TIMEOUT_MS = 2000

// Stage 4. A live peer isn't a working service: a gateway can answer pings while
// the backend behind it is down. So there is a third level, with its own status:
//   - a subscription counts only after the server has acknowledged it;
//   - without an acknowledgement we keep asking, over the same healthy socket;
//   - losing a subscription doesn't touch the connection, we just subscribe again.
export class ServiceReadinessClient extends StaleEventsClient {
  private subscribeTimer: ReturnType<typeof setTimeout> | undefined

  constructor(options: ClientOptions) {
    super(options)
    this.levels = { ...this.levels, service: 'down' }
  }

  override stop(): void {
    clearTimeout(this.subscribeTimer)
    super.stop()
  }

  protected override isReady(): boolean {
    return super.isReady() && this.levels.service === 'up'
  }

  protected override subscribeToFeed(): void {
    this.setLevels({ service: 'pending' })
    super.subscribeToFeed()

    clearTimeout(this.subscribeTimer)
    this.subscribeTimer = setTimeout(() => {
      this.log('warn', `No subscription ack in ${SUBSCRIBE_TIMEOUT_MS} ms, asking again`)
      this.subscribeToFeed()
    }, SUBSCRIBE_TIMEOUT_MS)
  }

  protected override handleMessage(message: ServerMessage): void {
    if (message.type === 'subscribed' && message.service === FEED_SERVICE) {
      clearTimeout(this.subscribeTimer)
      this.log('info', 'Subscription confirmed')
      this.setLevels({ service: 'up' })
    } else if (message.type === 'unsubscribed' && message.service === FEED_SERVICE) {
      this.log('warn', 'Subscription lost')
      this.subscribeToFeed()
    } else {
      super.handleMessage(message)
    }
  }

  protected override handleClose(code: number, reason: string): void {
    clearTimeout(this.subscribeTimer)
    this.setLevels({ service: 'down' })
    super.handleClose(code, reason)
  }
}
