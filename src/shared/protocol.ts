// The wire protocol shared by the demo server and all client stages.

export type ClientMessage =
  | { type: 'subscribe'; service: string }
  | { type: 'request'; id: number; method: string; params: unknown }

export type ServerMessage =
  // The server announces its own heartbeat interval, so clients don't hardcode it.
  | { type: 'ping'; intervalMs: number }
  | { type: 'subscribed'; service: string }
  | { type: 'unsubscribed'; service: string }
  | { type: 'feed'; seq: number; text: string }
  | { type: 'response'; id: number; result?: unknown; error?: string }

export const FEED_SERVICE = 'feed'

// What can go wrong on the server side. See server/demoServer.ts.
export type Fault =
  | 'normal'
  // The TCP connection stays open, but nothing is read or written.
  | 'frozen'
  // The connection and heartbeat are fine, but the service behind them is gone.
  | 'service-down'
  // Connections are accepted and dropped 300 ms later.
  | 'flapping'
  // Responses take longer than any reasonable request timeout.
  | 'slow-replies'
  // All connections die, and new ones are refused for 3 seconds.
  | 'restart'

export interface ServerState {
  fault: Fault
  connections: number
  totalAttempts: number
  refusedAttempts: number
}
