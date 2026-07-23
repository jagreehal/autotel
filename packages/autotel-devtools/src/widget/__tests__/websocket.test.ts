import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DevtoolsWebSocketClient } from '../websocket'

// Minimal WebSocket stub: records instances, lets tests fire events.
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  readyState = 0
  listeners = new Map<string, Array<(event?: unknown) => void>>()

  constructor(public url: string) {
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, fn: (event?: unknown) => void): void {
    const list = this.listeners.get(type) ?? []
    list.push(fn)
    this.listeners.set(type, list)
  }

  fire(type: string, event?: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(event)
  }

  close(): void {
    this.fire('close')
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('DevtoolsWebSocketClient reconnect', () => {
  it('keeps retrying past 10 attempts with backoff capped at 15s', () => {
    const client = new DevtoolsWebSocketClient('ws://localhost:4318/ws')
    void client.connect()

    // Drop the connection 20 times; each close must schedule another attempt.
    for (let i = 0; i < 20; i++) {
      FakeWebSocket.instances.at(-1)!.fire('close')
      vi.advanceTimersByTime(15_000)
    }

    // initial + 20 reconnects — the old implementation stopped after 10.
    expect(FakeWebSocket.instances.length).toBe(21)
  })

  it('does not reconnect after an intentional disconnect()', () => {
    const client = new DevtoolsWebSocketClient('ws://localhost:4318/ws')
    void client.connect()

    client.disconnect()
    vi.advanceTimersByTime(60_000)

    expect(FakeWebSocket.instances.length).toBe(1)
  })

  it('resets backoff after a successful connection', () => {
    const client = new DevtoolsWebSocketClient('ws://localhost:4318/ws')
    void client.connect()

    // Fail a few times to grow the backoff…
    for (let i = 0; i < 5; i++) {
      FakeWebSocket.instances.at(-1)!.fire('close')
      vi.advanceTimersByTime(15_000)
    }
    // …then connect successfully.
    const socket = FakeWebSocket.instances.at(-1)!
    socket.readyState = FakeWebSocket.OPEN
    socket.fire('open')

    // Next drop should retry after the base 1s delay again.
    socket.fire('close')
    vi.advanceTimersByTime(1000)
    expect(FakeWebSocket.instances.length).toBe(7)
  })
})
