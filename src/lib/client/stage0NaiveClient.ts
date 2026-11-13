import { FEED_SERVICE, type ClientMessage, type ServerMessage } from '../../shared/protocol'
import type {
  ClientOptions,
  ClientStatus,
  ConnectionClient,
  Levels,
  LogKind,
  SocketLike,
} from './types'

const SOCKET_OPEN = 1
const RECONNECT_DELAY_MS = 1000

export interface PendingRequest {
  method: string
  resolve(value: unknown): void
  reject(error: Error): void
}

// Stage 0. The code most of us have written at least once:
//   - "online" means onopen has fired, "offline" means onclose has fired;
//   - requests wait for a response for as long as it takes;
//   - reconnection is a fixed one-second timer.
//
// Each of the next stages is a subclass containing only its own fix,
// so a stage's file is exactly the diff the article talks about.
export class NaiveClient implements ConnectionClient {
  protected readonly options: ClientOptions
  protected socket: SocketLike | null = null
  protected levels: Levels = { transport: 'down', protocol: 'untracked', service: 'untracked' }
  protected readonly pending = new Map<number, PendingRequest>()
  protected started = false
  // Every socket this client has created and not yet seen closed.
  protected readonly sockets = new Set<SocketLike>()
  private nextRequestId = 1
  private reconnectTimers = new Set<ReturnType<typeof setTimeout>>()

  constructor(options: ClientOptions) {
    this.options = options
  }

  start(): void {
    this.started = true
    this.connect()
  }

  // Demo plumbing rather than part of the lesson: switching stages must
  // leave nothing behind, whatever bugs the stage has.
  stop(): void {
    this.started = false
    this.clearReconnectTimers()
    for (const socket of this.sockets) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
      socket.close()
    }
    this.sockets.clear()
    this.socket = null
  }

  getStatus(): ClientStatus {
    return { ...this.levels, ready: this.isReady() }
  }

  request(method: string, params: unknown = null): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextRequestId++
      // send() throws if the socket isn't open, which rejects this promise.
      this.send({ type: 'request', id, method, params })
      this.registerRequest(id, { method, resolve, reject })
    })
  }

  protected isReady(): boolean {
    return this.levels.transport === 'up'
  }

  protected connect(): void {
    this.setLevels({ transport: 'pending' })
    this.log('info', 'Connecting…')

    const socket = (this.options.createSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike))(
      this.options.url,
    )
    this.socket = socket
    this.sockets.add(socket)
    this.bindSocket(socket)
  }

  protected bindSocket(socket: SocketLike): void {
    socket.onopen = () => this.handleOpen()
    socket.onmessage = (event) => this.handleMessage(JSON.parse(String(event.data)) as ServerMessage)
    socket.onclose = (event) => {
      this.sockets.delete(socket)
      this.handleClose(event.code, event.reason)
    }
  }

  protected handleOpen(): void {
    this.setLevels({ transport: 'up' })
    this.log('info', 'Socket opened')
    this.subscribeToFeed()
  }

  protected subscribeToFeed(): void {
    this.send({ type: 'subscribe', service: FEED_SERVICE })
  }

  protected handleMessage(message: ServerMessage): void {
    if (message.type === 'feed') {
      this.options.hooks?.onFeed?.(message.seq, message.text)
    } else if (message.type === 'response') {
      this.handleResponse(message.id, message.result, message.error)
    }
  }

  protected handleResponse(id: number, result: unknown, error: string | undefined): void {
    const request = this.pending.get(id)
    if (!request) return

    this.pending.delete(id)
    if (error) request.reject(new Error(error))
    else request.resolve(result)
  }

  protected handleClose(code: number, reason: string): void {
    this.setLevels({ transport: 'down' })
    this.log('warn', `Socket closed: ${code}${reason ? ` ${reason}` : ''}`)
    if (this.started) this.scheduleReconnect()
  }

  protected scheduleReconnect(): void {
    const delay = this.nextReconnectDelay()
    this.log('info', `Reconnecting in ${Math.round(delay)} ms`)
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(timer)
      this.connect()
    }, delay)
    this.reconnectTimers.add(timer)
  }

  protected clearReconnectTimers(): void {
    for (const timer of this.reconnectTimers) clearTimeout(timer)
    this.reconnectTimers.clear()
  }

  protected nextReconnectDelay(): number {
    return RECONNECT_DELAY_MS
  }

  // Requests just sit here until a response arrives. If it never does,
  // the promise never settles.
  protected registerRequest(id: number, request: PendingRequest): void {
    this.pending.set(id, request)
  }

  protected send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== SOCKET_OPEN) throw new Error('Socket is not open')
    this.socket.send(JSON.stringify(message))
  }

  protected setLevels(levels: Partial<Levels>): void {
    this.levels = { ...this.levels, ...levels }
    this.options.hooks?.onStatus?.(this.getStatus())
  }

  protected log(kind: LogKind, text: string): void {
    this.options.hooks?.onLog?.(kind, text)
  }
}
