// src/server/__tests__/identity.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { DevtoolsServer } from '../server'
import { attachDevtoolsRoutes } from '../http'
import { probePortHolder, DEVTOOLS_IDENTITY } from '../identity'

const portOf = (s: Server): number => (s.address() as AddressInfo).port

describe('identity + health', () => {
  let httpServer: Server | null = null
  let wsServer: DevtoolsServer | null = null
  let foreign: Server | null = null

  afterEach(async () => {
    if (wsServer) await wsServer.close()
    if (httpServer) await new Promise<void>((r) => httpServer!.close(() => r()))
    if (foreign) await new Promise<void>((r) => foreign!.close(() => r()))
    httpServer = wsServer = foreign = null
  })

  async function startDevtools(): Promise<number> {
    httpServer = createServer()
    wsServer = new DevtoolsServer({ server: httpServer })
    attachDevtoolsRoutes(httpServer, wsServer)
    await new Promise<void>((r) => httpServer!.listen(0, '127.0.0.1', () => r()))
    return portOf(httpServer)
  }

  it('GET /healthz carries the identity body (service + version + clients)', async () => {
    const port = await startDevtools()
    const res = await fetch(`http://127.0.0.1:${port}/healthz`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.service).toBe(DEVTOOLS_IDENTITY)
    expect(typeof body.version).toBe('string')
    expect(typeof body.clients).toBe('number')
  })

  it('stamps every response with the x-autotel-devtools header', async () => {
    const port = await startDevtools()
    const res = await fetch(`http://127.0.0.1:${port}/healthz`)
    expect(res.headers.get('x-autotel-devtools')).toBeTruthy()
  })

  it('a 400 on bad OTLP echoes the content-type that was received', async () => {
    const port = await startDevtools()
    const res = await fetch(`http://127.0.0.1:${port}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'this is not valid json',
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('Invalid OTLP payload')
    expect(body.contentType).toBe('application/json')
  })

  it('probePortHolder identifies a real autotel-devtools instance', async () => {
    const port = await startDevtools()
    expect(await probePortHolder('127.0.0.1', port)).toBe('autotel-devtools')
  })

  it('probePortHolder flags a foreign HTTP server (e.g. an IDE collector)', async () => {
    foreign = createServer((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
    })
    await new Promise<void>((r) => foreign!.listen(0, '127.0.0.1', () => r()))
    expect(await probePortHolder('127.0.0.1', portOf(foreign))).toBe('foreign')
  })

  it('probePortHolder returns none when nothing is listening', async () => {
    // Bind to grab a port, then release it so the port is (almost certainly) free.
    const tmp = createServer()
    await new Promise<void>((r) => tmp.listen(0, '127.0.0.1', () => r()))
    const port = portOf(tmp)
    await new Promise<void>((r) => tmp.close(() => r()))
    expect(await probePortHolder('127.0.0.1', port, 300)).toBe('none')
  })
})
