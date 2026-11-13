// A connection is ready only if every level it tracks is up. Early stages don't
// track some levels at all: they simply have no idea what happens there.
export type LevelState = 'untracked' | 'down' | 'pending' | 'up'

export interface Levels {
  // Is the WebSocket open?
  transport: LevelState
  // Is the peer actually alive?
  protocol: LevelState
  // Is the service behind the connection serving us?
  service: LevelState
}

export interface ClientStatus extends Levels {
  ready: boolean
}

export type LogKind = 'info' | 'warn' | 'error'

export interface ClientHooks {
  onStatus?(status: ClientStatus): void
  onLog?(kind: LogKind, text: string): void
  onFeed?(seq: number, text: string): void
}

// The part of the browser WebSocket the clients rely on.
// Tests substitute a fake with the same shape.
export interface SocketLike {
  readonly readyState: number
  onopen: ((event: never) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: { code: number; reason: string }) => void) | null
  onerror: ((event: never) => void) | null
  send(data: string): void
  close(code?: number, reason?: string): void
}

export interface ClientOptions {
  url: string
  hooks?: ClientHooks
  createSocket?(url: string): SocketLike
}

export interface ConnectionClient {
  start(): void
  stop(): void
  getStatus(): ClientStatus
  request(method: string, params?: unknown): Promise<unknown>
}
