import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OtlpReceiver } from '../src/backends/collector/receiver.js';
import { CollectorStore } from '../src/backends/collector/store.js';

describe('OtlpReceiver', () => {
  let store: CollectorStore;
  let receiver: OtlpReceiver;
  const port = 14318;

  beforeEach(async () => {
    store = new CollectorStore({ maxTraces: 100, retentionMs: 3_600_000 });
    await store.init();
    receiver = new OtlpReceiver(store, port);
    await receiver.start();
  });

  afterEach(async () => {
    await receiver.stop();
  });

  it('accepts trace spans via POST /v1/traces', async () => {
    const traceIdHex = 'abcd1234abcd1234abcd1234abcd1234';
    const spanIdHex = 'abcd1234abcd1234';
    const body = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'test-svc' } },
            ],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: traceIdHex,
                  spanId: spanIdHex,
                  name: 'GET /test',
                  startTimeUnixNano: String(Date.now() * 1_000_000),
                  endTimeUnixNano: String((Date.now() + 100) * 1_000_000),
                  status: { code: 1 },
                },
              ],
            },
          ],
        },
      ],
    };

    const res = await fetch(`http://127.0.0.1:${port}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);

    const trace = await store.getTrace(traceIdHex);
    expect(trace).not.toBeNull();
    expect(trace!.spans[0].operationName).toBe('GET /test');
    expect(trace!.spans[0].serviceName).toBe('test-svc');
  });

  it('returns 404 for unknown paths', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/unknown`);
    expect(res.status).toBe(404);
  });

  it('accepts log records via POST /v1/logs', async () => {
    const traceIdHex = 'abcd1234abcd1234abcd1234abcd1234';
    const body = {
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'test-svc' } },
            ],
          },
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: String(Date.now() * 1_000_000),
                  severityText: 'ERROR',
                  body: { stringValue: 'something broke' },
                  traceId: traceIdHex,
                },
              ],
            },
          ],
        },
      ],
    };

    const res = await fetch(`http://127.0.0.1:${port}/v1/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(200);

    const logs = await store.searchLogs({ traceId: traceIdHex });
    expect(logs.items).toHaveLength(1);
    expect(logs.items[0].body).toBe('something broke');
  });
});
