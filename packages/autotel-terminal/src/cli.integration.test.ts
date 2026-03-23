import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  countOtlpMetrics,
  parseOtlpEvents,
  parseOtlpLogEvents,
  readJsonBody,
  sendJson,
} from './otlp-http-json';
import { CliTerminalSpanStream } from './cli-stream';
import { getTerminalLogStream } from './log-stream';
import type { TerminalSpanEvent } from './span-stream';
import type { TerminalLogEvent } from './lib/log-model';

/**
 * Integration test: spins up the same HTTP handler used by the CLI
 * (without the Ink rendering) and verifies all OTLP endpoints end-to-end.
 */

const OTLP_ROUTES = new Set(['/v1/traces', '/v1/logs', '/v1/metrics']);

function createTestServer(
  spanStream: CliTerminalSpanStream,
): Server {
  const logStream = getTerminalLogStream();

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method !== 'POST' || !OTLP_ROUTES.has(req.url ?? '')) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    try {
      const payload = await readJsonBody(req);

      if (req.url === '/v1/traces') {
        const events = parseOtlpEvents(payload);
        for (const event of events) {
          spanStream.push(event);
        }
        sendJson(res, 200, { acceptedSpans: events.length });
        return;
      }

      if (req.url === '/v1/logs') {
        const events = parseOtlpLogEvents(payload);
        for (const event of events) {
          logStream.emit(event);
        }
        sendJson(res, 200, { acceptedLogs: events.length });
        return;
      }

      if (req.url === '/v1/metrics') {
        const count = countOtlpMetrics(payload);
        sendJson(res, 200, { acceptedMetrics: count });
        return;
      }
    } catch (error) {
      sendJson(res, 400, {
        error: 'Invalid OTLP JSON payload',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

async function postJson(
  port: number,
  path: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const data = JSON.stringify(body);
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: data,
  });
  const json = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body: json };
}

describe('CLI HTTP server integration', () => {
  let server: Server;
  let port: number;
  let spanStream: CliTerminalSpanStream;
  const collectedSpans: TerminalSpanEvent[] = [];
  const collectedLogs: TerminalLogEvent[] = [];

  beforeAll(async () => {
    spanStream = new CliTerminalSpanStream();
    spanStream.onSpanEnd((event) => collectedSpans.push(event));
    getTerminalLogStream().onLog((event) => collectedLogs.push(event));

    server = createTestServer(spanStream);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  // --- Health check ---

  it('GET /healthz returns ok', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
  });

  // --- 404 ---

  it('returns 404 for unknown routes', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/unknown`, {
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 for GET on OTLP routes', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/traces`);
    expect(res.status).toBe(404);
  });

  // --- /v1/traces ---

  it('POST /v1/traces accepts spans and streams them', async () => {
    const before = collectedSpans.length;
    const payload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 'aaaa0000000000000000000000000001',
                  spanId: 'bbbb000000000001',
                  name: 'integration-test-span',
                  startTimeUnixNano: '1700000000000000000',
                  endTimeUnixNano: '1700000000100000000',
                  status: { code: 1 },
                  kind: 2,
                  attributes: [
                    { key: 'test', value: { stringValue: 'true' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const res = await postJson(port, '/v1/traces', payload);
    expect(res.status).toBe(200);
    expect(res.body.acceptedSpans).toBe(1);
    expect(collectedSpans.length).toBe(before + 1);
    expect(collectedSpans.at(-1)?.name).toBe(
      'integration-test-span',
    );
  });

  it('POST /v1/traces returns 400 for invalid JSON', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe('Invalid OTLP JSON payload');
  });

  it('POST /v1/traces handles empty resourceSpans', async () => {
    const res = await postJson(port, '/v1/traces', { resourceSpans: [] });
    expect(res.status).toBe(200);
    expect(res.body.acceptedSpans).toBe(0);
  });

  // --- /v1/logs ---

  it('POST /v1/logs accepts logs and emits them', async () => {
    const before = collectedLogs.length;
    const payload = {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  timeUnixNano: '1700000000000000000',
                  severityNumber: 9,
                  severityText: 'INFO',
                  body: { stringValue: 'integration-test-log' },
                  traceId: 'aaaa0000000000000000000000000002',
                  spanId: 'bbbb000000000002',
                  attributes: [
                    { key: 'env', value: { stringValue: 'test' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const res = await postJson(port, '/v1/logs', payload);
    expect(res.status).toBe(200);
    expect(res.body.acceptedLogs).toBe(1);
    expect(collectedLogs.length).toBe(before + 1);
    expect(collectedLogs.at(-1)?.message).toBe(
      'integration-test-log',
    );
    expect(collectedLogs.at(-1)?.level).toBe('info');
  });

  it('POST /v1/logs handles empty payload', async () => {
    const res = await postJson(port, '/v1/logs', { resourceLogs: [] });
    expect(res.status).toBe(200);
    expect(res.body.acceptedLogs).toBe(0);
  });

  // --- /v1/metrics ---

  it('POST /v1/metrics accepts and counts metrics', async () => {
    const payload = {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                {
                  name: 'http.server.duration',
                  unit: 'ms',
                  histogram: {
                    dataPoints: [{ sum: 150, count: 3 }],
                  },
                },
                {
                  name: 'http.server.active_requests',
                  unit: '1',
                  gauge: {
                    dataPoints: [{ asInt: '5' }],
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const res = await postJson(port, '/v1/metrics', payload);
    expect(res.status).toBe(200);
    expect(res.body.acceptedMetrics).toBe(2);
  });

  it('POST /v1/metrics handles empty payload', async () => {
    const res = await postJson(port, '/v1/metrics', {
      resourceMetrics: [],
    });
    expect(res.status).toBe(200);
    expect(res.body.acceptedMetrics).toBe(0);
  });
});
