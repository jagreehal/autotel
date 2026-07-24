import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:http'
import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type IdGenerator,
} from '@opentelemetry/sdk-trace-base'
import {
  LoggerProvider,
  InMemoryLogRecordExporter,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs'
import { ProtobufTraceSerializer, ProtobufLogsSerializer } from '@opentelemetry/otlp-transformer'
import * as protobuf from 'protobufjs'
import { DevtoolsServer } from '../server'
import { attachDevtoolsRoutes } from '../http'
import {
  decodeOtlpTraceRequest,
  decodeOtlpLogsRequest,
  decodeOtlpMetricsRequest,
} from '../otlp-proto'
import { parseOtlpTraces, parseOtlpLogs, countOtlpMetrics, isProtobufContentType } from '../otlp'

/**
 * Protobuf ingestion tests. The decisive guarantee for traces/logs is *interop*:
 * the bytes are produced by the real OpenTelemetry SDK + protobuf serializers — the
 * exact code path the Python/JS/Go SDKs use over `http/protobuf` — and then decoded
 * by our embedded schema. A wrong field number in our `.proto` drops the field and
 * fails the assertions. Metrics are encoded by an independently-authored protobufjs
 * schema, cross-checking the metric-counting field numbers against the OTLP spec.
 */

// Deterministic IDs so we can assert the exact hex the receiver surfaces, proving
// the bytes -> base64 -> hex normalisation path (16-byte trace ID, 8-byte span ID).
const TRACE_ID_HEX = '0102030405060708090a0b0c0d0e0f10'
const SPAN_ID_HEX = '1112131415161718'

const fixedIds: IdGenerator = {
  generateTraceId: () => TRACE_ID_HEX,
  generateSpanId: () => SPAN_ID_HEX,
}

const START_MS = 1_700_000_000_000
const END_MS = START_MS + 500

// Real OTel SDK span -> real OTLP/protobuf bytes.
function traceRequestBytes(): Buffer {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({
    idGenerator: fixedIds,
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })
  const span = provider.getTracer('test').startSpan('GET /orders', {
    kind: SpanKind.SERVER,
    startTime: START_MS,
    attributes: { 'http.method': 'GET' },
  })
  span.addEvent('cache.miss')
  span.setStatus({ code: SpanStatusCode.OK })
  span.end(END_MS)
  const bytes = ProtobufTraceSerializer.serializeRequest(exporter.getFinishedSpans())
  return Buffer.from(bytes!)
}

// Real OTel SDK log record -> real OTLP/protobuf bytes.
function logsRequestBytes(): Buffer {
  const exporter = new InMemoryLogRecordExporter()
  const provider = new LoggerProvider({ processors: [new SimpleLogRecordProcessor({ exporter })] })
  provider.getLogger('test').emit({
    severityNumber: 9, // INFO
    severityText: 'INFO',
    body: 'hello from protobuf',
    attributes: { 'log.source': 'unit-test' },
    timestamp: START_MS,
  })
  const bytes = ProtobufLogsSerializer.serializeRequest(exporter.getFinishedLogRecords())
  return Buffer.from(bytes!)
}

// Independently-authored protobuf encoder for the metrics envelope. Uses the canonical
// OTLP field numbers (resource_metrics=1, scope_metrics=2, metrics=2, name=1) so it
// cross-checks the structural field numbers our metric counter relies on.
function metricsRequestBytes(metricNames: string[]): Buffer {
  const { root } = protobuf.parse(
    `
    syntax = "proto3";
    package otlptest.metrics;
    message AnyValue { oneof value { string string_value = 1; } }
    message KeyValue { string key = 1; AnyValue value = 2; }
    message Resource { repeated KeyValue attributes = 1; }
    message Scope { string name = 1; }
    message Metric { string name = 1; }
    message ScopeMetrics { Scope scope = 1; repeated Metric metrics = 2; }
    message ResourceMetrics { Resource resource = 1; repeated ScopeMetrics scope_metrics = 2; }
    message ExportMetricsServiceRequest { repeated ResourceMetrics resource_metrics = 1; }
    `,
    { keepCase: false },
  )
  const RequestType = root.lookupType('otlptest.metrics.ExportMetricsServiceRequest')
  const message = RequestType.create({
    resourceMetrics: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'metric-svc' } }] },
        scopeMetrics: [{ scope: { name: 'm' }, metrics: metricNames.map((name) => ({ name })) }],
      },
    ],
  })
  return Buffer.from(RequestType.encode(message).finish())
}

describe('isProtobufContentType', () => {
  it('recognises protobuf content types and rejects others', () => {
    expect(isProtobufContentType('application/x-protobuf')).toBe(true)
    expect(isProtobufContentType('application/protobuf')).toBe(true)
    expect(isProtobufContentType('application/x-protobuf; charset=utf-8')).toBe(true)
    expect(isProtobufContentType('application/json')).toBe(false)
    expect(isProtobufContentType(undefined)).toBe(false)
  })
})

