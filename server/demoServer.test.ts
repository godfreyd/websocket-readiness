import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import type { ServerMessage } from '../src/shared/protocol.ts'
import { attachDemoServer, createDemoServer, WS_PATH, type DemoServer } from './demoServer.ts'

// The faults must be real, so these tests talk to the server over real sockets.
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('demo server', () => {
  let http: Server
  let demo: DemoServer
  let url: string
  const clients: WebSocket[] = []

  const connect = () => {
    const socket = new WebSocket(url)
    const received: ServerMessage[] = []
    socket.on('message', (data) => received.push(JSON.parse(data.toString())))
    socket.on('error', () => {})
    clients.push(socket)
    return { socket, received, opened: new Promise((resolve) => socket.once('open', resolve)) }
  }

  beforeEach(async () => {
    demo = createDemoServer()
    http = createServer()
    attachDemoServer(http, demo)
    await new Promise<void>((resolve) => http.listen(0, resolve))
    url = `ws://localhost:${(http.address() as AddressInfo).port}${WS_PATH}`
  })

  afterEach(async () => {
    for (const socket of clients.splice(0)) socket.terminate()
    demo.close()
    await new Promise((resolve) => http.close(resolve))
  })

  it('sends a ping right after connecting and answers requests', async () => {
    const { socket, received, opened } = connect()
    await opened
    socket.send(JSON.stringify({ type: 'request', id: 7, method: 'echo', params: 'hi' }))
    await sleep(100)
    expect(received[0]).toMatchObject({ type: 'ping' })
    expect(received.find((message) => message.type === 'response')).toMatchObject({ id: 7 })
  })

  it('frozen: the socket stays open and silent, and a close frame goes unanswered', async () => {
    const { socket, received, opened } = connect()
    await opened
    await sleep(50)
    demo.setFault('frozen')
    const countBefore = received.length

    await sleep(1200)
    expect(socket.readyState).toBe(WebSocket.OPEN)
    expect(received.length).toBe(countBefore)

    socket.close()
    let closed = false
    socket.once('close', () => (closed = true))
    await sleep(300)
    expect(closed).toBe(false)
  })

  it('frozen: new connections open, then stay silent', async () => {
    demo.setFault('frozen')
    const { socket, received, opened } = connect()
    await opened
    await sleep(1200)
    expect(socket.readyState).toBe(WebSocket.OPEN)
    expect(received).toEqual([])
  })

  it('service-down: pings continue, the subscription is lost and not restored', async () => {
    const { socket, received, opened } = connect()
    await opened
    socket.send(JSON.stringify({ type: 'subscribe', service: 'feed' }))
    await sleep(50)
    expect(received.at(-1)).toMatchObject({ type: 'subscribed' })

    demo.setFault('service-down')
    socket.send(JSON.stringify({ type: 'subscribe', service: 'feed' }))
    received.length = 0
    await sleep(1100)

    expect(received.some((message) => message.type === 'ping')).toBe(true)
    expect(received.some((message) => message.type === 'subscribed' || message.type === 'feed')).toBe(false)
  })

  it('restart: drops connections and refuses new ones until the downtime ends', async () => {
    const { socket, opened } = connect()
    await opened
    const closed = new Promise((resolve) => socket.once('close', resolve))
    demo.setFault('restart')
    await closed

    const refused = connect()
    await new Promise((resolve) => refused.socket.once('close', resolve))
    expect(demo.getState().refusedAttempts).toBe(1)
  })

  it('flapping: connections are dropped shortly after opening', async () => {
    demo.setFault('flapping')
    const { socket, opened } = connect()
    await opened
    await new Promise((resolve) => socket.once('close', resolve))
    await sleep(50)
    expect(demo.getState().connections).toBe(0)
  })
})
