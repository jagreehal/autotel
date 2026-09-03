import { describe, expect, it, vi } from 'vitest';

import type { BrowserContext, Page } from '@playwright/test';

const span = {
  addEvent: vi.fn(),
  end: vi.fn(),
  recordException: vi.fn(),
  setAttribute: vi.fn(),
  setAttributes: vi.fn(),
  setStatus: vi.fn(),
  spanContext: () => ({ spanId: 'span-1', traceId: 'trace-1' }),
};

vi.mock('autotel', () => ({
  context: {
    active: () => ({}),
    with: (_ctx: never, fn: () => unknown) => fn(),
  },
  getTracer: () => ({ startSpan: () => span }),
  otelTrace: { setSpan: () => ({}) },
  SpanStatusCode: { ERROR: 2 },
}));

const { BROWSER_SESSION_ATTRIBUTES, withBrowserSession } =
  await import('./session');

/** Minimal stand-in for the handful of Playwright events the session listens to. */
function createFakePage() {
  const handlers = new Map<string, (arg: unknown) => void>();
  return {
    emit: (event: string, arg?: unknown) => handlers.get(event)?.(arg),
    page: {
      on: (event: string, handler: (arg: unknown) => void) => {
        handlers.set(event, handler);
      },
    } as unknown as Page,
  };
}

function createFakeContext(
  page: Page,
  metrics: Array<{ name: string; value: number }>,
) {
  return {
    newCDPSession: vi.fn(async () => ({
      send: vi.fn(async (method: string) =>
        method === 'Performance.getMetrics' ? { metrics } : undefined,
      ),
    })),
    off: vi.fn(),
    on: vi.fn(),
    pages: () => [page],
  } as unknown as BrowserContext;
}

describe('withBrowserSession', () => {
  it('records resource, network and console totals on the session span', async () => {
    const fake = createFakePage();
    const context = createFakeContext(fake.page, [
      { name: 'TaskDuration', value: 1.5 },
      { name: 'JSHeapUsedSize', value: 2048 },
    ]);

    await withBrowserSession(context, async () => {
      fake.emit('console', { text: () => 'boom', type: () => 'error' });
      fake.emit('pageerror', new Error('nope'));
      fake.emit('requestfinished', {
        sizes: async () => ({
          requestBodySize: 1,
          requestHeadersSize: 2,
          responseBodySize: 3,
          responseHeadersSize: 4,
        }),
      });
    });

    expect(span.setAttribute).toHaveBeenCalledWith(
      BROWSER_SESSION_ATTRIBUTES.SESSION_ID,
      'span-1',
    );
    expect(span.recordException).toHaveBeenCalledTimes(1);
    expect(span.addEvent).toHaveBeenCalledWith('browser.console', {
      [BROWSER_SESSION_ATTRIBUTES.CONSOLE_LEVEL]: 'error',
      [BROWSER_SESSION_ATTRIBUTES.CONSOLE_MESSAGE]: 'boom',
    });
    expect(span.setAttributes).toHaveBeenCalledWith({
      [BROWSER_SESSION_ATTRIBUTES.CONSOLE_ERRORS]: 2,
      [BROWSER_SESSION_ATTRIBUTES.CPU_TIME]: 1.5,
      [BROWSER_SESSION_ATTRIBUTES.MEMORY_USAGE]: 2048,
      [BROWSER_SESSION_ATTRIBUTES.NETWORK_IO]: 10,
      [BROWSER_SESSION_ATTRIBUTES.PAGES]: 1,
    });
    expect(span.end).toHaveBeenCalled();
  });
});
