import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
  type IdGenerator,
} from '@opentelemetry/sdk-trace-base';
import {
  LoggerProvider,
  InMemoryLogRecordExporter,
  SimpleLogRecordProcessor,
} from '@opentelemetry/sdk-logs';
import {
  ProtobufTraceSerializer,
  ProtobufLogsSerializer,
} from '@opentelemetry/otlp-transformer';
import * as protobuf from 'protobufjs';
import { DevtoolsServer } from '../server';
import { attachDevtoolsRoutes } from '../http';
import {
  decodeOtlpTraceRequest,
  decodeOtlpLogsRequest,
  decodeOtlpMetricsRequest,
  isProtobufContentType,
} from '../otlp-proto';
import { parseOtlpTraces, parseOtlpLogs, countOtlpMetrics } from '../otlp';
import { parseOtlpMetricStreams } from '../metric-streams';

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
const TRACE_ID_HEX = '0102030405060708090a0b0c0d0e0f10';
const SPAN_ID_HEX = '1112131415161718';

const fixedIds: IdGenerator = {
  generateTraceId: () => TRACE_ID_HEX,
  generateSpanId: () => SPAN_ID_HEX,
};

const START_MS = 1_700_000_000_000;
const END_MS = START_MS + 500;

// Real OTel SDK span -> real OTLP/protobuf bytes.
function traceRequestBytes(): Buffer {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    idGenerator: fixedIds,
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const span = provider.getTracer('test').startSpan('GET /orders', {
    kind: SpanKind.SERVER,
    startTime: START_MS,
    attributes: { 'http.method': 'GET' },
  });
  span.addEvent('cache.miss');
  span.setStatus({ code: SpanStatusCode.OK });
  span.end(END_MS);
  const bytes = ProtobufTraceSerializer.serializeRequest(
    exporter.getFinishedSpans(),
  );
  return Buffer.from(bytes!);
}

// Real OTel SDK log record -> real OTLP/protobuf bytes.
function logsRequestBytes(): Buffer {
  const exporter = new InMemoryLogRecordExporter();
  const provider = new LoggerProvider({
    processors: [new SimpleLogRecordProcessor({ exporter })],
  });
  provider.getLogger('test').emit({
    severityNumber: 9, // INFO
    severityText: 'INFO',
    body: 'hello from protobuf',
    attributes: { 'log.source': 'unit-test' },
    timestamp: START_MS,
  });
  const bytes = ProtobufLogsSerializer.serializeRequest(
    exporter.getFinishedLogRecords(),
  );
  return Buffer.from(bytes!);
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
  );
  const RequestType = root.lookupType(
    'otlptest.metrics.ExportMetricsServiceRequest',
  );
  const message = RequestType.create({
    resourceMetrics: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'metric-svc' } },
          ],
        },
        scopeMetrics: [
          {
            scope: { name: 'm' },
            metrics: metricNames.map((name) => ({ name })),
          },
        ],
      },
    ],
  });
  return Buffer.from(RequestType.encode(message).finish());
}

