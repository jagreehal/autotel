import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import {
  parseOtlpEvents,
  parseOtlpLogEvents,
  countOtlpMetrics,
  otlpSpanToTerminalEvent,
  readJsonBody,
  sendJson,
} from './otlp-http-json';

// --- parseOtlpEvents (traces) ---

describe('parseOtlpEvents', () => {
  it('parses a minimal OTLP trace payload', () => {
    const payload = {
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 'abcdef1234567890abcdef1234567890',
                  spanId: '1234567890abcdef',
                  name: 'GET /users',
                  startTimeUnixNano: '1700000000000000000',
                  endTimeUnixNano: '1700000000050000000',
                  status: { code: 1 },
                  kind: 2,
                  attributes: [
                    { key: 'http.method', value: { stringValue: 'GET' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const events = parseOtlpEvents(payload);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('GET /users');
    expect(events[0].traceId).toBe('abcdef1234567890abcdef1234567890');
    expect(events[0].spanId).toBe('1234567890abcdef');
    expect(events[0].status).toBe('OK');
    expect(events[0].kind).toBe('SERVER');
    expect(events[0].durationMs).toBeCloseTo(50, 0);
    expect(events[0].attributes).toEqual({ 'http.method': 'GET' });
  });

  it('handles multiple spans across multiple resources', () => {
    const payload = {
      resourceSpans: [
        {
          scopeSpans: [
            { spans: [{ name: 'span-1' }] },
            { spans: [{ name: 'span-2' }] },
          ],
        },
        {
          scopeSpans: [{ spans: [{ name: 'span-3' }] }],
        },
      ],
    };

    const events = parseOtlpEvents(payload);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.name)).toEqual(['span-1', 'span-2', 'span-3']);
  });

  it('returns empty array for empty or invalid payload', () => {
    expect(parseOtlpEvents(null)).toEqual([]);
    expect(parseOtlpEvents({})).toEqual([]);
    expect(parseOtlpEvents({ resourceSpans: [] })).toEqual([]);
    expect(parseOtlpEvents('not an object')).toEqual([]);
  });

  it('handles missing span fields gracefully', () => {
    const payload = {
      resourceSpans: [{ scopeSpans: [{ spans: [{}] }] }],
    };

    const events = parseOtlpEvents(payload);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('unnamed');
    expect(events[0].status).toBe('UNSET');
    expect(events[0].kind).toBe('INTERNAL');
  });

  it('extracts service.name from resource attributes', () => {
    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'my-api' } },
              { key: 'service.version', value: { stringValue: '1.0.0' } },
            ],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: 'abcdef1234567890abcdef1234567890',
                  spanId: '1234567890abcdef',
                  name: 'GET /users',
                  startTimeUnixNano: '1700000000000000000',
                  endTimeUnixNano: '1700000000050000000',
                  status: { code: 1 },
                  kind: 2,
                  attributes: [
                    { key: 'http.method', value: { stringValue: 'GET' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const events = parseOtlpEvents(payload);
    expect(events).toHaveLength(1);
    expect(events[0].attributes?.['service.name']).toBe('my-api');
    expect(events[0].attributes?.['service.version']).toBe('1.0.0');
    expect(events[0].attributes?.['http.method']).toBe('GET');
  });

  it('parses span events from OTLP payload', () => {
    const payload = {
      resourceSpans: [{
        scopeSpans: [{
          spans: [{
            traceId: 'abcdef1234567890abcdef1234567890',
            spanId: '1234567890abcdef',
            name: 'GET /users',
            startTimeUnixNano: '1700000000000000000',
            endTimeUnixNano: '1700000000050000000',
            events: [
              {
                timeUnixNano: '1700000000025000000',
                name: 'exception',
                attributes: [
                  { key: 'exception.message', value: { stringValue: 'not found' } },
                ],
              },
            ],
          }],
        }],
      }],
    };

    const events = parseOtlpEvents(payload);
    expect(events[0].events).toHaveLength(1);
    expect(events[0].events![0].name).toBe('exception');
    expect(events[0].events![0].timeMs).toBeCloseTo(1_700_000_000_025, 0);
    expect(events[0].events![0].attributes).toEqual({ 'exception.message': 'not found' });
  });

  it('parses span links from OTLP payload', () => {
    const payload = {
      resourceSpans: [{
        scopeSpans: [{
          spans: [{
            name: 'consumer',
            links: [
              {
                traceId: 'aaaa0000000000000000000000000001',
                spanId: 'bbbb000000000001',
                attributes: [
                  { key: 'link.type', value: { stringValue: 'parent' } },
                ],
              },
            ],
          }],
        }],
      }],
    };

    const events = parseOtlpEvents(payload);
    expect(events[0].links).toHaveLength(1);
    expect(events[0].links![0].traceId).toBe('aaaa0000000000000000000000000001');
    expect(events[0].links![0].spanId).toBe('bbbb000000000001');
    expect(events[0].links![0].attributes).toEqual({ 'link.type': 'parent' });
  });

  it('span attributes take precedence over resource attributes', () => {
    const payload = {
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'from-resource' } },
              { key: 'shared.key', value: { stringValue: 'resource-value' } },
            ],
          },
          scopeSpans: [
            {
              spans: [
                {
                  name: 'test',
                  attributes: [
                    {
                      key: 'shared.key',
                      value: { stringValue: 'span-value' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const events = parseOtlpEvents(payload);
    expect(events[0].attributes?.['service.name']).toBe('from-resource');
    expect(events[0].attributes?.['shared.key']).toBe('span-value');
  });
});

describe('otlpSpanToTerminalEvent', () => {
  it('maps error status code', () => {
    const event = otlpSpanToTerminalEvent({
      name: 'fail',
      status: { code: 2 },
    });
    expect(event.status).toBe('ERROR');
  });

  it('maps string status codes', () => {
    const ok = otlpSpanToTerminalEvent({ status: { code: 'STATUS_CODE_OK' } });
    expect(ok.status).toBe('OK');

    const err = otlpSpanToTerminalEvent({ status: { code: 'ERROR' } });
    expect(err.status).toBe('ERROR');
  });

  it('maps all span kinds', () => {
    expect(otlpSpanToTerminalEvent({ kind: 1 }).kind).toBe('INTERNAL');
    expect(otlpSpanToTerminalEvent({ kind: 2 }).kind).toBe('SERVER');
    expect(otlpSpanToTerminalEvent({ kind: 3 }).kind).toBe('CLIENT');
    expect(otlpSpanToTerminalEvent({ kind: 4 }).kind).toBe('PRODUCER');
    expect(otlpSpanToTerminalEvent({ kind: 5 }).kind).toBe('CONSUMER');
    expect(otlpSpanToTerminalEvent({ kind: 'SERVER' }).kind).toBe('SERVER');
  });

  it('normalizes hex IDs with padding', () => {
    const event = otlpSpanToTerminalEvent({
      traceId: 'abc',
      spanId: 'def',
      parentSpanId: '123',
    });
    expect(event.traceId).toBe('00000000000000000000000000000abc');
    expect(event.spanId).toBe('0000000000000def');
    expect(event.parentSpanId).toBe('0000000000000123');
  });

  it('converts attribute types correctly', () => {
    const event = otlpSpanToTerminalEvent({
      attributes: [
        { key: 'str', value: { stringValue: 'hello' } },
        { key: 'bool', value: { boolValue: true } },
        { key: 'int', value: { intValue: '42' } },
        { key: 'double', value: { doubleValue: 3.14 } },
        { key: 'empty', value: {} },
      ],
    });
    expect(event.attributes).toEqual({
      str: 'hello',
      bool: true,
      int: 42,
      double: 3.14,
      empty: undefined,
    });
  });
});

// --- parseOtlpLogEvents (logs) ---

describe('parseOtlpLogEvents', () => {
  it('parses a minimal OTLP log payload', () => {
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
                  body: { stringValue: 'request completed' },
                  traceId: 'abcdef1234567890abcdef1234567890',
                  spanId: '1234567890abcdef',
                  attributes: [
                    { key: 'http.status_code', value: { intValue: '200' } },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };

    const events = parseOtlpLogEvents(payload);
    expect(events).toHaveLength(1);
    expect(events[0].level).toBe('info');
    expect(events[0].message).toBe('request completed');
    expect(events[0].traceId).toBe('abcdef1234567890abcdef1234567890');
    expect(events[0].spanId).toBe('1234567890abcdef');
    expect(events[0].attributes).toEqual({ 'http.status_code': 200 });
    expect(events[0].time).toBe(1_700_000_000_000);
  });

  it('maps severity numbers to log levels', () => {
    const make = (severityNumber: number) => ({
      resourceLogs: [
        {
          scopeLogs: [
            { logRecords: [{ severityNumber, body: { stringValue: 'msg' } }] },
          ],
        },
      ],
    });

    expect(parseOtlpLogEvents(make(1))[0].level).toBe('debug');
    expect(parseOtlpLogEvents(make(5))[0].level).toBe('debug');
    expect(parseOtlpLogEvents(make(9))[0].level).toBe('info');
    expect(parseOtlpLogEvents(make(13))[0].level).toBe('warn');
    expect(parseOtlpLogEvents(make(17))[0].level).toBe('error');
    expect(parseOtlpLogEvents(make(21))[0].level).toBe('error');
  });

  it('maps severity text to log levels', () => {
    const make = (severityText: string) => ({
      resourceLogs: [
        {
          scopeLogs: [
            { logRecords: [{ severityText, body: { stringValue: 'msg' } }] },
          ],
        },
      ],
    });

    expect(parseOtlpLogEvents(make('DEBUG'))[0].level).toBe('debug');
    expect(parseOtlpLogEvents(make('TRACE'))[0].level).toBe('debug');
    expect(parseOtlpLogEvents(make('INFO'))[0].level).toBe('info');
    expect(parseOtlpLogEvents(make('WARN'))[0].level).toBe('warn');
    expect(parseOtlpLogEvents(make('WARNING'))[0].level).toBe('warn');
    expect(parseOtlpLogEvents(make('ERROR'))[0].level).toBe('error');
    expect(parseOtlpLogEvents(make('FATAL'))[0].level).toBe('error');
  });

  it('handles multiple log records across scopes', () => {
    const payload = {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                { body: { stringValue: 'log-1' } },
                { body: { stringValue: 'log-2' } },
              ],
            },
          ],
        },
        {
          scopeLogs: [{ logRecords: [{ body: { stringValue: 'log-3' } }] }],
        },
      ],
    };

    const events = parseOtlpLogEvents(payload);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.message)).toEqual(['log-1', 'log-2', 'log-3']);
  });

  it('returns empty array for empty or invalid payload', () => {
    expect(parseOtlpLogEvents(null)).toEqual([]);
    expect(parseOtlpLogEvents({})).toEqual([]);
    expect(parseOtlpLogEvents({ resourceLogs: [] })).toEqual([]);
  });

  it('handles missing body gracefully', () => {
    const payload = {
      resourceLogs: [{ scopeLogs: [{ logRecords: [{}] }] }],
    };
    const events = parseOtlpLogEvents(payload);
    expect(events).toHaveLength(1);
    expect(events[0].message).toBe('');
    expect(events[0].level).toBe('info');
  });

  it('omits traceId/spanId when not present', () => {
    const payload = {
      resourceLogs: [
        { scopeLogs: [{ logRecords: [{ body: { stringValue: 'no ids' } }] }] },
      ],
    };
    const events = parseOtlpLogEvents(payload);
    expect(events[0].traceId).toBeUndefined();
    expect(events[0].spanId).toBeUndefined();
  });

  it('uses observedTimeUnixNano when timeUnixNano is missing', () => {
    const payload = {
      resourceLogs: [
        {
          scopeLogs: [
            {
              logRecords: [
                {
                  observedTimeUnixNano: '1700000000100000000',
                  body: { stringValue: 'observed' },
                },
              ],
            },
          ],
        },
      ],
    };
    const events = parseOtlpLogEvents(payload);
    expect(events[0].time).toBe(1_700_000_000_100);
  });
});

