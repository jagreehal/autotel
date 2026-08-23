// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { context, trace } from '@opentelemetry/api';
import { BasicTracerProvider } from '@opentelemetry/sdk-trace-base';
import { StackContextManager } from '@opentelemetry/sdk-trace-web';
import { PostHog } from 'posthog-js';
import { joinPostHog } from './join';

/**
 * The one test that would have caught both of the bugs this package shipped
 * with: a real `posthog-js` instance, a real tracer, and the context manager a
 * browser actually gets.
 *
 * Every other suite here uses a hand-written PostHog double and, in Node, an
 * `AsyncLocalStorageContextManager` — which keeps the active span alive across
 * `await` and so hides the exact failure the browser has. Doubles agreed with
 * each other while the real thing joined nothing.
 */

/** What the browser gets: an active span only until the first `await`. */
function browserContext(): void {
  context.setGlobalContextManager(new StackContextManager().enable());
}

/**
 * A real PostHog, kept off the network. Local-only config, so the test is
 * about the join rather than about ingestion.
 */
function offlinePostHog(): PostHog {
  const posthog = new PostHog();
  posthog.init('phc_test_key_not_a_real_project', {
    api_host: 'https://localhost:1',
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_external_dependency_loading: true,
    advanced_disable_flags: true,
    request_batching: false,
    // jsdom's user agent reads as a bot, and posthog-js drops those before
    // `before_send` ever runs — which is its own trap, documented in the
    // README. Without this the assertions below would pass vacuously.
    opt_out_useragent_filter: true,
  });
  return posthog;
}

/** Appended after joinPostHog, so it sees what autotel stamped. */
function recorder(posthog: PostHog): Array<Record<string, unknown>> {
  const captured: Array<Record<string, unknown>> = [];
  const existing = posthog.config.before_send;
  posthog.set_config({
    before_send: [
      ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
      (event) => {
        if (event) captured.push(event.properties);
        return event;
      },
    ],
  });
  return captured;
}

afterEach(() => {
  context.disable();
  trace.disable();
});

describe('the join, against the real posthog-js', () => {
  it('stamps an event captured after an await', async () => {
    browserContext();
    const posthog = offlinePostHog();
    const provider = new BasicTracerProvider({
      spanProcessors: [joinPostHog(posthog)],
    });
    const captured = recorder(posthog);
    const tracer = provider.getTracer('test');

    const spanId = await tracer.startActiveSpan(
      'checkout.click',
      async (span) => {
        const own = span.spanContext();
        // The await a real click makes. From here on the browser has no active
        // span, which is where every event worth joining is captured.
        await Promise.resolve();
        expect(trace.getSpanContext(context.active())).toBeUndefined();

        posthog.capture('checkout_failed', { message: 'Card declined' });
        span.end();
        return own;
      },
    );

    expect(captured.at(-1)?.['$trace_id']).toBe(spanId.traceId);
    expect(captured.at(-1)?.['$span_id']).toBe(spanId.spanId);
  });

  it('reads the session id the real library minted', () => {
    browserContext();
    const posthog = offlinePostHog();
    const provider = new BasicTracerProvider({
      spanProcessors: [joinPostHog(posthog)],
    });

    const span = provider.getTracer('test').startSpan('page.interaction');
    span.end();

    // SAFETY: the enricher writes onto the span it was given; reading the
    // attribute back is how the join is observed without an exporter.
    const attributes = (
      span as unknown as { attributes: Record<string, unknown> }
    ).attributes;
    expect(attributes['session.id']).toBe(posthog.get_session_id());
    expect(attributes['session.id']).toEqual(expect.any(String));
  });
});
