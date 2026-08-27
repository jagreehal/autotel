/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi } from 'vitest';
import { listMetrics, fetchMetricSeries } from '../metrics-client';

const BASE = 'http://localhost:4318';

function stubFetch(status: number, body: unknown) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  ) as unknown as typeof fetch;
}

describe('listMetrics', () => {
  it('returns the catalogue', async () => {
    const result = await listMetrics({
      fetch: stubFetch(200, {
        metrics: [{ name: 'a', kind: 'sum', seriesCount: 1 }],
      }),
      baseUrl: BASE,
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.data).toHaveLength(1);
  });

  it('returns an empty catalogue rather than an error when there are no metrics', async () => {
    // "No metrics yet" and "the server is unreachable" must not look the same.
    const result = await listMetrics({
      fetch: stubFetch(200, {}),
      baseUrl: BASE,
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.data).toEqual([]);
  });

  it('reports an unreachable server as an error', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;

    const result = await listMetrics({ fetch: fetchFn, baseUrl: BASE });
    expect(result.status).toBe('error');
  });

  it('explains a 403 in terms of the origin guard', async () => {
    const result = await listMetrics({
      fetch: stubFetch(403, { error: 'Forbidden' }),
      baseUrl: BASE,
    });
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.message).toMatch(/origin|Forbidden/i);
  });
});

describe('fetchMetricSeries', () => {
  it('posts the metric name', async () => {
    const fetchFn = stubFetch(200, { series: [] });
    await fetchMetricSeries(
      { name: 'http.requests' },
      { fetch: fetchFn, baseUrl: BASE },
    );

    const calls = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const body = JSON.parse((calls[0][1] as RequestInit).body as string);
    expect(body.name).toBe('http.requests');
  });

  it('omits the window when none is given', async () => {
    const fetchFn = stubFetch(200, { series: [] });
    await fetchMetricSeries({ name: 'm' }, { fetch: fetchFn, baseUrl: BASE });

    const calls = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const body = JSON.parse((calls[0][1] as RequestInit).body as string);
    expect(body).not.toHaveProperty('window');
  });

  it('sends a bounded window', async () => {
    const fetchFn = stubFetch(200, { series: [] });
    await fetchMetricSeries(
      { name: 'm', window: { start: 1, end: 2 } },
      { fetch: fetchFn, baseUrl: BASE },
    );

    const calls = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const body = JSON.parse((calls[0][1] as RequestInit).body as string);
    expect(body.window).toEqual({ start: 1, end: 2 });
  });

  it('reports an aborted request distinctly from a failure', async () => {
    const fetchFn = vi.fn(async () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      throw error;
    }) as unknown as typeof fetch;

    const result = await fetchMetricSeries(
      { name: 'm' },
      { fetch: fetchFn, baseUrl: BASE },
    );
    expect(result.status).toBe('aborted');
  });

  it('surfaces a 400 as an error with the server message', async () => {
    const result = await fetchMetricSeries(
      { name: '' },
      {
        fetch: stubFetch(400, { error: 'A metric name is required' }),
        baseUrl: BASE,
      },
    );
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.message).toMatch(/required/);
  });
});