// --- countOtlpMetrics ---

describe('countOtlpMetrics', () => {
  it('counts metrics in a valid payload', () => {
    const payload = {
      resourceMetrics: [
        {
          scopeMetrics: [
            {
              metrics: [
                { name: 'http.server.duration', unit: 'ms' },
                { name: 'http.server.request_count', unit: '1' },
              ],
            },
          ],
        },
      ],
    };

    expect(countOtlpMetrics(payload)).toBe(2);
  });

  it('counts across multiple resources and scopes', () => {
    const payload = {
      resourceMetrics: [
        {
          scopeMetrics: [
            { metrics: [{ name: 'm1' }] },
            { metrics: [{ name: 'm2' }, { name: 'm3' }] },
          ],
        },
        {
          scopeMetrics: [{ metrics: [{ name: 'm4' }] }],
        },
      ],
    };

    expect(countOtlpMetrics(payload)).toBe(4);
  });

  it('returns 0 for empty or invalid payload', () => {
    expect(countOtlpMetrics(null)).toBe(0);
    expect(countOtlpMetrics({})).toBe(0);
    expect(countOtlpMetrics({ resourceMetrics: [] })).toBe(0);
    expect(countOtlpMetrics('not an object')).toBe(0);
  });

  it('handles missing metrics arrays gracefully', () => {
    const payload = {
      resourceMetrics: [{ scopeMetrics: [{}] }],
    };
    expect(countOtlpMetrics(payload)).toBe(0);
  });
});

