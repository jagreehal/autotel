// @vitest-environment jsdom
/**
 * Against the real `@sentry/browser`, not a double: the claim is that an error
 * Sentry captures after an `await` (where the browser has already lost the
 * active span) carries the autotel trace, and that only holds if Sentry's own
 * pipeline runs our processor after it stamps its random propagation id.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as Sentry from '@sentry/browser';
import {
  BasicTracerProvider,
  type ReadableSpan,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { rememberRequestSpan } from 'autotel-web/join';
import { joinSentry, type SentryLike } from './browser';

// Compile-time contract: the structural type accepts the real SDK.
const sdk: SentryLike = Sentry;

type Envelope = Parameters<
  ReturnType<NonNullable<Sentry.BrowserOptions['transport']>>['send']
>[0];

const sent: Envelope[] = [];

beforeAll(() => {
  Sentry.init({
    dsn: 'https://key@o1.ingest.sentry.io/2',
    defaultIntegrations: false,
    transport: () => ({
      send: async (envelope) => {
        sent.push(envelope);
        return {};
      },
      flush: async () => true,
    }),
  });
  Sentry.setUser({ id: 42, email: 'never@example.com' });
});

afterAll(() => Sentry.close());

function lastEvent(): Sentry.Event | undefined {
  const items = sent.at(-1)?.[1] ?? [];
  // SAFETY: an envelope item whose header says `event` carries an Event.
  const event = items.find(([header]) => header.type === 'event')?.[1] as
    Sentry.Event | undefined;
  return event;
}

describe('joinSentry with the real Sentry SDK', () => {
  const enricher = joinSentry(sdk, {
    traceUrl: ({ traceId }) => `https://t/${traceId}`,
  });
  const ended: ReadableSpan[] = [];
  const recorder: SpanProcessor = {
    onStart() {},
    onEnd: (span) => ended.push(span),
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
  const tracer = new BasicTracerProvider({
    spanProcessors: [enricher, recorder],
  }).getTracer('t');

  it('links an error captured after the active span was lost', async () => {
    const span = tracer.startSpan('checkout.click');
    await Promise.resolve();
    Sentry.captureException(new Error('card declined'));
    await Sentry.flush();

    const event = lastEvent();
    expect(event?.contexts?.trace?.trace_id).toBe(span.spanContext().traceId);
    expect(event?.contexts?.trace?.span_id).toBe(span.spanContext().spanId);
    expect(event?.contexts?.autotel?.trace_url).toBe(
      `https://t/${span.spanContext().traceId}`,
    );
    span.end();
  });

  it('stamps the Sentry user id on spans, never the email', () => {
    tracer.startSpan('x').end();
    const attributes = ended.at(-1)?.attributes;
    expect(attributes?.['user.id']).toBe('42');
    expect(JSON.stringify(attributes)).not.toContain('example.com');
  });

  it('installs one processor however often it is called', async () => {
    joinSentry(sdk);
    joinSentry(sdk);
    const span = tracer.startSpan('again');
    Sentry.captureMessage('hello');
    await Sentry.flush();
    expect(lastEvent()?.contexts?.trace?.trace_id).toBe(
      span.spanContext().traceId,
    );
    span.end();
  });

  it('links a failed request’s error to that request’s trace', async () => {
    // The request span has ended by the time the app reports it.
    const xhr = {};
    const request = {
      traceId: '1'.repeat(32),
      spanId: '2'.repeat(16),
      traceFlags: 1,
    };
    rememberRequestSpan(xhr, request);
    Sentry.captureException(
      Object.assign(new Error('Request failed with status code 402'), {
        request: xhr,
      }),
    );
    await Sentry.flush();
    expect(lastEvent()?.contexts?.trace?.trace_id).toBe(request.traceId);
  });

  it('keeps a trace the caller passed explicitly', async () => {
    // The documented escape hatch: read the ids before the await and pass
    // them, because another trace may be in flight by the time of capture.
    const mine = { trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16) };
    const other = tracer.startSpan('another.click');
    Sentry.captureException(new Error('card declined'), {
      contexts: { trace: mine },
    });
    await Sentry.flush();
    expect(lastEvent()?.contexts?.trace).toMatchObject(mine);
    other.end();
  });

  it('leaves Sentry its own trace when nothing is in flight', async () => {
    Sentry.captureMessage('idle');
    await Sentry.flush();
    expect(lastEvent()?.contexts?.trace?.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(lastEvent()?.contexts?.autotel).toBeUndefined();
  });
});
