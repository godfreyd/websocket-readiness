import { HeartbeatClient } from './stage2Heartbeat'
import type { SocketLike } from './types'

// Stage 3. Once we stop waiting for onclose, an old socket can outlive its
// replacement, and its late events get applied to the state of the new connection:
// the status drops to "down" on a healthy connection, live requests get rejected,
// and an extra reconnect leaves two sockets open.
//
// The fix is one rule: only the current socket may change the client's state.
export class StaleEventsClient extends HeartbeatClient {
  protected override bindSocket(socket: SocketLike): void {
    super.bindSocket(socket)

    const { onopen, onmessage, onclose } = socket
    socket.onopen = (event) => {
      if (socket === this.socket) onopen?.(event)
    }
    socket.onmessage = (event) => {
      if (socket === this.socket) onmessage?.(event)
    }
    socket.onclose = (event) => {
      if (socket === this.socket) {
        onclose?.(event)
      } else {
        this.sockets.delete(socket)
        this.log('info', `Ignored a stale close event: ${event.code}`)
      }
    }
  }

  protected override forceReconnect(code: number, reason: string): void {
    const stale = this.socket
    // From this moment on, whatever the old socket says is ignored.
    this.socket = null
    stale?.close(code, reason)
    this.handleClose(code, reason)
  }
}
