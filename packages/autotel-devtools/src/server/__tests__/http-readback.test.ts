import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { DevtoolsServer } from '../server'
import { attachDevtoolsRoutes } from '../http'
import { listenLoopbackDualStack } from '../listen'

/**
 * The "real lesson" tests: verify the collector ACTUALLY RECEIVED spans by
 * reading them back over HTTP — not by trusting that a client tried to send.
 * A browser-level route intercept can fulfil/observe the outbound request
 * before it ever reaches a server; these tests deliberately hit the server.
 */
describe('HTTP read-back: verify the collector received spans', () => {
  let server: Server | null = null
  let devtools: DevtoolsServer | null = null
  let extraClose: (() => Promise<void>) | null = null

  afterEach(async () => {
    if (extraClose) await extraClose()
    if (devtools) await devtools.close()
    else if (server) await new Promise<void>((r) => server!.close(() => r()))
    server = null
    devtools = null
    extraClose = null
  })

  function makeTracePayload(traceId: string, spanName: string) {
    return {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'readback-svc' } },
            ],
          },
          scopeSpans: [
            {
              scope: {},
              spans: [
                {
                  traceId,
                  spanId: `${traceId}-span`,
                  name: spanName,
                  kind: 2,
                  startTimeUnixNano: '1000000000',
                  endTimeUnixNano: '2000000000',
                  status: { code: 1 },
                },
              ],
            },
          ],
        },
      ],
    }
  }

  function post(base: string, payload: unknown) {
    return fetch(`${base}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  it('GET /v1/traces returns exactly what was POSTed (no WebSocket involved)', async () => {
    const port = await new Promise<number>((resolve) => {
      server = createServer()
      devtools = new DevtoolsServer({ server })
      attachDevtoolsRoutes(server, devtools)
      server.listen(0, () => resolve((server!.address() as { port: number }).port))
    })
    const base = `http://127.0.0.1:${port}`

    // Before anything is sent, the collector is empty.
    const empty = await (await fetch(`${base}/v1/traces`)).json()
    expect(empty.count).toBe(0)

    // Send a span and assert the SERVER actually has it.
    const postRes = await post(base, makeTracePayload('trace-recv', 'GET /api/orders'))
    expect(postRes.status).toBe(200)

    const readBack = await (await fetch(`${base}/v1/traces`)).json()
    expect(readBack.count).toBe(1)
    expect(readBack.traces[0].traceId).toBe('trace-recv')
    expect(readBack.traces[0].spans[0].name).toBe('GET /api/orders')
    expect(readBack.traces[0].service).toBe('readback-svc')
  })

  it('DELETE /v1/traces clears captured telemetry for test isolation', async () => {
    const port = await new Promise<number>((resolve) => {
      server = createServer()
      devtools = new DevtoolsServer({ server })
      attachDevtoolsRoutes(server, devtools)
      server.listen(0, () => resolve((server!.address() as { port: number }).port))
    })
    const base = `http://127.0.0.1:${port}`

    await post(base, makeTracePayload('trace-a', 'a'))
    expect((await (await fetch(`${base}/v1/traces`)).json()).count).toBe(1)

    const del = await fetch(`${base}/v1/traces`, { method: 'DELETE' })
    expect(del.status).toBe(200)
    expect((await del.json()).cleared).toBe(true)

    expect((await (await fetch(`${base}/v1/traces`)).json()).count).toBe(0)
  })

  it('dual-stack loopback: a span sent to either IPv4 or IPv6 localhost is received', async () => {
    server = createServer()
    devtools = new DevtoolsServer({ server })
    attachDevtoolsRoutes(server, devtools)
    const listeners = listenLoopbackDualStack({
      primary: server,
      port: 0,
      host: '127.0.0.1',
      attachSecondary: (s) => attachDevtoolsRoutes(s, devtools!),
    })
    const { addresses, warnings } = await listeners.ready
    extraClose = listeners.closeSibling

    const port = Number(addresses[0].split(':').pop())

    // IPv4 form always works.
    await post(`http://127.0.0.1:${port}`, makeTracePayload('trace-v4', 'v4'))

    // IPv6 form works too when the sibling bound (i.e. no warning). On hosts
    // without IPv6 loopback we get a warning instead of a silent black hole —
    // which is the whole point.
    const ipv6Bound = warnings.length === 0
    if (ipv6Bound) {
      await post(`http://[::1]:${port}`, makeTracePayload('trace-v6', 'v6'))
    }

    const readBack = await (await fetch(`http://127.0.0.1:${port}/v1/traces`)).json()
    const ids = readBack.traces.map((t: { traceId: string }) => t.traceId)
    expect(ids).toContain('trace-v4')
    if (ipv6Bound) expect(ids).toContain('trace-v6')
  })
})
