/**
 * Round-trip against a real Loki: push events, query them back, and assert the
 * labels, the JSON line and the timestamp all survived.
 *
 * Start one with the repo's LGTM stack, then run this suite:
 *
 *   docker compose -f docker-compose.lgtm.yml up -d
 *   LOKI_ENDPOINT=http://localhost:3100 pnpm --filter autotel-subscribers test
 *
 * Without `LOKI_ENDPOINT` the suite skips rather than passing silently, so a
 * green run never implies Loki was exercised.
 */

import { describe, expect, it } from 'vitest';
import { LokiSubscriber } from './loki';

const ENDPOINT = process.env.LOKI_ENDPOINT;

interface QueryResult {
  data?: {
    result?: { stream: Record<string, string>; values: [string, string][] }[];
  };
}

async function queryBack(service: string): Promise<QueryResult['data']> {
  const end = Date.now() * 1e6;
  const start = end - 5 * 60 * 1e9;
  const query = encodeURIComponent(`{service="${service}"}`);
  const response = await fetch(
    `${ENDPOINT}/loki/api/v1/query_range?query=${query}&start=${start}&end=${end}`,
  );
  expect(response.ok).toBe(true);
  return ((await response.json()) as QueryResult).data;
}

describe.skipIf(!ENDPOINT)('LokiSubscriber against a live Loki', () => {
  it('pushes events that come back with their labels and full line', async () => {
    // Unique per run so a re-run never reads the previous run's entries.
    const service = `autotel-e2e-${Date.now()}`;
    const subscriber = new LokiSubscriber({
      endpoint: ENDPOINT,
      batchSize: 100,
      labels: { cluster: 'local' },
    });

    await subscriber.trackEvent('checkout.completed', {
      service,
      environment: 'test',
      level: 'info',
      requestId: 'req_4a8ff3a8',
      path: '/api/orders',
      durationMs: 142,
    });
    await subscriber.trackOutcome('checkout', 'success', {
      service,
      environment: 'test',
      level: 'error',
    });
    await subscriber.shutdown();

    // Loki indexes asynchronously; poll rather than sleeping a fixed time.
    let result: QueryResult['data'];
    for (let attempt = 0; attempt < 20; attempt++) {
      result = await queryBack(service);
      if ((result?.result?.length ?? 0) >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const streams = result?.result ?? [];
    // Two levels means two label sets, so two streams.
    expect(streams).toHaveLength(2);

    const info = streams.find((s) => s.stream.level === 'info');
    expect(info?.stream.service).toBe(service);
    expect(info?.stream.environment).toBe('test');
    expect(info?.stream.cluster).toBe('local');
    // High-cardinality fields must stay out of the index.
    expect(info?.stream.requestId).toBeUndefined();
    expect(info?.stream.path).toBeUndefined();

    const line = JSON.parse(info!.values[0]![1]) as Record<string, unknown>;
    expect(line.name).toBe('checkout.completed');
    expect(line.requestId).toBe('req_4a8ff3a8');
    expect(line.path).toBe('/api/orders');
    expect(line.durationMs).toBe(142);
  }, 30_000);
});
