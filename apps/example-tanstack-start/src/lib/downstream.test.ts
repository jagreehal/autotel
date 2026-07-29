import http from 'node:http'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici'
import { instrument } from 'autotel-tanstack'
import {
  extractContextFromRequest,
  getCurrentTraceId,
} from 'autotel-tanstack/context'
import { trace } from 'autotel'
import { callDownstream, resolveDownstreamUrl } from './downstream'
import type { DownstreamReport } from './downstream'

// Mirrors src/instrumentation.ts: autotel + undici, as the running app has it.
instrument({
  service: 'downstream-test',
  instrumentations: [new UndiciInstrumentation()],
})

/** Stands in for the /demo/api/downstream route, doing what that handler does. */
let server: http.Server
let url: string
const receivedTraceparents: Array<string | undefined> = []

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const traceparent = req.headers.traceparent as string | undefined
    receivedTraceparents.push(traceparent)

    const request = new Request('http://downstream/api', {
      headers: traceparent ? { traceparent } : {},
    })
    // The app's request middleware continues the trace from this context.
    const joined = getCurrentTraceId(extractContextFromRequest(request)) ?? null

    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({ service: 'downstream-api', traceparent, traceId: joined }),
    )
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  url = `http://localhost:${(server.address() as { port: number }).port}/`
})

afterAll(() => server.close())

describe('callDownstream', () => {
  let callerTraceId: string | undefined
  let report: DownstreamReport

  beforeAll(async () => {
    await trace({ name: 'caller' }, async () => {
      callerTraceId = getCurrentTraceId()
      report = await callDownstream(url)
    })()
  })

  it('sends exactly one traceparent per request', () => {
    // Two comma-joined values is invalid W3C Trace Context and fails to parse.
    for (const traceparent of receivedTraceparents) {
      expect(traceparent).toBeDefined()
      expect(traceparent!.split(',')).toHaveLength(1)
    }
  })

  it('the downstream joins the caller trace', () => {
    expect(callerTraceId).toBeDefined()
    expect(report.traceId).toBe(callerTraceId)
  })
})

describe('resolveDownstreamUrl', () => {
  const env = { ...process.env }
  afterEach(() => {
    process.env = { ...env }
  })

  it('uses DOWNSTREAM_API_URL when configured', () => {
    process.env.DOWNSTREAM_API_URL = 'https://orders.internal/api/downstream'
    expect(resolveDownstreamUrl()).toBe('https://orders.internal/api/downstream')
  })

  it('falls back to the pinned dev port (package.json uses --strictPort)', () => {
    delete process.env.DOWNSTREAM_API_URL
    process.env.NODE_ENV = 'development'
    expect(resolveDownstreamUrl()).toBe(
      'http://localhost:3000/demo/api/downstream',
    )
  })

  it('has no default in production', () => {
    delete process.env.DOWNSTREAM_API_URL
    process.env.NODE_ENV = 'production'
    expect(resolveDownstreamUrl).toThrow(/DOWNSTREAM_API_URL/)
  })

  // The Host header is attacker-controlled. The resolver takes no arguments at
  // all, so no request value can reach the fetch target: SSRF is impossible by
  // construction rather than by filtering.
  it('accepts no caller-supplied input', () => {
    expect(resolveDownstreamUrl).toHaveLength(0)
  })
})
