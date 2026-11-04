import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeOtlpRequest, type OtlpJson } from 'autotel-devtools/otlp-proto';
import { OtlpReceiver } from '../src/backends/collector/receiver';
import { CollectorStore } from '../src/backends/collector/store';

const TRACE_ID = 'abcd1234abcd1234abcd1234abcd1234';
const SPAN_ID = 'abcd1234abcd1234';
const PARENT_ID = '1234abcd1234abcd';
const NOW_NANOS = `${Date.now()}000000`;
const resource: OtlpJson = {
  attributes: [{ key: 'service.name', value: { stringValue: 'proto-svc' } }],
};

const traces: OtlpJson = {
  resourceSpans: [
    {
      resource,
      scopeSpans: [
        {
          spans: [
            {
              traceId: TRACE_ID,
              spanId: SPAN_ID,
              parentSpanId: PARENT_ID,
              name: 'GET /orders/{id}',
              kind: 2,
              startTimeUnixNano: NOW_NANOS,
              endTimeUnixNano: NOW_NANOS,
              attributes: [
                { key: 'http.route', value: { stringValue: '/orders/{id}' } },
                { key: 'http.status', value: { intValue: '200' } },
              ],
              status: { code: 2 },
            },
          ],
        },
      ],
    },
  ],
};

