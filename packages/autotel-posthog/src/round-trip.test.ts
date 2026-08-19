import { beforeAll, describe, expect, it } from 'vitest';
import { context, trace, SpanStatusCode } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { posthogCompatibility } from './compatibility';
import { autotelBeforeSend } from './before-send';

beforeAll(() => {
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
});

/** What the page's PostHog looks like once it has finished starting up. */
const posthog = {
  get_session_id: () => '0195f1c2-8b3a-7000-9000-abcdef012345',
  get_distinct_id: () => 'usr_8f21c0',
  get_session_replay_url: () =>
    'https://eu.posthog.com/replay/0195f1c2?t=12345',
  sessionRecordingStarted: () => true,
};

describe('a failed checkout, end to end', () => {
  it('leaves a trace that points at the replay and an event that points back', () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [
        posthogCompatibility({ posthog }),
        new SimpleSpanProcessor(exporter),
      ],
    });
    const tracer = provider.getTracer('test');

    let captured: Record<string, unknown> | undefined;

    const span = tracer.startSpan('POST /checkout');
    context.with(trace.setSpan(context.active(), span), () => {
      // Whatever PostHog captures while the span is open — an autocaptured
      // click, an $exception, a funnel step — passes through here.
      captured = autotelBeforeSend()({
        uuid: 'e1',
        event: '$exception',
        properties: {},
      })?.properties;
    });
    span.recordException(new TypeError('card declined'));
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();

    const [exported] = exporter.getFinishedSpans();

    // The trace knows the session, the person, and where to watch it happen.
    expect(exported?.attributes['session.id']).toBe(
      '0195f1c2-8b3a-7000-9000-abcdef012345',
    );
    expect(exported?.attributes['user.id']).toBe('usr_8f21c0');
    expect(exported?.attributes['session.replay.url']).toBe(
      'https://eu.posthog.com/replay/0195f1c2?t=12345',
    );

    // And the PostHog event names the trace that explains it.
    expect(captured?.['$trace_id']).toBe(exported?.spanContext().traceId);
    expect(captured?.['$span_id']).toBe(exported?.spanContext().spanId);
  });
});
