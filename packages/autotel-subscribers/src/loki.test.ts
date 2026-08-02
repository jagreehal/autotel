import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LokiSubscriber,
  buildLokiPayload,
  resolveLokiPushUrl,
  sendBatchToLoki,
  toLokiHeaders,
  toLokiLabels,
  toLokiTimestamp,
} from './loki';

describe('resolveLokiPushUrl', () => {
  it('appends the push path', () => {
    expect(resolveLokiPushUrl('http://localhost:3100')).toBe(
      'http://localhost:3100/loki/api/v1/push',
    );
  });

  it('tolerates a trailing slash', () => {
    expect(resolveLokiPushUrl('http://localhost:3100//')).toBe(
      'http://localhost:3100/loki/api/v1/push',
    );
  });

  it('does not double the path when it is already there', () => {
    const url = 'http://localhost:3100/loki/api/v1/push';
    expect(resolveLokiPushUrl(url)).toBe(url);
  });
});

describe('toLokiTimestamp', () => {
  it('converts ISO time to nanosecond epoch', () => {
    expect(toLokiTimestamp('2026-01-01T00:00:00.000Z')).toBe(
      '1767225600000000000',
    );
  });

  it('falls back to now for an unparseable value', () => {
    const before = Date.now();
    // Drop the nanosecond padding rather than dividing: the full value is past
    // Number.MAX_SAFE_INTEGER, so parsing it loses the low bits and can land a
    // fraction of a millisecond short of `before`.
    const result = Number(toLokiTimestamp('not-a-date').slice(0, -6));
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(Date.now());
  });
});

describe('toLokiLabels', () => {
  it('promotes only the configured fields', () => {
    const labels = toLokiLabels({
      service: 'checkout',
      environment: 'production',
      level: 'error',
      requestId: 'req_1',
    });
    expect(labels).toEqual({
      service: 'checkout',
      environment: 'production',
      level: 'error',
    });
    expect(labels.requestId).toBeUndefined();
  });

  it('merges static labels', () => {
    expect(
      toLokiLabels({ service: 'api' }, { labels: { cluster: 'prod-eu' } }),
    ).toEqual({ service: 'api', cluster: 'prod-eu' });
  });

  it('skips objects and arrays rather than stringifying them', () => {
    const labels = toLokiLabels(
      { service: 'api', meta: { a: 1 }, tags: ['x'] },
      { labelFields: ['service', 'meta', 'tags'] },
    );
    expect(labels).toEqual({ service: 'api' });
  });

  it('keeps numbers and booleans, which are bounded', () => {
    const labels = toLokiLabels(
      { retry: 2, cached: true },
      { labelFields: ['retry', 'cached'] },
    );
    expect(labels).toEqual({ retry: '2', cached: 'true' });
  });
});

describe('buildLokiPayload', () => {
  it('groups events sharing a label set into one stream', () => {
    const payload = buildLokiPayload([
      { service: 'api', level: 'info', timestamp: '2026-01-01T00:00:00.000Z' },
      { service: 'api', level: 'info', timestamp: '2026-01-01T00:00:01.000Z' },
      { service: 'api', level: 'error', timestamp: '2026-01-01T00:00:02.000Z' },
    ]);

    expect(payload.streams).toHaveLength(2);
    const info = payload.streams.find((s) => s.stream.level === 'info');
    expect(info?.values).toHaveLength(2);
  });

  it('orders entries within a stream, because Loki rejects out-of-order pushes', () => {
    const payload = buildLokiPayload([
      { service: 'api', timestamp: '2026-01-01T00:00:09.000Z' },
      { service: 'api', timestamp: '2026-01-01T00:00:01.000Z' },
      { service: 'api', timestamp: '2026-01-01T00:00:05.000Z' },
    ]);

    const stamps = payload.streams[0]!.values.map(([ts]) => BigInt(ts));
    expect(stamps).toEqual(stamps.toSorted((a, b) => (a < b ? -1 : 1)));
  });

  it('puts the whole event in the line so | json can reach it', () => {
    const payload = buildLokiPayload([
      { service: 'api', requestId: 'req_9', durationMs: 12 },
    ]);
    const line = JSON.parse(payload.streams[0]!.values[0]![1]) as Record<
      string,
      unknown
    >;
    expect(line.requestId).toBe('req_9');
    expect(line.durationMs).toBe(12);
  });

  it('returns no streams for no events', () => {
    expect(buildLokiPayload([]).streams).toEqual([]);
  });
});

