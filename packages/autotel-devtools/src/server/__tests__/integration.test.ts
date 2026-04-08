// src/server/__tests__/integration.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from 'node:http'
import { DevtoolsServer } from '../server'
import { attachDevtoolsRoutes } from '../http'
import WebSocket from 'ws'

describe('integrated HTTP + WebSocket server', () => {
  let httpServer: any = null
  let wsServer: DevtoolsServer | null = null

  afterEach(async () => {
    if (wsServer) await wsServer.close()
    else if (httpServer) await new Promise<void>(r => httpServer.close(r))
    wsServer = null
    httpServer = null
  })

  it('serves OTLP ingest and WebSocket on the same port', async () => {
    httpServer = createServer()
    wsServer = new DevtoolsServer({ server: httpServer })
    attachDevtoolsRoutes(httpServer, wsServer)

    await new Promise<void>(r => httpServer.listen(0, r))
    const port = httpServer.address().port

    // Connect WebSocket
    const ws = new WebSocket(`ws://localhost:${port}/ws`)
    await new Promise<void>(r => ws.on('open', r))

    // Send OTLP trace via HTTP
    const msgPromise = new Promise<any>(r => ws.on('message', d => r(JSON.parse(d.toString()))))

    await fetch(`http://localhost:${port}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resourceSpans: [{
          resource: { attributes: [{ key: 'service.name', value: { stringValue: 'test' } }] },
          scopeSpans: [{ scope: {}, spans: [{
            traceId: 'abc', spanId: 'def', name: 'test', kind: 2,
            startTimeUnixNano: '1000000000', endTimeUnixNano: '2000000000',
            status: { code: 1 },
          }] }],
        }],
      }),
    })

    const msg = await msgPromise
    expect(msg.traces).toHaveLength(1)

    // Verify fullpage HTML
    const htmlRes = await fetch(`http://localhost:${port}/`)
    expect(htmlRes.status).toBe(200)
    const html = await htmlRes.text()
    expect(html).toContain('autotel-devtools')

    ws.close()
    await new Promise(r => setTimeout(r, 50))
  })
})
