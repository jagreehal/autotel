import { beforeAll, describe, expect, it } from 'vitest';
import type { PostHogPropertyValue } from './before-send.js';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { autotelBeforeSend } from './before-send';

// The hook reads the *ambient* span, which is the only thing PostHog's
// before_send can see. Without a real context manager registered, the API's
// default is a no-op and context.with() stores nothing — so this registers one
// rather than passing a span in by hand and testing a path nobody runs.
beforeAll(() => {
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
});

const SPAN_CONTEXT = {
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  spanId: '00f067aa0ba902b7',
  traceFlags: 1,
};

const event = (properties: Record<string, PostHogPropertyValue> = {}) => ({
  uuid: 'e1',
  event: '$pageview',
  properties,
});

/** Run `fn` as though a span were in progress, the way a traced click is. */
function inSpan<T>(fn: () => T): T {
  return context.with(trace.setSpanContext(context.active(), SPAN_CONTEXT), fn);
}

describe('autotelBeforeSend', () => {
  it('stamps the trace a PostHog event happened inside', () => {
    const result = inSpan(() => autotelBeforeSend()(event()));

    expect(result?.properties['$trace_id']).toBe(SPAN_CONTEXT.traceId);
    expect(result?.properties['$span_id']).toBe(SPAN_CONTEXT.spanId);
  });

  it('leaves the event alone when nothing is being traced', () => {
    const result = autotelBeforeSend()(event({ plan: 'pro' }));

    expect(result?.properties).toEqual({ plan: 'pro' });
  });

  it('passes through an event an earlier hook dropped', () => {
    // before_send is a chain: null means "already discarded", and re-inflating
    // it would resurrect an event the page deliberately suppressed.
    expect(autotelBeforeSend()(null)).toBeNull();
  });

  it('never overwrites a trace id the caller set', () => {
    const result = inSpan(() =>
      autotelBeforeSend()(event({ $trace_id: 'set-by-hand' })),
    );

    expect(result?.properties['$trace_id']).toBe('set-by-hand');
  });
});

describe('trace url', () => {
  it('adds a link a person can click, not just ids to join on', () => {
    // Ids correlate; they do not navigate. `$trace_url` is what turns a
    // PostHog event into one click back to the trace, and only the app knows
    // its own backend's URL shape.
    const result = inSpan(() =>
      autotelBeforeSend({
        traceUrl: ({ traceId }) => `https://traces.example.com/${traceId}`,
      })(event()),
    );

    expect(result?.properties['$trace_url']).toBe(
      `https://traces.example.com/${SPAN_CONTEXT.traceId}`,
    );
  });

  it('receives the span as well as the trace', () => {
    let received: unknown;
    inSpan(() =>
      autotelBeforeSend({
        traceUrl: (ctx) => {
          received = ctx;
          return 'https://traces.example.com/x';
        },
      })(event()),
    );

    expect(received).toEqual({
      traceId: SPAN_CONTEXT.traceId,
      spanId: SPAN_CONTEXT.spanId,
    });
  });

  it('adds nothing when the callback declines', () => {
    const result = inSpan(() =>
      autotelBeforeSend({ traceUrl: () => undefined })(event()),
    );

    expect(result?.properties['$trace_url']).toBeUndefined();
  });

  it('survives a callback that throws', () => {
    // A URL builder is app code. It must not be able to take down the analytics
    // event it was decorating.
    const result = inSpan(() =>
      autotelBeforeSend({
        traceUrl: () => {
          throw new Error('bad template');
        },
      })(event()),
    );

    expect(result?.properties['$trace_id']).toBe(SPAN_CONTEXT.traceId);
    expect(result?.properties['$trace_url']).toBeUndefined();
  });
});
