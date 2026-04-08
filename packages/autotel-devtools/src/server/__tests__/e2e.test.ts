import { describe, it, expect, afterEach } from 'vitest'
import { createServer } from 'node:http'
import { DevtoolsServer } from '../server'
import { attachDevtoolsRoutes } from '../http'
import WebSocket from 'ws'

describe('end-to-end: OTLP ingest → WebSocket → client', () => {
  let httpServer: any = null
  let wsServer: DevtoolsServer | null = null

  afterEach(async () => {
    if (wsServer) await wsServer.close()
    else if (httpServer) await new Promise<void>(r => httpServer.close(r))
    wsServer = null
    httpServer = null
  })

  function startServer(): Promise<number> {
    return new Promise((resolve) => {
      httpServer = createServer()
      wsServer = new DevtoolsServer({ server: httpServer })
      attachDevtoolsRoutes(httpServer, wsServer)
      httpServer.listen(0, () => resolve(httpServer.address().port))
    })
  }

  function connectWs(port: number): Promise<{ ws: WebSocket; messages: any[] }> {
    return new Promise((resolve) => {
      const messages: any[] = []
      const ws = new WebSocket(`ws://localhost:${port}/ws`)
      ws.on('message', (data) => messages.push(JSON.parse(data.toString())))
      ws.on('open', () => resolve({ ws, messages }))
    })
  }

  function sendTraces(port: number, payload: any): Promise<Response> {
    return fetch(`http://localhost:${port}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  function sendLogs(port: number, payload: any): Promise<Response> {
    return fetch(`http://localhost:${port}/v1/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  }

  function makeTracePayload(traceId: string, spanName: string, hasError = false) {
    return {
      resourceSpans: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'test-svc' } }] },
        scopeSpans: [{ scope: {}, spans: [{
          traceId, spanId: `${traceId}-span`, name: spanName, kind: 2,
          startTimeUnixNano: '1000000000', endTimeUnixNano: '2000000000',
          status: { code: hasError ? 2 : 1 },
          events: hasError ? [{
            timeUnixNano: '1500000000', name: 'exception',
            attributes: [
              { key: 'exception.type', value: { stringValue: 'Error' } },
              { key: 'exception.message', value: { stringValue: 'test error' } },
            ],
          }] : [],
        }] }],
      }],
    }
  }

  it('sends trace via HTTP, client receives via WebSocket', async () => {
    const port = await startServer()
    const { ws, messages } = await connectWs(port)

    await sendTraces(port, makeTracePayload('trace-1', 'GET /api'))
    await new Promise(r => setTimeout(r, 50))

    expect(messages.length).toBeGreaterThanOrEqual(1)
    const msg = messages.find(m => m.traces?.length > 0)
    expect(msg).toBeDefined()
    expect(msg.traces[0].traceId).toBe('trace-1')
    expect(msg.traces[0].spans[0].name).toBe('GET /api')
    expect(msg.traces[0].service).toBe('test-svc')

    ws.close()
  })

  it('sends logs via HTTP, client receives via WebSocket', async () => {
    const port = await startServer()
    const { ws, messages } = await connectWs(port)

    await sendLogs(port, {
      resourceLogs: [{
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'test' } }] },
        scopeLogs: [{ scope: {}, logRecords: [{
          timeUnixNano: '1000000000',
          severityText: 'ERROR',
          severityNumber: 17,
          body: { stringValue: 'request failed' },
          traceId: 'trace-1',
          spanId: 'span-1',
        }] }],
      }],
    })
    await new Promise(r => setTimeout(r, 50))

    const msg = messages.find(m => m.logs?.length > 0)
    expect(msg).toBeDefined()
    expect(msg.logs[0].severityText).toBe('ERROR')
    expect(msg.logs[0].body).toBe('request failed')

    ws.close()
  })

  it('error traces generate error groups', async () => {
    const port = await startServer()
    const { ws, messages } = await connectWs(port)

    await sendTraces(port, makeTracePayload('trace-err', 'POST /fail', true))
    await new Promise(r => setTimeout(r, 50))

    const msg = messages.find(m => m.errors?.length > 0)
    expect(msg).toBeDefined()
    expect(msg.errors.length).toBeGreaterThan(0)
    expect(msg.errors[0].type).toBe('Error')

    ws.close()
  })

  it('late-connecting client receives history', async () => {
    const port = await startServer()

    // Send traces before any client connects
    await sendTraces(port, makeTracePayload('trace-early', 'GET /early'))
    await sendTraces(port, makeTracePayload('trace-early-2', 'GET /early-2'))

    // Now connect — should receive history
    const { ws, messages } = await connectWs(port)
    await new Promise(r => setTimeout(r, 100))

    const historyMsg = messages[0]
    expect(historyMsg).toBeDefined()
    expect(historyMsg.traces.length).toBeGreaterThanOrEqual(2)

    ws.close()
  })

  it('multiple clients receive the same broadcast', async () => {
    const port = await startServer()
    const client1 = await connectWs(port)
    const client2 = await connectWs(port)

    await sendTraces(port, makeTracePayload('trace-multi', 'GET /multi'))
    await new Promise(r => setTimeout(r, 50))

    const msg1 = client1.messages.find(m => m.traces?.some((t: any) => t.traceId === 'trace-multi'))
    const msg2 = client2.messages.find(m => m.traces?.some((t: any) => t.traceId === 'trace-multi'))
    expect(msg1).toBeDefined()
    expect(msg2).toBeDefined()

    client1.ws.close()
    client2.ws.close()
  })

  it('handles malformed OTLP payloads gracefully', async () => {
    const port = await startServer()

    // Invalid JSON
    const res1 = await fetch(`http://localhost:${port}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    })
    expect(res1.status).toBe(400)

    // Valid JSON but wrong structure
    const res2 = await sendTraces(port, { wrong: 'structure' })
    expect(res2.status).toBe(200) // should accept gracefully with 0 traces
    const body = await res2.json()
    expect(body.acceptedTraces).toBe(0)
  })

  it('CORS headers are present on responses', async () => {
    const port = await startServer()

    const res = await fetch(`http://localhost:${port}/healthz`)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('widget.js endpoint serves JavaScript', async () => {
    const port = await startServer()

    const res = await fetch(`http://localhost:${port}/widget.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('javascript')
  })

  it('handles rapid successive trace submissions', async () => {
    const port = await startServer()
    const { ws } = await connectWs(port)

    // Send 10 traces rapidly
    const promises = Array.from({ length: 10 }, (_, i) =>
      sendTraces(port, makeTracePayload(`rapid-${i}`, `GET /api/${i}`))
    )
    await Promise.all(promises)
    await new Promise(r => setTimeout(r, 200))

    // All traces should be in server state
    const data = wsServer!.getCurrentData()
    expect(data.traces.length).toBe(10)

    ws.close()
  })
})
