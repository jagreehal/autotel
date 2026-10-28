// @vitest-environment jsdom
/**
 * A join that owns `session.id` owns it for every signal. Spans and baggage
 * carried the vendor's session while logs and events kept autotel's minted
 * one, so filtering by the vendor's session found the spans and missed the
 * clicks, vitals and console logs from the same visit.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  ReadableSpan,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { flushSpans, recordEvent, resetForTesting } from './span-exporter';
import { initFull, resetFullForTesting, span } from './full';
import { enrichSpans, resetJoinForTesting } from './join';
import {
  configureSession,
  getSessionAttributes,
  resetSessionForTesting,
} from './session';
import { resetBaggageForTesting } from './baggage';
import { sampleByKey } from './sampling';

/** A recorder's session, absent until the test starts it. */
function vendorSession() {
  let id: string | undefined;
  return {
    read: () => id,
    start: (value: string) => {
      id = value;
    },
  };
}

let posts: Array<{ url: string; body: string }>;

beforeEach(() => {
  resetFullForTesting();
  resetForTesting();
  resetSessionForTesting();
  resetJoinForTesting();
  resetBaggageForTesting();
  posts = [];
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
    posts.push({ url: String(input), body: String(init?.body ?? '') });
    return Promise.resolve(new Response(null, { status: 200 }));
  });
});

/** Past the wait for a recorder that has not started. */
function afterGrace(): void {
  vi.setSystemTime(Date.now() + 4000);
}

afterEach(() => {
  vi.useRealTimers();
  resetFullForTesting();
  resetForTesting();
  resetSessionForTesting();
  resetJoinForTesting();
  resetBaggageForTesting();
  vi.unstubAllGlobals();
});

function logSessionIds(): unknown[] {
  return posts
    .filter((post) => post.url.endsWith('/v1/logs'))
    .flatMap((post) => {
      // SAFETY: the exporter posts OTLP/JSON logs.
      const body = JSON.parse(post.body) as {
        resourceLogs: Array<{
          scopeLogs: Array<{
            logRecords: Array<{
              attributes: Array<{
                key: string;
                value: { stringValue?: string };
              }>;
            }>;
          }>;
        }>;
      };
      return body.resourceLogs.flatMap((r) =>
        r.scopeLogs.flatMap((s) =>
          s.logRecords.map(
            (record) =>
              record.attributes.find((a) => a.key === 'session.id')?.value
                .stringValue,
          ),
        ),
      );
    });
}

function recorder(): SpanProcessor & { seen: ReadableSpan[] } {
  const seen: ReadableSpan[] = [];
  return {
    seen,
    onStart() {},
    onEnd: (s) => seen.push(s),
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
  };
}

const quiet = {
  captureNavigation: false,
  captureWebVitals: false,
  captureErrors: false,
  captureFetch: false,
  captureXHR: false,
} as const;

it('puts the owning join’s session on events and logs, not only spans', () => {
  const spans = recorder();
  initFull({
    service: 'web',
    endpoint: 'https://collector.example.com',
    ...quiet,
    spanEnrichers: [
      enrichSpans({ name: 'vendor', session: () => 'vendor-1', debug: false }),
      spans,
    ],
  });

  span('checkout.click', () => undefined);
  recordEvent('app.widget.click', {});
  flushSpans();

  expect(spans.seen[0]?.attributes['session.id']).toBe('vendor-1');
  expect(logSessionIds()).toEqual(['vendor-1']);
});

it('falls back to autotel’s own session while the vendor has none yet', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  initFull({
    service: 'web',
    endpoint: 'https://collector.example.com',
    ...quiet,
    spanEnrichers: [
      enrichSpans({ name: 'vendor', session: () => undefined, debug: false }),
    ],
  });

  recordEvent('app.widget.click', {});
  afterGrace();
  flushSpans();

  const [id] = logSessionIds();
  expect(id).toEqual(expect.any(String));
  expect(id).not.toBe('');
});

it('files the start of the visit under the vendor session once it exists', () => {
  // RUM's session appears ~half a second after init. The first console line
  // and web vitals of the visit land before it; they are the same visit.
  let vendor: string | undefined;
  const spans = recorder();
  initFull({
    service: 'web',
    endpoint: 'https://collector.example.com',
    ...quiet,
    spanEnrichers: [
      enrichSpans({ name: 'vendor', session: () => vendor, debug: false }),
      spans,
    ],
  });

  recordEvent('browser.web_vital', {});
  span('early.span', () => {
    vendor = 'vendor-1';
  });
  recordEvent('app.widget.click', {});
  flushSpans();

  expect(logSessionIds()).toEqual(['vendor-1', 'vendor-1']);
  expect(spans.seen[0]?.attributes['session.id']).toBe('vendor-1');
});

it('keeps the stand-in id when the vendor never starts', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  initFull({
    service: 'web',
    endpoint: 'https://collector.example.com',
    ...quiet,
    spanEnrichers: [
      enrichSpans({ name: 'vendor', session: () => undefined, debug: false }),
    ],
  });
  recordEvent('app.widget.click', {});
  recordEvent('app.widget.click', {});
  afterGrace();
  flushSpans();
  const ids = logSessionIds();
  expect(new Set(ids).size).toBe(1);
  expect(ids[0]).toMatch(/\S/);
});

it('holds the start of the visit until the vendor session exists', () => {
  // Logs and events flush as they are recorded, so without the hold the first
  // records leave carrying the stand-in before RUM has a session.
  const vendor = vendorSession();
  initFull({
    service: 'web',
    endpoint: 'https://collector.example.com',
    ...quiet,
    spanEnrichers: [
      enrichSpans({ name: 'vendor', session: vendor.read, debug: false }),
    ],
  });
  recordEvent('browser.web_vital', {});
  expect(posts).toEqual([]);

  vendor.start('vendor-1');
  flushSpans();
  expect(logSessionIds()).toEqual(['vendor-1']);
});

it('keeps or drops a visit whole across the vendor session arriving', () => {
  // Sampled at 50% on the session id: the stand-in and a vendor id that
  // hashes the other way must not split the visit's records.
  const vendor = vendorSession();
  initFull({
    service: 'web',
    endpoint: 'https://collector.example.com',
    ...quiet,
    sampleRate: 0.5,
    spanEnrichers: [
      enrichSpans({ name: 'vendor', session: vendor.read, debug: false }),
    ],
  });
  const early = getSessionAttributes()?.['session.id'] ?? '';
  let candidate = 0;
  while (sampleByKey(`vendor-${candidate}`, 0.5) === sampleByKey(early, 0.5)) {
    candidate += 1;
  }

  recordEvent('browser.web_vital', {});
  vendor.start(`vendor-${candidate}`);
  recordEvent('app.widget.click', {});
  flushSpans();

  const kept = logSessionIds();
  expect(kept.length === 0 || kept.length === 2).toBe(true);
  expect(kept.length).toBe(sampleByKey(early, 0.5) ? 2 : 0);
});

it('still lets an explicit session provider win', () => {
  // Lean init's `session: { id }` is a decision the app made; a join is not.
  enrichSpans({ name: 'vendor', session: () => 'vendor-1', debug: false });
  configureSession({ id: () => 'explicit-1' });
  expect(getSessionAttributes()?.['session.id']).toBe('explicit-1');

  configureSession({});
  expect(getSessionAttributes()?.['session.id']).toBe('vendor-1');
});