describe('toLokiHeaders', () => {
  it('uses Basic when a Grafana Cloud user is present', () => {
    const headers = toLokiHeaders({ user: '123456', apiKey: 'glc_x' });
    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from('123456:glc_x').toString('base64')}`,
    );
  });

  it('uses Bearer for a token alone', () => {
    expect(toLokiHeaders({ apiKey: 'tok' }).Authorization).toBe('Bearer tok');
  });

  it('sends the tenant header independently of auth', () => {
    const headers = toLokiHeaders({ tenantId: 'team-checkout' });
    expect(headers['X-Scope-OrgID']).toBe('team-checkout');
    expect(headers.Authorization).toBeUndefined();
  });

  it('sends nothing for an unauthenticated instance', () => {
    expect(toLokiHeaders({})).toEqual({});
  });
});

describe('LokiSubscriber', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    // Loki answers 204; a 204 Response must be constructed with a null body.
    fetchMock.mockResolvedValue(
      new Response(null, { status: 204, statusText: 'No Content' }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LOKI_ENDPOINT;
  });

  function pushedBody(): { streams: { stream: Record<string, string> }[] } {
    return JSON.parse(fetchMock.mock.calls[0]![1].body as string);
  }

  it('buffers until the batch fills, then pushes once', async () => {
    const subscriber = new LokiSubscriber({
      endpoint: 'http://localhost:3100',
      batchSize: 3,
    });

    await subscriber.trackEvent('a');
    await subscriber.trackEvent('b');
    expect(fetchMock).not.toHaveBeenCalled();

    await subscriber.trackEvent('c');
    await subscriber.shutdown();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      'http://localhost:3100/loki/api/v1/push',
    );
  });

  it('flushes what is buffered on shutdown', async () => {
    const subscriber = new LokiSubscriber({
      endpoint: 'http://localhost:3100',
      batchSize: 100,
    });

    await subscriber.trackEvent('checkout.completed', { service: 'checkout' });
    expect(fetchMock).not.toHaveBeenCalled();

    await subscriber.shutdown();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pushedBody().streams[0]!.stream.service).toBe('checkout');
  });

  it('reads the endpoint from the environment', async () => {
    process.env.LOKI_ENDPOINT = 'http://env-host:3100';
    const subscriber = new LokiSubscriber({ batchSize: 1 });

    await subscriber.trackEvent('a');
    await subscriber.shutdown();

    expect(fetchMock.mock.calls[0]![0]).toBe(
      'http://env-host:3100/loki/api/v1/push',
    );
  });

  it('never throws at the call site when no endpoint is configured', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const subscriber = new LokiSubscriber({ batchSize: 1 });

    await expect(subscriber.trackEvent('a')).resolves.toBeUndefined();
    await expect(subscriber.trackEvent('b')).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    // Warned once, not once per event.
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('sends nothing when disabled', async () => {
    const subscriber = new LokiSubscriber({
      endpoint: 'http://localhost:3100',
      enabled: false,
      batchSize: 1,
    });

    await subscriber.trackEvent('a');
    await subscriber.shutdown();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('records funnel, outcome and value events', async () => {
    const subscriber = new LokiSubscriber({
      endpoint: 'http://localhost:3100',
      batchSize: 100,
    });

    await subscriber.trackFunnelStep('signup', 'started');
    await subscriber.trackOutcome('checkout', 'success');
    await subscriber.trackValue('cart.total', 42);
    await subscriber.shutdown();

    const lines = pushedBody().streams.flatMap((s) =>
      (s as unknown as { values: [string, string][] }).values.map(([, line]) =>
        JSON.parse(line),
      ),
    );
    expect(lines.map((l) => l.type).toSorted()).toEqual([
      'funnel',
      'outcome',
      'value',
    ]);
  });
});

describe('sendBatchToLoki', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.LOKI_ENDPOINT;
  });

  it('rejects when no endpoint is configured', async () => {
    await expect(sendBatchToLoki([{ service: 'a' }])).rejects.toThrow(
      /endpoint is not configured/,
    );
  });

  it('is a no-op for an empty batch, without needing an endpoint', async () => {
    await expect(sendBatchToLoki([])).resolves.toBeUndefined();
  });
});