describe('OtlpReceiver over OTLP/protobuf', () => {
  let store: CollectorStore;
  let receiver: OtlpReceiver;
  let url: string;

  const post = (path: string, body: RequestInit['body'], contentType: string) =>
    fetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': contentType },
      body,
    });

  beforeEach(async () => {
    store = new CollectorStore({ maxTraces: 100, retentionMs: 3_600_000 });
    await store.init();
    receiver = new OtlpReceiver(store, 0);
    await receiver.start();
    url = `http://127.0.0.1:${receiver.getPort()}`;
  });

  afterEach(async () => {
    await receiver.stop();
  });

  it('stores a protobuf span the same as its JSON twin, ids and attributes included', async () => {
    const res = await post(
      '/v1/traces',
      encodeOtlpRequest('traces', traces),
      'application/x-protobuf',
    );

    expect(res.status).toBe(200);
    const trace = await store.getTrace(TRACE_ID);
    const span = trace?.spans[0];
    expect(span?.spanId).toBe(SPAN_ID);
    expect(span?.parentSpanId).toBe(PARENT_ID);
    expect(span?.serviceName).toBe('proto-svc');
    expect(span?.operationName).toBe('GET /orders/{id}');
    expect(span?.tags['http.route']).toBe('/orders/{id}');
    expect(span?.hasError).toBe(true);
  });

  it('answers protobuf in protobuf: an empty response is zero bytes, not "{}"', async () => {
    const res = await post(
      '/v1/traces',
      encodeOtlpRequest('traces', traces),
      'application/x-protobuf',
    );

    expect(res.headers.get('content-type')).toBe('application/x-protobuf');
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  it('still answers JSON in JSON', async () => {
    const res = await post(
      '/v1/traces',
      JSON.stringify(traces),
      'application/json',
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.json()).toEqual({});
  });

  it('accepts the other spelling, application/protobuf', async () => {
    const res = await post(
      '/v1/traces',
      encodeOtlpRequest('traces', traces),
      'application/protobuf',
    );

    expect(res.status).toBe(200);
    expect(await store.getTrace(TRACE_ID)).not.toBeNull();
  });

  it('decodes metric data points, not only the envelope', async () => {
    const metrics: OtlpJson = {
      resourceMetrics: [
        {
          resource,
          scopeMetrics: [
            {
              metrics: [
                {
                  name: 'queue.depth',
                  gauge: {
                    dataPoints: [{ asDouble: 7.5, timeUnixNano: NOW_NANOS }],
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const res = await post(
      '/v1/metrics',
      encodeOtlpRequest('metrics', metrics),
      'application/x-protobuf',
    );

    expect(res.status).toBe(200);
    const series = await store.getMetricSeries('queue.depth');
    expect(series[0]?.points[0]?.value).toBe(7.5);
  });

  it('reports a histogram point as its mean', async () => {
    const metrics: OtlpJson = {
      resourceMetrics: [
        {
          resource,
          scopeMetrics: [
            {
              metrics: [
                {
                  name: 'request.duration',
                  histogram: {
                    dataPoints: [
                      { sum: 3, count: '4', timeUnixNano: NOW_NANOS },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    await post(
      '/v1/metrics',
      encodeOtlpRequest('metrics', metrics),
      'application/x-protobuf',
    );

    const series = await store.getMetricSeries('request.duration');
    expect(series[0]?.points[0]?.value).toBe(0.75);
  });

  const logWith = (record: { [key: string]: OtlpJson }): OtlpJson => ({
    resourceLogs: [
      {
        resource,
        scopeLogs: [
          {
            logRecords: [
              {
                timeUnixNano: NOW_NANOS,
                body: { stringValue: 'paid' },
                ...record,
              },
            ],
          },
        ],
      },
    ],
  });

  it('keeps the event name a log record carries, over protobuf and JSON', async () => {
    const logs = logWith({ eventName: 'order.paid' });

    await post(
      '/v1/logs',
      encodeOtlpRequest('logs', logs),
      'application/x-protobuf',
    );
    await post('/v1/logs', JSON.stringify(logs), 'application/json');

    const found = await store.searchLogs({ serviceName: 'proto-svc' });
    expect(found.items).toHaveLength(2);
    for (const log of found.items) {
      expect(log.attributes?.['event.name']).toBe('order.paid');
    }
  });

  it('lets an explicit event.name attribute win over the field', async () => {
    const logs = logWith({
      eventName: 'from.field',
      attributes: [
        { key: 'event.name', value: { stringValue: 'from.attribute' } },
      ],
    });

    await post('/v1/logs', JSON.stringify(logs), 'application/json');

    const found = await store.searchLogs({ serviceName: 'proto-svc' });
    expect(found.items[0]?.attributes?.['event.name']).toBe('from.attribute');
  });

  it('keeps a log linked to its trace', async () => {
    const logs: OtlpJson = {
      resourceLogs: [
        {
          resource,
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: NOW_NANOS,
                  severityNumber: 9,
                  severityText: 'INFO',
                  body: { stringValue: 'loading order' },
                  traceId: TRACE_ID,
                  spanId: SPAN_ID,
                },
              ],
            },
          ],
        },
      ],
    };

    const res = await post(
      '/v1/logs',
      encodeOtlpRequest('logs', logs),
      'application/x-protobuf',
    );

    expect(res.status).toBe(200);
    const found = await store.searchLogs({ serviceName: 'proto-svc' });
    expect(found.items[0]?.body).toBe('loading order');
    expect(found.items[0]?.traceId).toBe(TRACE_ID);
  });

  it('answers a bad protobuf body with a google.rpc.Status, not JSON', async () => {
    const res = await post(
      '/v1/traces',
      new Uint8Array([0xff, 0xff, 0xff]),
      'application/x-protobuf',
    );

    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toBe('application/x-protobuf');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes[0]).toBe((2 << 3) | 2); // field 2 of Status, length-delimited
  });

  const gzipped = (body: Uint8Array | string, type: string) =>
    fetch(`${url}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': type, 'Content-Encoding': 'gzip' },
      body: new Uint8Array(gzipSync(body)),
    });

  it.each([
    ['protobuf', encodeOtlpRequest('traces', traces), 'application/x-protobuf'],
    ['JSON', JSON.stringify(traces), 'application/json'],
  ])('accepts gzip on %s, as the Collector sends it', async (_, body, type) => {
    const res = await gzipped(body, type);

    expect(res.status).toBe(200);
    expect(await store.getTrace(TRACE_ID)).not.toBeNull();
  });

  it('refuses a corrupt gzip body', async () => {
    const res = await fetch(`${url}/v1/traces`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
      },
      body: 'not gzip',
    });

    expect(res.status).toBe(400);
  });

  it.each([
    ['protobuf', new Uint8Array([0xff, 0xff, 0xff]), 'application/x-protobuf'],
    ['JSON', '{not json', 'application/json'],
  ])('rejects malformed %s as the sender’s fault', async (_, body, type) => {
    const res = await post('/v1/traces', body, type);

    expect(res.status).toBe(400);
  });
});