function exponentialHistogramRequestBytes(): Buffer {
  const { root } = protobuf.parse(
    `
    syntax = "proto3";
    package otlptest.metrics;
    message Buckets { sint32 offset = 1; repeated uint64 bucket_counts = 2; }
    message Point {
      fixed64 time_unix_nano = 3;
      fixed64 count = 4;
      double sum = 5;
      sint32 scale = 6;
      fixed64 zero_count = 7;
      Buckets positive = 8;
      Buckets negative = 9;
      double zero_threshold = 14;
    }
    message ExponentialHistogram { repeated Point data_points = 1; int32 aggregation_temporality = 2; }
    message Metric { string name = 1; oneof data { ExponentialHistogram exponential_histogram = 10; } }
    message ScopeMetrics { repeated Metric metrics = 2; }
    message ResourceMetrics { repeated ScopeMetrics scope_metrics = 2; }
    message ExportMetricsServiceRequest { repeated ResourceMetrics resource_metrics = 1; }
    `,
    { keepCase: false },
  );
  const RequestType = root.lookupType(
    'otlptest.metrics.ExportMetricsServiceRequest',
  );
  const message = RequestType.create({
    resourceMetrics: [
      {
        scopeMetrics: [
          {
            metrics: [
              {
                name: 'rpc.duration',
                exponentialHistogram: {
                  aggregationTemporality: 2,
                  dataPoints: [
                    {
                      timeUnixNano: String(BigInt(START_MS) * 1_000_000n),
                      count: '7',
                      sum: 12,
                      scale: 2,
                      zeroCount: '1',
                      zeroThreshold: 0.001,
                      positive: { offset: -1, bucketCounts: [2, 3] },
                      negative: { offset: 0, bucketCounts: [1] },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  });
  return Buffer.from(RequestType.encode(message).finish());
}

describe('isProtobufContentType', () => {
  it('recognises protobuf content types and rejects others', () => {
    expect(isProtobufContentType('application/x-protobuf')).toBe(true);
    expect(isProtobufContentType('application/protobuf')).toBe(true);
    expect(isProtobufContentType('application/x-protobuf; charset=utf-8')).toBe(
      true,
    );
    expect(isProtobufContentType('application/json')).toBe(false);
    expect(isProtobufContentType(undefined)).toBe(false);
  });
});

describe('decode OTLP/protobuf produced by the real OpenTelemetry SDK', () => {
  it('decodes a trace request into the same shape parseOtlpTraces consumes', () => {
    const traces = parseOtlpTraces(decodeOtlpTraceRequest(traceRequestBytes()));

    expect(traces).toHaveLength(1);
    expect(traces[0].traceId).toBe(TRACE_ID_HEX);
    expect(traces[0].spans).toHaveLength(1);

    const span = traces[0].spans[0];
    expect(span.spanId).toBe(SPAN_ID_HEX);
    expect(span.name).toBe('GET /orders');
    expect(span.kind).toBe('SERVER');
    expect(span.duration).toBe(500); // 0.5s in ms
    expect(span.status.code).toBe('OK');
    expect(span.attributes['http.method']).toBe('GET');
    expect(span.events![0].name).toBe('cache.miss');
  });

  it('decodes a logs request into the same shape parseOtlpLogs consumes', () => {
    const logs = parseOtlpLogs(decodeOtlpLogsRequest(logsRequestBytes()));

    expect(logs).toHaveLength(1);
    expect(logs[0].body).toBe('hello from protobuf');
    expect(logs[0].severityNumber).toBe(9);
    expect(logs[0].severityText).toBe('INFO');
    expect(logs[0].attributes!['log.source']).toBe('unit-test');
  });

  it('counts metrics in a protobuf metrics request', () => {
    const payload = decodeOtlpMetricsRequest(
      metricsRequestBytes(['requests_total', 'errors_total']),
    );
    expect(countOtlpMetrics(payload)).toBe(2);
  });

  it('preserves protobuf exponential histogram buckets', () => {
    const decoded = decodeOtlpMetricsRequest(
      exponentialHistogramRequestBytes(),
    );
    expect(JSON.stringify(decoded)).toContain('zeroCount');
    const [stream] = parseOtlpMetricStreams(decoded);
    expect(stream.kind).toBe('exponentialHistogram');
    expect(stream.points[0]).toMatchObject({
      scale: 2,
      zeroCount: 1,
      zeroThreshold: 0.001,
      positive: { offset: -1, bucketCounts: [2, 3] },
      negative: { offset: 0, bucketCounts: [1] },
    });
  });
});

describe('HTTP ingestion of OTLP/protobuf (Content-Type: application/x-protobuf)', () => {
  let server: Server | null = null;
  let devtools: DevtoolsServer | null = null;

  afterEach(async () => {
    if (devtools) await devtools.close();
    else if (server) await new Promise<void>((r) => server!.close(() => r()));
    server = null;
    devtools = null;
  });

  async function start(): Promise<string> {
    const port = await new Promise<number>((resolve) => {
      server = createServer();
      devtools = new DevtoolsServer({ server });
      attachDevtoolsRoutes(server, devtools);
      server.listen(0, '127.0.0.1', () =>
        resolve((server!.address() as { port: number }).port),
      );
    });
    return `http://127.0.0.1:${port}`;
  }

  function postProtobuf(base: string, path: string, body: Buffer) {
    return fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-protobuf' },
      body: new Uint8Array(body),
    });
  }

  it('accepts a protobuf trace POST and reads it back over HTTP', async () => {
    const base = await start();

    const res = await postProtobuf(base, '/v1/traces', traceRequestBytes());
    expect(res.status).toBe(200);

    const readBack = await (await fetch(`${base}/v1/traces`)).json();
    expect(readBack.count).toBe(1);
    expect(readBack.traces[0].traceId).toBe(TRACE_ID_HEX);
    expect(readBack.traces[0].spans[0].name).toBe('GET /orders');
  });

  it('accepts protobuf logs and metrics POSTs', async () => {
    const base = await start();

    const logsRes = await postProtobuf(base, '/v1/logs', logsRequestBytes());
    expect(logsRes.status).toBe(200);
    const stats = await (await fetch(`${base}/api/stats`)).json();
    expect(stats.logCount).toBe(1);

    const metricsRes = await postProtobuf(
      base,
      '/v1/metrics',
      metricsRequestBytes(['a', 'b', 'c']),
    );
    expect(metricsRes.status).toBe(200);
  });

  it('answers protobuf in protobuf: an empty response is zero bytes', async () => {
    const base = await start();

    const res = await postProtobuf(base, '/v1/traces', traceRequestBytes());

    expect(res.headers.get('content-type')).toBe('application/x-protobuf');
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  it('reports a bad protobuf body as a google.rpc.Status, not JSON', async () => {
    const base = await start();

    const res = await postProtobuf(
      base,
      '/v1/traces',
      Buffer.from([0xff, 0xff, 0xff]),
    );

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/x-protobuf');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes[0]).toBe((2 << 3) | 2); // field 2 of Status, length-delimited
    expect(bytes.toString()).toContain('Invalid OTLP payload');
  });

  it('accepts gzip on protobuf, as the Collector sends it', async () => {
    const base = await start();

    const res = await fetch(`${base}/v1/traces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-protobuf',
        'Content-Encoding': 'gzip',
      },
      body: new Uint8Array(gzipSync(traceRequestBytes())),
    });

    expect(res.status).toBe(200);
    const readBack = await (await fetch(`${base}/v1/traces`)).json();
    expect(readBack.traces[0].traceId).toBe(TRACE_ID_HEX);
  });

  it('accepts gzip on JSON and still counts it', async () => {
    const base = await start();

    const res = await fetch(`${base}/v1/traces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'GZIP',
      },
      body: new Uint8Array(gzipSync('{"resourceSpans":[]}')),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).acceptedTraces).toBe(0);
  });

  it.each([
    ['corrupt', Buffer.from('not gzip')],
    // Valid JSON once inflated, so that only the size limit can refuse it.
    [
      'oversized',
      gzipSync(`{"resourceSpans":[]}${' '.repeat(65 * 1024 * 1024)}`),
    ],
  ])('refuses a %s gzip body', async (_, body) => {
    const base = await start();

    const res = await fetch(`${base}/v1/traces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
      },
      body: new Uint8Array(body),
    });

    expect(res.status).toBe(400);
  });

  it('still accepts OTLP/JSON on the same endpoint (content-type drives decoding)', async () => {
    const base = await start();

    const res = await fetch(`${base}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'json-svc' } },
              ],
            },
            scopeSpans: [
              {
                scope: {},
                spans: [
                  {
                    traceId: 'jsontrace',
                    spanId: 'jsonspan',
                    name: 'json-span',
                    kind: 1,
                    startTimeUnixNano: '0',
                    endTimeUnixNano: '1000000',
                    status: { code: 0 },
                  },
                ],
              },
            ],
          },
        ],
      }),
    });
    expect(res.status).toBe(200);

    const readBack = await (await fetch(`${base}/v1/traces`)).json();
    expect(readBack.traces[0].service).toBe('json-svc');
  });

  it('returns 400 when a protobuf body is mislabelled as JSON', async () => {
    const base = await start();
    const res = await fetch(`${base}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: new Uint8Array(traceRequestBytes()), // binary protobuf, but claimed to be JSON
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid OTLP payload');
  });
});

describe('log event names', () => {
  /** ExportLogsServiceRequest with one record, written by hand from logs.proto. */
  function logWithEventName(name: string) {
    const nested = (field: number, bytes: Uint8Array) =>
      protobuf.Writer.create()
        .uint32((field << 3) | 2)
        .bytes(bytes)
        .finish();
    const record = protobuf.Writer.create()
      .uint32((12 << 3) | 2)
      .string(name)
      .finish();
    return nested(1, nested(2, nested(2, record)));
  }

  it('reads event_name off the wire', () => {
    const decoded = decodeOtlpLogsRequest(logWithEventName('order.paid'));

    expect(JSON.stringify(decoded)).toContain('"eventName":"order.paid"');
    expect(parseOtlpLogs(decoded)[0]?.attributes?.['event.name']).toBe(
      'order.paid',
    );
  });

  it('lets an explicit event.name attribute win over the field', () => {
    const logs = parseOtlpLogs({
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  eventName: 'from.field',
                  attributes: [
                    {
                      key: 'event.name',
                      value: { stringValue: 'from.attribute' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(logs[0]?.attributes?.['event.name']).toBe('from.attribute');
  });
});

/**
 * Written by hand from the OTLP protos: a round trip through our own schema
 * would agree with itself.
 */
describe('metric data points on the wire, as exporters write them', () => {
  type Build = (writer: protobuf.Writer) => void;
  const message = (build: Build) => {
    const writer = protobuf.Writer.create();
    build(writer);
    return writer.finish();
  };
  const nested = (writer: protobuf.Writer, field: number, bytes: Uint8Array) =>
    writer.uint32((field << 3) | 2).bytes(bytes);
  const fixed64 = (writer: protobuf.Writer, field: number, value: number) =>
    writer.uint32((field << 3) | 1).fixed64(value);
  const double = (writer: protobuf.Writer, field: number, value: number) =>
    writer.uint32((field << 3) | 1).double(value);

  /** ExportMetricsServiceRequest holding one metric with one data point. */
  function request(metricField: number, point: Build) {
    const data = message((w) => nested(w, 1, message(point)));
    const metric = message((w) => nested(w, metricField, data));
    const scope = message((w) => nested(w, 2, metric));
    const resource = message((w) => nested(w, 2, scope));
    return message((w) => nested(w, 1, resource));
  }

  function decodedPoint(bytes: Uint8Array, kind: string) {
    // SAFETY: `request` above writes exactly this nesting.
    const decoded = decodeOtlpMetricsRequest(bytes) as {
      resourceMetrics: Array<{
        scopeMetrics: Array<{
          metrics: Array<Record<string, { dataPoints: Array<unknown> }>>;
        }>;
      }>;
    };
    const metric = decoded.resourceMetrics[0]?.scopeMetrics[0]?.metrics[0];
    return metric?.[kind]?.dataPoints[0];
  }

  it('reads a histogram: fixed64 count and buckets, then the sum after them', () => {
    const bytes = request(9, (w) => {
      fixed64(w, 4, 4);
      double(w, 5, 3);
      w.uint32((6 << 3) | 2).fork();
      w.fixed64(1).fixed64(3);
      w.ldelim();
    });

    expect(decodedPoint(bytes, 'histogram')).toEqual({
      count: '4',
      sum: 3,
      bucketCounts: ['1', '3'],
    });
  });

  it('reads an exponential histogram: fixed64 count and zero count', () => {
    const bytes = request(10, (w) => {
      fixed64(w, 4, 4);
      double(w, 5, 3);
      fixed64(w, 7, 2);
    });

    expect(decodedPoint(bytes, 'exponentialHistogram')).toEqual({
      count: '4',
      sum: 3,
      zeroCount: '2',
    });
  });

  it('reads a summary: fixed64 count', () => {
    const bytes = request(11, (w) => {
      fixed64(w, 4, 4);
      double(w, 5, 3);
    });

    expect(decodedPoint(bytes, 'summary')).toEqual({ count: '4', sum: 3 });
  });
});