// --- readJsonBody (size limit) ---

describe('readJsonBody', () => {
  function fakeRequest(body: string): IncomingMessage {
    const stream = new Readable({
      read() {
        this.push(Buffer.from(body));
        this.push(null);
      },
    });
    return stream as unknown as IncomingMessage;
  }

  it('parses valid JSON body', async () => {
    const req = fakeRequest('{"key":"value"}');
    const result = await readJsonBody(req);
    expect(result).toEqual({ key: 'value' });
  });

  it('returns empty object for empty body', async () => {
    const stream = new Readable({
      read() {
        this.push(null);
      },
    });
    const result = await readJsonBody(stream as unknown as IncomingMessage);
    expect(result).toEqual({});
  });

  it('throws on invalid JSON', async () => {
    const req = fakeRequest('not json');
    await expect(readJsonBody(req)).rejects.toThrow();
  });

  it('throws when body exceeds 10MB limit', async () => {
    const largeChunk = Buffer.alloc(1024 * 1024, 'a'); // 1MB
    let pushed = 0;
    const stream = new Readable({
      read() {
        if (pushed < 11) {
          this.push(largeChunk);
          pushed++;
        } else {
          this.push(null);
        }
      },
    });

    await expect(
      readJsonBody(stream as unknown as IncomingMessage),
    ).rejects.toThrow('Body exceeds');
  });
});

// --- sendJson ---

describe('sendJson', () => {
  it('sends JSON response with correct headers', () => {
    const res = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      body: '',
      setHeader(key: string, value: string) {
        this.headers[key] = value;
      },
      end(data: string) {
        this.body = data;
      },
    };

    sendJson(res as any, 200, { ok: true });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });
});
