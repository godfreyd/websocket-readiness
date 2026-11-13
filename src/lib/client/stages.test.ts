import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixedDelay } from '../backoff'
import type { ServerMessage } from '../../shared/protocol'
import { ConnectionClosedError, NotReadyError, RequestTimeoutError } from './errors'
import { NaiveClient } from './stage0NaiveClient'
import { REQUEST_TIMEOUT_MS, RequestRegistryClient } from './stage1RequestRegistry'
import { FIRST_PING_TIMEOUT_MS, HeartbeatClient } from './stage2Heartbeat'
import { StaleEventsClient } from './stage3StaleEvents'
import { SUBSCRIBE_TIMEOUT_MS, ServiceReadinessClient } from './stage4ServiceReadiness'
import { COOLDOWN_MS, ReconnectPolicyClient } from './stage5ReconnectPolicy'
import type { ClientOptions, SocketLike } from './types'

class FakeSocket implements SocketLike {
  readyState = 0
  onopen: SocketLike['onopen'] = null
  onmessage: SocketLike['onmessage'] = null
  onclose: SocketLike['onclose'] = null
  onerror: SocketLike['onerror'] = null
  sent: Array<{ type: string; id?: number }> = []
  closeCalled = false

  send(data: string) {
    this.sent.push(JSON.parse(data))
  }

  // Like a real socket whose peer is dead: close() alone doesn't fire onclose.
  close() {
    this.closeCalled = true
    this.readyState = 2
  }

  open() {
    this.readyState = 1
    this.onopen?.(undefined as never)
  }

  receive(message: ServerMessage) {
    this.onmessage?.({ data: JSON.stringify(message) })
  }

  fireClose(code = 1006) {
    this.readyState = 3
    this.onclose?.({ code, reason: '' })
  }
}

const ping: ServerMessage = { type: 'ping', intervalMs: 1000 }
const subscribed: ServerMessage = { type: 'subscribed', service: 'feed' }

