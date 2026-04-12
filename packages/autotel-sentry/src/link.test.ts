import { describe, it, expect, vi, afterEach } from 'vitest';
import { trace } from '@opentelemetry/api';
import { linkSentryErrors } from './link';

function createMockSentry() {
  const processors: Array<(event: Record<string, unknown>) => Record<string, unknown>> = [];
  return {
    sentry: {
      getGlobalScope: () => ({
        addEventProcessor: (fn: (event: Record<string, unknown>) => Record<string, unknown>) => {
          processors.push(fn);
        },
      }),
    },
    processors,
  };
}

describe('linkSentryErrors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('installs a global event processor', () => {
    const { sentry, processors } = createMockSentry();
    linkSentryErrors(sentry as any);
    expect(processors).toHaveLength(1);
    expect(typeof processors[0]).toBe('function');
  });

  it('event processor adds trace context when OTel span is active', () => {
    const { sentry, processors } = createMockSentry();
    linkSentryErrors(sentry as any);
    const processor = processors[0]!;

    const mockSpan = {
      spanContext: () => ({
        traceId: 'aaaa',
        spanId: 'bbbb',
        traceFlags: 1,
      }),
    };

    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(mockSpan as any);
    const result = processor({ contexts: {} });

    expect(result.contexts).toEqual({
      trace: { trace_id: 'aaaa', span_id: 'bbbb' },
    });
  });

  it('event processor preserves existing trace context', () => {
    const { sentry, processors } = createMockSentry();
    linkSentryErrors(sentry as any);
    const processor = processors[0]!;

    const event = {
      contexts: {
        trace: { trace_id: 'existing', span_id: 'existing' },
      },
    };

    const mockSpan = {
      spanContext: () => ({ traceId: 'new', spanId: 'new', traceFlags: 1 }),
    };
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(mockSpan as any);
    const result = processor(event);

    expect((result.contexts as Record<string, unknown>).trace).toEqual({
      trace_id: 'existing',
      span_id: 'existing',
    });
  });

  it('event processor returns event unchanged when no active span', () => {
    const { sentry, processors } = createMockSentry();
    linkSentryErrors(sentry as any);
    const processor = processors[0]!;

    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined);
    const event = { message: 'hello' };
    const result = processor(event);
    expect(result).toEqual({ message: 'hello' });
  });
});
