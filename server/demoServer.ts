import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { WebSocket, WebSocketServer } from 'ws'
import {
  FEED_SERVICE,
  type ClientMessage,
  type Fault,
  type ServerMessage,
  type ServerState,
} from '../src/shared/protocol.ts'

export const WS_PATH = '/ws'
export const STATE_PATH = '/__demo/state'
export const FAULT_PATH = '/__demo/fault'

const PING_INTERVAL_MS = 1000
const FEED_INTERVAL_MS = 1000
const REPLY_DELAY_MS = 50
const SLOW_REPLY_DELAY_MS = 8000
const FLAP_LIFETIME_MS = 300
const RESTART_DOWNTIME_MS = 3000

interface Connection {
  socket: WebSocket
  subscribed: boolean
}

export interface DemoServer {
  handleUpgrade(request: IncomingMessage, socket: Socket, head: Buffer): boolean
  // Returns true if the request belonged to the demo API.
  handleHttp(request: IncomingMessage, response: ServerResponse): boolean
  setFault(fault: Fault): void
  getState(): ServerState
  close(): void
}

// The socket under a ws connection. Pausing it is what makes "frozen" real:
// the kernel keeps the connection open, but the server stops reading, so it
// doesn't even answer a close frame. To the browser this looks exactly like
// a peer that has silently disappeared.
function rawSocket(socket: WebSocket): Socket {
  return (socket as unknown as { _socket: Socket })._socket
}

export function createDemoServer(): DemoServer {
  const wss = new WebSocketServer({ noServer: true })
  const connections = new Set<Connection>()
  let fault: Fault = 'normal'
  let refusing = false
  let totalAttempts = 0
  let refusedAttempts = 0
  let feedSeq = 0
  let restartTimer: ReturnType<typeof setTimeout> | undefined

  const send = (connection: Connection, message: ServerMessage) => {
    if (connection.socket.readyState === WebSocket.OPEN) connection.socket.send(JSON.stringify(message))
  }

  const handleMessage = (connection: Connection, message: ClientMessage) => {
    if (fault === 'service-down') return

    if (message.type === 'subscribe') {
      connection.subscribed = true
      send(connection, { type: 'subscribed', service: message.service })
      return
    }

    const delay = fault === 'slow-replies' ? SLOW_REPLY_DELAY_MS : REPLY_DELAY_MS
    setTimeout(() => {
      send(connection, { type: 'response', id: message.id, result: { echo: message.params, at: Date.now() } })
    }, delay)
  }

  const handleConnection = (socket: WebSocket) => {
    const connection: Connection = { socket, subscribed: false }
    connections.add(connection)

    socket.on('close', () => connections.delete(connection))
    socket.on('error', () => connections.delete(connection))
    socket.on('message', (data) => handleMessage(connection, JSON.parse(data.toString()) as ClientMessage))

    if (fault === 'frozen') {
      // A load balancer accepted the connection, the backend behind it is stuck.
      rawSocket(socket).pause()
      return
    }

    send(connection, { type: 'ping', intervalMs: PING_INTERVAL_MS })

    if (fault === 'flapping') {
      setTimeout(() => socket.terminate(), FLAP_LIFETIME_MS)
    }
  }

  const pingTimer = setInterval(() => {
    if (fault === 'frozen') return
    for (const connection of connections) send(connection, { type: 'ping', intervalMs: PING_INTERVAL_MS })
  }, PING_INTERVAL_MS)

  const feedTimer = setInterval(() => {
    if (fault === 'frozen' || fault === 'service-down') return
    feedSeq++
    for (const connection of connections) {
      if (connection.subscribed) send(connection, { type: 'feed', seq: feedSeq, text: `Update #${feedSeq}` })
    }
  }, FEED_INTERVAL_MS)

  const setFault = (next: Fault) => {
    clearTimeout(restartTimer)
    refusing = false

    if (fault === 'frozen') {
      for (const connection of connections) rawSocket(connection.socket).resume()
    }

    fault = next

    if (next === 'frozen') {
      for (const connection of connections) rawSocket(connection.socket).pause()
    } else if (next === 'service-down') {
      for (const connection of connections) {
        if (connection.subscribed) send(connection, { type: 'unsubscribed', service: FEED_SERVICE })
        connection.subscribed = false
      }
    } else if (next === 'flapping') {
      for (const connection of connections) connection.socket.terminate()
    } else if (next === 'restart') {
      refusing = true
      for (const connection of connections) connection.socket.terminate()
      restartTimer = setTimeout(() => {
        refusing = false
        fault = 'normal'
      }, RESTART_DOWNTIME_MS)
    }
  }

  const getState = (): ServerState => ({
    fault,
    connections: connections.size,
    totalAttempts,
    refusedAttempts,
  })

  return {
    handleUpgrade(request, socket, head) {
      if (new URL(request.url ?? '/', 'http://localhost').pathname !== WS_PATH) return false

      totalAttempts++
      if (refusing) {
        refusedAttempts++
        socket.destroy()
        return true
      }

      wss.handleUpgrade(request, socket, head, handleConnection)
      return true
    },

    handleHttp(request, response) {
      const { pathname } = new URL(request.url ?? '/', 'http://localhost')

      if (pathname === STATE_PATH) {
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify(getState()))
        return true
      }

      if (pathname === FAULT_PATH && request.method === 'POST') {
        let body = ''
        request.on('data', (chunk) => (body += chunk))
        request.on('end', () => {
          setFault((JSON.parse(body) as { fault: Fault }).fault)
          response.setHeader('Content-Type', 'application/json')
          response.end(JSON.stringify(getState()))
        })
        return true
      }

      return false
    },

    setFault,
    getState,

    close() {
      clearInterval(pingTimer)
      clearInterval(feedTimer)
      clearTimeout(restartTimer)
      for (const connection of connections) connection.socket.terminate()
      wss.close()
    },
  }
}

export function attachDemoServer(httpServer: Server, demo: DemoServer): void {
  httpServer.on('upgrade', (request, socket, head) => {
    demo.handleUpgrade(request, socket as Socket, head)
  })
}
