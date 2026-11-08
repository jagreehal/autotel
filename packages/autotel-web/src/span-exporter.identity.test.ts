// @vitest-environment jsdom
/**
 * `identify()` attributes are app values: booleans and fractions included.
 * Lean spans must encode them as OTLP `boolValue` / `doubleValue`; a
 * `stringValue: true` or `intValue: "1.5"` is a payload collectors reject.
 */
import { afterEach, expect, it, vi } from 'vitest';
import {
  configureExporter,
  flushSpans,
  recordSpan,
  resetForTesting,
  setRawFetch,
} from './span-exporter';
import { clearIdentity, identify } from './identity';
import { resetSessionForTesting } from './session';

afterEach(() => {
  resetForTesting();
  resetSessionForTesting();
  clearIdentity();
});

it('encodes identity booleans and fractions as typed OTLP values', async () => {
  const bodies: string[] = [];
  setRawFetch(((_url: string, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ''));
    return Promise.resolve(new Response(null, { status: 200 }));
  }) as typeof fetch);
  configureExporter('web', 'https://c.example.com');

  identify('u1', { paid: true, score: 1.5, seats: 3 });
  recordSpan('a'.repeat(32), 'b'.repeat(16), 'GET', 1, 2, {
    'http.duration': 0.25,
  });
  flushSpans();
  await vi.waitFor(() => expect(bodies.length).toBeGreaterThan(0));

  const attributes = JSON.parse(bodies[0]!).resourceSpans[0].scopeSpans[0]
    .spans[0].attributes as Array<{ key: string; value: unknown }>;
  const byKey = Object.fromEntries(attributes.map((a) => [a.key, a.value]));
  expect(byKey).toMatchObject({
    'user.id': { stringValue: 'u1' },
    paid: { boolValue: true },
    score: { doubleValue: 1.5 },
    seats: { intValue: '3' },
    'http.duration': { doubleValue: 0.25 },
  });
});
