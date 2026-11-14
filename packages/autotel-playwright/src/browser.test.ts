import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

const emitted: Array<Record<string, unknown>> = [];

vi.mock('autotel', () => ({
  SpanKind: { CLIENT: 2 },
  SpanStatusCode: { UNSET: 0, OK: 1, ERROR: 2 },
  logs: { getLogger: () => ({ emit: (record: Record<string, unknown>) => emitted.push(record) }) },
}));

import { recordBrowserActivity } from './browser';

function fakeRequest(opts: {
  url: string;
  method?: string;
  status?: number;
  failure?: string;
  startTime?: number;
  responseEnd?: number;
}) {
  return {
    url: () => opts.url,
    method: () => opts.method ?? 'GET',
    resourceType: () => 'fetch',
    timing: () => ({ startTime: opts.startTime ?? 1000, responseEnd: opts.responseEnd ?? 40 }),
    response: async () => (opts.status === undefined ? null : { status: () => opts.status }),
    failure: () => (opts.failure ? { errorText: opts.failure } : null),
  };
}

function setup() {
  const page = new EventEmitter();
  const started: Array<{ name: string; options: Record<string, unknown>; ctx: unknown; status?: unknown; end?: unknown }> = [];
  const tracer = {
    startSpan: (name: string, options: Record<string, unknown>, ctx: unknown) => {
      const record: (typeof started)[number] = { name, options, ctx };
      started.push(record);
      return {
        setStatus: (status: unknown) => (record.status = status),
        end: (end: unknown) => (record.end = end),
      };
    },
  };
  const ctx = { test: true };
  const kept: unknown[] = [];
  emitted.length = 0;
  const stop = recordBrowserActivity(page as never, {
    tracer: tracer as never,
    ctx: ctx as never,
    onLog: (record) => kept.push(record),
  });
  return { page, started, ctx, kept, stop };
}

describe('recordBrowserActivity', () => {
  it('records each request as a client span under the test, timed by Playwright', async () => {
    const { page, started, ctx, stop } = setup();
    page.emit('requestfinished', fakeRequest({ url: 'http://app.test/api/orders?x=1', method: 'POST', status: 201 }));
    page.emit('requestfinished', fakeRequest({ url: 'http://app.test/api/missing', status: 404, startTime: 2000, responseEnd: 10 }));
    page.emit('requestfailed', fakeRequest({ url: 'http://app.test/api/down', failure: 'net::ERR_CONNECTION_REFUSED', responseEnd: -1 }));
    page.emit('requestfinished', fakeRequest({ url: 'data:image/png;base64,AAAA' }));
    await stop();

    // A failed request has no response to wait for, so it can finish first.
    const byName = (name: string) => started.find((s) => s.name === name)!;
    expect(started.map((s) => s.name).sort()).toEqual(['GET /api/down', 'GET /api/missing', 'POST /api/orders']);
    expect(byName('POST /api/orders')).toMatchObject({
      ctx,
      options: {
        kind: 2,
        startTime: 1000,
        attributes: {
          'http.request.method': 'POST',
          'url.full': 'http://app.test/api/orders?x=1',
          'http.response.status_code': 201,
          'playwright.resource_type': 'fetch',
        },
      },
      end: 1040,
    });
    expect(byName('POST /api/orders').status).toBeUndefined();
    expect(byName('GET /api/missing').status).toEqual({ code: 2, message: 'HTTP 404' });
    expect(byName('GET /api/down').status).toEqual({ code: 2, message: 'net::ERR_CONNECTION_REFUSED' });
  });

  it('emits console errors and warnings, and uncaught errors, as log records correlated to the test', async () => {
    const { page, ctx, kept, stop } = setup();
    const message = (type: string, text: string) => ({
      type: () => type,
      text: () => text,
      location: () => ({ url: 'http://app.test/app.js', lineNumber: 12, columnNumber: 3 }),
    });
    page.emit('console', message('log', 'rendered'));
    page.emit('console', message('error', 'Failed to load cart'));
    const boom = new TypeError('cart is undefined');
    page.emit('pageerror', boom);
    await stop();

    expect(emitted).toHaveLength(2);
    expect(emitted[0]).toMatchObject({
      eventName: 'browser.console',
      severityNumber: 17,
      severityText: 'ERROR',
      body: 'Failed to load cart',
      context: ctx,
      attributes: { 'browser.console.level': 'error', 'code.filepath': 'http://app.test/app.js', 'code.lineno': 12 },
    });
    expect(emitted[1]).toMatchObject({
      eventName: 'exception',
      severityText: 'ERROR',
      body: 'TypeError: cart is undefined',
      context: ctx,
      attributes: { 'exception.type': 'TypeError', 'exception.message': 'cart is undefined' },
    });
    expect((emitted[1]!.attributes as Record<string, string>)['exception.stacktrace']).toContain('cart is undefined');
    // The fixture keeps the same records for the test's otel-logs annotation.
    expect(kept).toHaveLength(2);
    expect(kept[0]).toMatchObject({ severity: 'ERROR', body: 'Failed to load cart' });
  });

  it('stops listening once stopped', async () => {
    const { page, started, stop } = setup();
    await stop();
    page.emit('requestfinished', fakeRequest({ url: 'http://app.test/late' }));
    expect(started).toEqual([]);
  });
});
