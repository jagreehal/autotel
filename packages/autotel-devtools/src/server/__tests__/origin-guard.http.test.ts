import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { DevtoolsServer } from '../server'
import { attachDevtoolsRoutes } from '../http'

// End-to-end: the read-back / clear endpoints reject a cross-origin browser
// request but keep serving the legitimate read paths (curl/node with no Origin,
// and the OTLP ingest path, which must stay open to any dev origin).
describe('origin guard on the HTTP read surface', () => {
  let server: Server | null = null
  let devtools: DevtoolsServer | null = null

  afterEach(async () => {
    if (devtools) await devtools.close()
    else if (server) await new Promise<void>((r) => server!.close(() => r()))
    server = null
    devtools = null
  })

  async function start(host?: string): Promise<string> {
    return new Promise<string>((resolve) => {
      server = createServer()
      devtools = new DevtoolsServer({ server, host })
      attachDevtoolsRoutes(server, devtools, {
        loopbackOnly: host == null || host === '127.0.0.1',
      })
      server.listen(0, () => resolve(`http://127.0.0.1:${(server!.address() as { port: number }).port}`))
    })
  }

  it('GET /v1/traces with no Origin (curl/node) is allowed', async () => {
    const base = await start()
    const res = await fetch(`${base}/v1/traces`)
    expect(res.status).toBe(200)
  })

  it('GET /v1/traces with a loopback Origin (embedded widget) is allowed', async () => {
    const base = await start()
    const res = await fetch(`${base}/v1/traces`, {
      headers: { origin: 'http://localhost:3000' },
    })
    expect(res.status).toBe(200)
  })

  it('GET /v1/traces with a remote Origin is rejected (403)', async () => {
    const base = await start()
    const res = await fetch(`${base}/v1/traces`, {
      headers: { origin: 'https://evil.com' },
    })
    expect(res.status).toBe(403)
  })

  it('DELETE /v1/traces with a remote Origin is rejected (403)', async () => {
    const base = await start()
    const res = await fetch(`${base}/v1/traces`, {
      method: 'DELETE',
      headers: { origin: 'https://evil.com' },
    })
    expect(res.status).toBe(403)
  })

  it('POST ingestion stays open to any dev origin', async () => {
    const base = await start()
    const res = await fetch(`${base}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin: 'https://my-app.example.com' },
      body: JSON.stringify({ resourceSpans: [] }),
    })
    expect(res.status).toBe(200)
  })

  it('healthz stays open (identity probe)', async () => {
    const base = await start()
    const res = await fetch(`${base}/healthz`, { headers: { origin: 'https://evil.com' } })
    expect(res.status).toBe(200)
  })
})
