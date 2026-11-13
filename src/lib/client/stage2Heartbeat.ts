import type { ServerMessage } from '../../shared/protocol'
import { RequestRegistryClient } from './stage1RequestRegistry'
import type { ClientOptions } from './types'

export const FIRST_PING_TIMEOUT_MS = 3000
export const CLOSE_NO_HEARTBEAT = 4000

// Stage 2. TCP won't tell us the peer is gone, and the browser hides WebSocket
// protocol pings from JavaScript, so liveness is checked at the application level:
//   - the connection isn't alive until the first ping arrives;
//   - after that, silence for two intervals means it's dead;
//   - the interval comes from the server, so it can be tuned without a client release.
//
// This stage also contains the tempting mistake that stage 3 fixes: forceReconnect
// doesn't wait for onclose (see the comment there), yet leaves the handlers of the
// old socket attached.
export class HeartbeatClient extends RequestRegistryClient {
  private watchdog: ReturnType<typeof setTimeout> | undefined

  constructor(options: ClientOptions) {
    super(options)
    this.levels = { ...this.levels, protocol: 'down' }
  }

  override stop(): void {
    clearTimeout(this.watchdog)
    super.stop()
  }

  protected override isReady(): boolean {
    return super.isReady() && this.levels.protocol === 'up'
  }

  protected override handleOpen(): void {
    this.setLevels({ protocol: 'pending' })
    this.armWatchdog(FIRST_PING_TIMEOUT_MS)
    super.handleOpen()
  }

  protected override handleMessage(message: ServerMessage): void {
    if (message.type === 'ping') {
      this.armWatchdog(message.intervalMs * 2)
      if (this.levels.protocol !== 'up') {
        this.log('info', `Peer is alive, heartbeat every ${message.intervalMs} ms`)
        this.setLevels({ protocol: 'up' })
      }
      return
    }
    super.handleMessage(message)
  }

  protected override handleClose(code: number, reason: string): void {
    clearTimeout(this.watchdog)
    this.setLevels({ protocol: 'down' })
    super.handleClose(code, reason)
  }

  private armWatchdog(timeoutMs: number): void {
    clearTimeout(this.watchdog)
    this.watchdog = setTimeout(() => {
      this.log('error', `No heartbeat for ${timeoutMs} ms, the connection is dead`)
      this.forceReconnect(CLOSE_NO_HEARTBEAT, 'no heartbeat')
    }, timeoutMs)
  }

  // We can't wait for onclose here. close() starts a closing handshake,
  // and a dead peer will never answer it, so onclose may come much later.
  // We have to move on now, and that's where stage 3 begins: the old socket
  // still has its handlers, and its onclose will eventually fire.
  protected forceReconnect(code: number, reason: string): void {
    this.socket?.close(code, reason)
    this.handleClose(code, reason)
  }
}
