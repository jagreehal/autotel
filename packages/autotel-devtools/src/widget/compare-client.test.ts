/**
 * Client for the cohort comparison endpoint.
 *
 * Same discipline as `query-client`: the distinctions in the result are the
 * point. "Your query is wrong", "nothing matched", "the server can't do this"
 * and "here is the answer" are four different things to the person reading,
 * and collapsing them into one empty table is how a comparison stops being
 * believed.
 */

import { describe, it, expect, vi } from 'vitest';
import { compareCohorts } from './compare-client';

const BASE = 'http://localhost:4318';

function stubFetch(status: number, body: unknown) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

describe('compareCohorts', () => {
  it('returns the ranked differences', async () => {
    const fetchFn = stubFetch(200, {
      differences: [
        {
          field: 'payment.provider',
          value: 'legacy',
          outlierFraction: 1,
          baselineFraction: 0,
          difference: 1,
          outlierCount: 20,
          baselineCount: 0,
        },
      ],
      outlierCount: 20,
      baselineCount: 30,
    });

    const result = await compareCohorts(
      { outlier: { query: 'duration > 500' }, baseline: { query: '' } },
      { fetch: fetchFn, baseUrl: BASE },
    );

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.differences[0].field).toBe('payment.provider');
    expect(result.outlierCount).toBe(20);
  });

  it('separates an empty population from a real answer', async () => {
    const fetchFn = stubFetch(200, {
      differences: [],
      outlierCount: 0,
      baselineCount: 30,
    });

    const result = await compareCohorts(
      { outlier: { query: 'duration > 999999' }, baseline: { query: '' } },
      { fetch: fetchFn, baseUrl: BASE },
    );

    expect(result.status).toBe('empty');
  });

  it('surfaces a bad query as its own outcome', async () => {
    const fetchFn = stubFetch(400, { error: 'Invalid comparison request' });

    const result = await compareCohorts(
      { outlier: { query: 'duration > >' }, baseline: { query: '' } },
      { fetch: fetchFn, baseUrl: BASE },
    );

    expect(result.status).toBe('invalid');
  });

  it('explains a server that cannot compare at all', async () => {
    // 501: autotel is a peer dependency and this viewer is running without it.
    const fetchFn = stubFetch(501, {
      error: 'Comparison unavailable',
      message:
        'Install `autotel` alongside autotel-devtools to compare cohorts.',
    });

    const result = await compareCohorts(
      { outlier: { query: '' }, baseline: { query: '' } },
      { fetch: fetchFn, baseUrl: BASE },
    );

    expect(result.status).toBe('unavailable');
    if (result.status !== 'unavailable') return;
    expect(result.message).toContain('Install');
  });
});