describe('decode OTLP/protobuf produced by the real OpenTelemetry SDK', () => {
  it('decodes a trace request into the same shape parseOtlpTraces consumes', () => {
    const traces = parseOtlpTraces(decodeOtlpTraceRequest(traceRequestBytes()))

    expect(traces).toHaveLength(1)
    expect(traces[0].traceId).toBe(TRACE_ID_HEX)
    expect(traces[0].spans).toHaveLength(1)

    const span = traces[0].spans[0]
    expect(span.spanId).toBe(SPAN_ID_HEX)
    expect(span.name).toBe('GET /orders')
    expect(span.kind).toBe('SERVER')
    expect(span.duration).toBe(500) // 0.5s in ms
    expect(span.status.code).toBe('OK')
    expect(span.attributes['http.method']).toBe('GET')
    expect(span.events[0].name).toBe('cache.miss')
  })

  it('decodes a logs request into the same shape parseOtlpLogs consumes', () => {
    const logs = parseOtlpLogs(decodeOtlpLogsRequest(logsRequestBytes()))

    expect(logs).toHaveLength(1)
    expect(logs[0].body).toBe('hello from protobuf')
    expect(logs[0].severityNumber).toBe(9)
    expect(logs[0].severityText).toBe('INFO')
    expect(logs[0].attributes['log.source']).toBe('unit-test')
  })

  it('counts metrics in a protobuf metrics request', () => {
    const payload = decodeOtlpMetricsRequest(metricsRequestBytes(['requests_total', 'errors_total']))
    expect(countOtlpMetrics(payload)).toBe(2)
  })
})

describe('HTTP ingestion of OTLP/protobuf (Content-Type: application/x-protobuf)', () => {
  let server: Server | null = null
  let devtools: DevtoolsServer | null = null

  afterEach(async () => {
    if (devtools) await devtools.close()
    else if (server) await new Promise<void>((r) => server!.close(() => r()))
    server = null
    devtools = null
  })

  async function start(): Promise<string> {
    const port = await new Promise<number>((resolve) => {
      server = createServer()
      devtools = new DevtoolsServer({ server })
      attachDevtoolsRoutes(server, devtools)
      server.listen(0, () => resolve((server!.address() as { port: number }).port))
    })
    return `http://127.0.0.1:${port}`
  }

  function postProtobuf(base: string, path: string, body: Buffer) {
    return fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-protobuf' },
      body,
    })
  }

  it('accepts a protobuf trace POST and reads it back over HTTP', async () => {
    const base = await start()

    const res = await postProtobuf(base, '/v1/traces', traceRequestBytes())
    expect(res.status).toBe(200)
    expect((await res.json()).acceptedTraces).toBe(1)

    const readBack = await (await fetch(`${base}/v1/traces`)).json()
    expect(readBack.count).toBe(1)
    expect(readBack.traces[0].traceId).toBe(TRACE_ID_HEX)
    expect(readBack.traces[0].spans[0].name).toBe('GET /orders')
  })

  it('accepts protobuf logs and metrics POSTs', async () => {
    const base = await start()

    const logsRes = await postProtobuf(base, '/v1/logs', logsRequestBytes())
    expect(logsRes.status).toBe(200)
    expect((await logsRes.json()).acceptedLogs).toBe(1)

    const metricsRes = await postProtobuf(base, '/v1/metrics', metricsRequestBytes(['a', 'b', 'c']))
    expect(metricsRes.status).toBe(200)
    expect((await metricsRes.json()).acceptedMetrics).toBe(3)
  })

  it('still accepts OTLP/JSON on the same endpoint (content-type drives decoding)', async () => {
    const base = await start()

    const res = await fetch(`${base}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resourceSpans: [
          {
            resource: { attributes: [{ key: 'service.name', value: { stringValue: 'json-svc' } }] },
            scopeSpans: [
              {
                scope: {},
                spans: [
                  { traceId: 'jsontrace', spanId: 'jsonspan', name: 'json-span', kind: 1, startTimeUnixNano: '0', endTimeUnixNano: '1000000', status: { code: 0 } },
                ],
              },
            ],
          },
        ],
      }),
    })
    expect(res.status).toBe(200)

    const readBack = await (await fetch(`${base}/v1/traces`)).json()
    expect(readBack.traces[0].service).toBe('json-svc')
  })

  it('returns 400 when a protobuf body is mislabelled as JSON', async () => {
    const base = await start()
    const res = await fetch(`${base}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: traceRequestBytes(), // binary protobuf, but claimed to be JSON
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid OTLP payload')
  })
})
