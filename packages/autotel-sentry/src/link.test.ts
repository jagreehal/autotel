import { describe, it, expect, vi, afterEach } from 'vitest';
import { trace, type Span } from '@opentelemetry/api';
import { linkSentryErrors } from './link';
import type { SentryEvent, SentryLinkable } from './types';

type EventProcessor = (event: SentryEvent) => SentryEvent;

/** A Sentry stand-in that keeps the processors installed on it. */
function createFakeSentry() {
  const processors: Array<EventProcessor> = [];
  const sentry = {
    getGlobalScope: () => ({
      addEventProcessor: (fn: EventProcessor) => {
        processors.push(fn);
      },
    }),
  } satisfies SentryLinkable;
  return { sentry, processors };
}

/** A span that answers with the ids a test wants to see on the event. */
function spanWithContext(traceId: string, spanId: string): Span {
  // SAFETY: linkSentryErrors calls spanContext() and nothing else on the active
  // span, so the rest of the Span surface is never reached from these tests.
  return {
    spanContext: () => ({ traceId, spanId, traceFlags: 1 }),
  } as Span;
}

describe('linkSentryErrors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('installs a global event processor', () => {
    const { sentry, processors } = createFakeSentry();
    linkSentryErrors(sentry);
    expect(processors).toHaveLength(1);
  });

  it('event processor adds trace context when OTel span is active', () => {
    const { sentry, processors } = createFakeSentry();
    linkSentryErrors(sentry);
    const processor = processors[0]!;

    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(
      spanWithContext('aaaa', 'bbbb'),
    );
    const result = processor({ contexts: {} });

    expect(result.contexts).toEqual({
      trace: { trace_id: 'aaaa', span_id: 'bbbb' },
    });
  });

  it('event processor preserves existing trace context', () => {
    const { sentry, processors } = createFakeSentry();
    linkSentryErrors(sentry);
    const processor = processors[0]!;

    const event = {
      contexts: {
        trace: { trace_id: 'existing', span_id: 'existing' },
      },
    };

    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(
      spanWithContext('new', 'new'),
    );
    const result = processor(event);

    expect(result.contexts?.trace).toEqual({
      trace_id: 'existing',
      span_id: 'existing',
    });
  });

  it('event processor returns event unchanged when no active span', () => {
    const { sentry, processors } = createFakeSentry();
    linkSentryErrors(sentry);
    const processor = processors[0]!;

    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined);
    const event = { message: 'hello' };
    const result = processor(event);
    expect(result).toEqual({ message: 'hello' });
  });
});
