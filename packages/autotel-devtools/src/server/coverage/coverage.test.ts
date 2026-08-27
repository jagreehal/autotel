/**
 * Instrumentation coverage: which entry points never emitted anything.
 *
 * The join is the whole feature. `autotel map` knows every handler the source
 * contains; the store knows what actually produced a span. Neither alone can
 * answer "what am I not seeing", which is the question you have while
 * instrumenting something.
 */

import { describe, it, expect } from 'vitest';
import { joinCoverage, type CoverageReport } from './coverage';

/** By path, because the report deliberately sorts unseen entries to the top. */
const find = (report: CoverageReport, path: string) =>
  report.entries.find((entry) => entry.path === path)!;

const routes = [
  { method: 'GET', path: '/users', file: 'src/routes/users.ts' },
  { method: 'POST', path: '/orders', file: 'src/routes/orders.ts' },
  { method: null, path: 'sendEmail', file: 'src/jobs/email.ts' },
];

describe('joinCoverage', () => {
  it('marks a route seen when a span carried its route attribute', () => {
    const result = joinCoverage(routes, {
      routeCounts: { '/users': 12 },
      spanNameCounts: {},
    });

    expect(find(result, '/users').seen).toBe(true);
    expect(find(result, '/users').spanCount).toBe(12);
    expect(find(result, '/orders').seen).toBe(false);
    expect(result.seenCount).toBe(1);
    expect(result.total).toBe(3);
  });

  it('falls back to the span name, which is how most spans are named', () => {
    // `trace('sendEmail', ...)` produces a span named for the operation and no
    // http.route at all. A job that ran is covered, whatever the shape.
    const result = joinCoverage(routes, {
      routeCounts: {},
      spanNameCounts: { sendEmail: 3, 'POST /orders': 7 },
    });

    expect(find(result, '/orders').seen).toBe(true);
    expect(find(result, 'sendEmail').seen).toBe(true);
    expect(find(result, '/users').seen).toBe(false);
  });

  it('does not credit a route to a different method on the same path', () => {
    // `GET /orders` running says nothing about whether `POST /orders` ever did.
    const result = joinCoverage(routes, {
      routeCounts: {},
      spanNameCounts: { 'GET /orders': 5 },
    });

    expect(find(result, '/orders').seen).toBe(false);
  });

  it('lists what was never seen first, since that is what you came for', () => {
    const result = joinCoverage(routes, {
      routeCounts: { '/users': 12 },
      spanNameCounts: {},
    });

    expect(result.entries.map((e) => e.seen)).toEqual([false, false, true]);
  });
});
