import { describe, expect, it, vi } from 'vitest';
import type { RequestLogger } from 'autotel';
import { applyLoggerEnrichment, completeIntegratedRequest } from './integration';
import { createMiddlewareLogger } from './middleware';

describe('integration helpers', () => {
  it('applyLoggerEnrichment sets non-empty attribute objects', () => {
    const sets: Record<string, unknown>[] = [];
    const logger = {
      set(attrs: Record<string, unknown>) {
        sets.push(attrs);
      },
    } as unknown as RequestLogger;

    applyLoggerEnrichment(logger, undefined, { a: 1 }, {}, { b: 2 });
    expect(sets).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('completeIntegratedRequest finishes non-response results', async () => {
    const finish = vi.fn(async () => null);
    const handle = {
      skipped: false,
      finish,
      finishResponse: vi.fn(),
    };

    const result = await completeIntegratedRequest(handle as never, {}, { ok: true });
    expect(result).toEqual({ ok: true });
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it('finishResponse defers emit until streaming responses complete', async () => {
    const emitNow = vi.fn(() => ({
      timestamp: new Date().toISOString(),
      traceId: 't',
      spanId: 's',
      correlationId: 'c',
      context: {},
    }));
    const logger = {
      set: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      getContext: () => ({}),
      emitNow,
      fork: vi.fn(),
    } as unknown as RequestLogger;

    const handle = createMiddlewareLogger(logger, {
      method: 'GET',
      path: '/events',
    });

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('chunk'));
        controller.close();
      },
    });
    const response = new Response(stream, {
      headers: { 'content-type': 'text/event-stream' },
    });

    const wrapped = await handle.finishResponse(response);
    expect(emitNow).not.toHaveBeenCalled();
    await wrapped.text();
    expect(emitNow).toHaveBeenCalledTimes(1);
  });
});