function setup<T>(create: (options: ClientOptions) => T) {
  const sockets: FakeSocket[] = []
  const client = create({
    url: 'ws://test',
    createSocket: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  })
  return { client, sockets }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('stage 0: naive client', () => {
  it('believes it is online as soon as the socket opens', () => {
    const { client, sockets } = setup((options) => new NaiveClient(options))
    client.start()
    expect(client.getStatus().ready).toBe(false)
    sockets[0].open()
    expect(client.getStatus().ready).toBe(true)
  })

  it('stays online forever when the peer goes silent', () => {
    const { client, sockets } = setup((options) => new NaiveClient(options))
    client.start()
    sockets[0].open()
    vi.advanceTimersByTime(3_600_000)
    expect(client.getStatus().ready).toBe(true)
  })

  it('leaves the request hanging when the connection dies', async () => {
    const { client, sockets } = setup((options) => new NaiveClient(options))
    client.start()
    sockets[0].open()

    const settled = vi.fn()
    client.request('echo').then(settled, settled)
    sockets[0].fireClose()
    await vi.advanceTimersByTimeAsync(3_600_000)

    expect(settled).not.toHaveBeenCalled()
  })
})

describe('stage 1: request registry', () => {
  it('rejects a request that gets no response in time', async () => {
    const { client, sockets } = setup((options) => new RequestRegistryClient(options))
    client.start()
    sockets[0].open()

    const result = expect(client.request('echo')).rejects.toBeInstanceOf(RequestTimeoutError)
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
    await result
  })

  it('rejects everything in flight when the connection dies', async () => {
    const { client, sockets } = setup((options) => new RequestRegistryClient(options))
    client.start()
    sockets[0].open()

    const result = expect(client.request('echo')).rejects.toBeInstanceOf(ConnectionClosedError)
    sockets[0].fireClose()
    await result
  })

  it('fails right away when it cannot send', async () => {
    const { client } = setup((options) => new RequestRegistryClient(options))
    client.start()
    await expect(client.request('echo')).rejects.toBeInstanceOf(NotReadyError)
  })

  it('resolves on a matching response and ignores a late one', async () => {
    const { client, sockets } = setup((options) => new RequestRegistryClient(options))
    client.start()
    sockets[0].open()

    const first = client.request('echo')
    const { id } = sockets[0].sent.at(-1)!
    sockets[0].receive({ type: 'response', id: id!, result: 'ok' })
    await expect(first).resolves.toBe('ok')
    expect(() => sockets[0].receive({ type: 'response', id: id!, result: 'late' })).not.toThrow()
  })

  it('ids keep growing across connections', async () => {
    const { client, sockets } = setup((options) => new RequestRegistryClient(options))
    client.start()
    sockets[0].open()
    client.request('echo').catch(() => {})
    const firstId = sockets[0].sent.at(-1)!.id!

    sockets[0].fireClose()
    vi.advanceTimersByTime(1000)
    sockets[1].open()
    client.request('echo').catch(() => {})

    expect(sockets[1].sent.at(-1)!.id).toBeGreaterThan(firstId)
  })
})

describe('stage 2: heartbeat', () => {
  it('is not ready until the first ping', () => {
    const { client, sockets } = setup((options) => new HeartbeatClient(options))
    client.start()
    sockets[0].open()
    expect(client.getStatus().ready).toBe(false)
    sockets[0].receive(ping)
    expect(client.getStatus().ready).toBe(true)
  })

  it('gives up if the first ping never comes', () => {
    const { client, sockets } = setup((options) => new HeartbeatClient(options))
    client.start()
    sockets[0].open()
    vi.advanceTimersByTime(FIRST_PING_TIMEOUT_MS)
    expect(sockets[0].closeCalled).toBe(true)
    expect(client.getStatus().transport).toBe('down')
  })

  it('detects silence after two announced intervals, not sooner', () => {
    const { client, sockets } = setup((options) => new HeartbeatClient(options))
    client.start()
    sockets[0].open()
    sockets[0].receive(ping)

    vi.advanceTimersByTime(1999)
    expect(client.getStatus().ready).toBe(true)
    vi.advanceTimersByTime(1)
    expect(client.getStatus().ready).toBe(false)
  })

  it('reconnects without waiting for onclose of the dead socket', () => {
    const { client, sockets } = setup((options) => new HeartbeatClient(options))
    client.start()
    sockets[0].open()
    sockets[0].receive(ping)
    vi.advanceTimersByTime(2000 + 1000)
    expect(sockets).toHaveLength(2)
  })

  it('has the bug: a late onclose of the old socket hits the new connection', () => {
    const { client, sockets } = setup((options) => new HeartbeatClient(options))
    client.start()
    sockets[0].open()
    sockets[0].receive(ping)
    vi.advanceTimersByTime(2000 + 1000)
    sockets[1].open()
    sockets[1].receive(ping)
    expect(client.getStatus().ready).toBe(true)

    sockets[0].fireClose()

    expect(sockets[1].readyState).toBe(1)
    expect(client.getStatus().ready).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(sockets).toHaveLength(3)
  })
})

describe('stage 3: stale events', () => {
  it('a late onclose of the old socket changes nothing', () => {
    const { client, sockets } = setup((options) => new StaleEventsClient(options))
    client.start()
    sockets[0].open()
    sockets[0].receive(ping)
    vi.advanceTimersByTime(2000 + 1000)
    sockets[1].open()
    sockets[1].receive(ping)

    sockets[0].fireClose()

    expect(client.getStatus().ready).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(sockets).toHaveLength(2)
  })

  it('messages from the old socket are ignored', () => {
    const onFeed = vi.fn()
    const sockets: FakeSocket[] = []
    const client = new StaleEventsClient({
      url: 'ws://test',
      hooks: { onFeed },
      createSocket: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    client.start()
    sockets[0].open()
    sockets[0].receive(ping)
    vi.advanceTimersByTime(2000 + 1000)

    sockets[0].receive({ type: 'feed', seq: 1, text: 'stale' })
    expect(onFeed).not.toHaveBeenCalled()
  })
})

describe('stage 4: service readiness', () => {
  it('a ping is not enough, the subscription must be acknowledged', () => {
    const { client, sockets } = setup((options) => new ServiceReadinessClient(options))
    client.start()
    sockets[0].open()
    sockets[0].receive(ping)
    expect(client.getStatus().protocol).toBe('up')
    expect(client.getStatus().ready).toBe(false)

    sockets[0].receive(subscribed)
    expect(client.getStatus().ready).toBe(true)
  })

  it('keeps asking over the same socket without an ack', () => {
    const { client, sockets } = setup((options) => new ServiceReadinessClient(options))
    client.start()
    sockets[0].open()

    const subscribeCount = () => sockets[0].sent.filter((message) => message.type === 'subscribe').length
    expect(subscribeCount()).toBe(1)

    sockets[0].receive(ping)
    vi.advanceTimersByTime(SUBSCRIBE_TIMEOUT_MS - 1)
    sockets[0].receive(ping)
    vi.advanceTimersByTime(1)
    expect(subscribeCount()).toBe(2)
    expect(sockets).toHaveLength(1)
  })

  it('a lost subscription drops readiness but keeps the connection', () => {
    const { client, sockets } = setup((options) => new ServiceReadinessClient(options))
    client.start()
    sockets[0].open()
    sockets[0].receive(ping)
    sockets[0].receive(subscribed)

    sockets[0].receive({ type: 'unsubscribed', service: 'feed' })

    const status = client.getStatus()
    expect(status.ready).toBe(false)
    expect(status.transport).toBe('up')
    expect(status.service).toBe('pending')
    expect(sockets[0].closeCalled).toBe(false)
  })
})

describe('stage 5: reconnect policy', () => {
  function setupWithSpy() {
    const delays: number[] = []
    const spy = fixedDelay(100)
    const reset = vi.fn()
    const backoff = {
      nextDelay: () => {
        const delay = spy.nextDelay(Math.random)
        delays.push(delay)
        return delay
      },
      reset,
    }
    const sockets: FakeSocket[] = []
    const client = new ReconnectPolicyClient({
      url: 'ws://test',
      backoff,
      createSocket: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket
      },
    })
    return { client, sockets, reset, delays }
  }

  const becomeReady = (socket: FakeSocket) => {
    socket.open()
    socket.receive(ping)
    socket.receive(subscribed)
  }

  it('asks the backoff policy for reconnect delays', () => {
    const { client, sockets, delays } = setupWithSpy()
    client.start()
    sockets[0].fireClose()
    expect(delays).toEqual([100])
  })

  it('a brief success does not reset the backoff', () => {
    const { client, sockets, reset } = setupWithSpy()
    client.start()
    becomeReady(sockets[0])
    vi.advanceTimersByTime(COOLDOWN_MS - 1)
    sockets[0].fireClose()
    vi.advanceTimersByTime(COOLDOWN_MS)
    expect(reset).not.toHaveBeenCalled()
  })

  it('the backoff resets after a whole cooldown of readiness', () => {
    const { client, sockets, reset } = setupWithSpy()
    client.start()
    becomeReady(sockets[0])
    // Keep the watchdog happy for the whole cooldown.
    for (let elapsed = 0; elapsed < COOLDOWN_MS; elapsed += 1000) {
      vi.advanceTimersByTime(1000)
      sockets[0].receive(ping)
    }
    expect(reset).toHaveBeenCalledTimes(1)
  })
})
