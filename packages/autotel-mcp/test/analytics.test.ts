import { describe, expect, it } from 'vitest';
import {
  aggregateLogs,
  aggregateSpans,
  logPattern,
  whatChanged,
} from '../src/modules/span-aggregate';
import { findRootCause, selfTimes } from '../src/modules/correlator';
import { grafanaAuth } from '../src/backends/factory';
import { TempoBackend } from '../src/backends/tempo/index';
import { mergeSlices, sampleAcrossWindow } from '../src/tools/analytics';
import type { LogRecord, SpanRecord } from '../src/types';

function span(overrides: Partial<SpanRecord> & { spanId: string }): SpanRecord {
  return {
    traceId: 't',
    parentSpanId: null,
    operationName: 'op',
    serviceName: 'api',
    startTimeUnixMs: 0,
    durationMs: 10,
    tags: {},
    hasError: false,
    statusCode: 'OK',
    ...overrides,
  };
}

describe('aggregateSpans', () => {
  it('groups by shorthand and tag fields with error rate and percentiles', () => {
    const spans = [
      ...Array.from({ length: 9 }, (_, i) =>
        span({
          spanId: `a${i}`,
          durationMs: i + 1,
          tags: { 'http.route': '/a' },
        }),
      ),
      span({
        spanId: 'a9',
        durationMs: 100,
        hasError: true,
        tags: { 'http.route': '/a' },
      }),
      span({ spanId: 'b', serviceName: 'db', tags: { 'http.route': '/b' } }),
    ];

    const rows = aggregateSpans(spans, { groupBy: ['service', 'http.route'] });

    expect(rows[0]).toMatchObject({
      group: { service: 'api', 'http.route': '/a' },
      count: 10,
      errorCount: 1,
      errorRate: 0.1,
      p50Ms: 5,
      maxMs: 100,
    });
    expect(rows[1]!.group).toEqual({ service: 'db', 'http.route': '/b' });
  });

  it('buckets each group into a time series', () => {
    const rows = aggregateSpans(
      [
        span({ spanId: '1', startTimeUnixMs: 0 }),
        span({ spanId: '2', startTimeUnixMs: 30_000 }),
        span({ spanId: '3', startTimeUnixMs: 61_000 }),
      ],
      { bucketMinutes: 1 },
    );
    expect(rows[0]!.buckets!.map((b) => [b.startUnixMs, b.count])).toEqual([
      [0, 2],
      [60_000, 1],
    ]);
  });
});

describe('whatChanged', () => {
  it('finds a version change and the regression after it', () => {
    const v = (version: string, spanId: string, start: number, error = false) =>
      span({
        spanId,
        startTimeUnixMs: start,
        hasError: error,
        tags: { 'service.version': version },
      });
    const result = whatChanged([
      v('1.0', 'a', 0),
      v('1.0', 'b', 10),
      v('1.1', 'c', 20, true),
      v('1.1', 'd', 30),
      span({ spanId: 'e', serviceName: 'legacy' }),
      // Datadog files the version as `version`.
      span({ spanId: 'f', serviceName: 'worker', tags: { version: '7' } }),
    ]);

    expect(result.changes).toEqual([
      expect.objectContaining({
        service: 'api',
        from: '1.0',
        to: '1.1',
        changedAtUnixMs: 20,
        errorRateDelta: 0.5,
      }),
    ]);
    expect(result.unchanged).toEqual([{ service: 'worker', version: '7' }]);
    expect(result.unversioned).toEqual(['legacy']);
  });
});

describe('log patterns', () => {
  it('masks the variable parts of a message', () => {
    expect(
      logPattern(
        'user 42 (a@b.com) from 10.0.0.1 failed: "bad token" id=3f2b1c4d-1111-2222-3333-444455556666',
      ),
    ).toBe('user <n> (<email>) from <ip> failed: <str> id=<uuid>');
  });

  it('names an empty message rather than grouping it as ""', () => {
    expect(logPattern('  ')).toBe('(empty message)');
  });

  it('counts messages that differ only in ids as one pattern', () => {
    const log = (body: string): LogRecord => ({
      timestampUnixMs: 0,
      severityText: 'ERROR',
      body,
      serviceName: 'api',
    });
    const [row] = aggregateLogs(
      [log('user 42 not found'), log('user 97 not found'), log('db down')],
      { groupBy: ['service', 'severity'] },
    );

    expect(row).toMatchObject({
      group: { service: 'api', severity: 'ERROR' },
      count: 3,
    });
    expect(row!.patterns[0]).toEqual({
      pattern: 'user <n> not found',
      count: 2,
      example: 'user 42 not found',
    });
  });
});

describe('self time', () => {
  // handler 0-100 awaits query 10-90: the handler is slowest by duration,
  // but the query is where the time went.
  const spans = [
    span({ spanId: 'root', operationName: 'GET /', durationMs: 100 }),
    span({
      spanId: 'handler',
      parentSpanId: 'root',
      operationName: 'handler',
      durationMs: 100,
    }),
    span({
      spanId: 'q1',
      parentSpanId: 'handler',
      operationName: 'query',
      startTimeUnixMs: 10,
      durationMs: 50,
    }),
    span({
      spanId: 'q2',
      parentSpanId: 'handler',
      operationName: 'query',
      startTimeUnixMs: 40,
      durationMs: 50,
    }),
  ];

  it('subtracts the union of overlapping children', () => {
    const self = selfTimes(spans);
    expect(self.get('handler')).toBe(20);
    expect(self.get('root')).toBe(0);
    expect(self.get('q1')).toBe(50);
  });

  it('blames the span with the most self time, not the longest wrapper', () => {
    const result = findRootCause({ traceId: 't', spans });
    expect(result.bottleneck.operationName).toBe('query');
    expect(result.selfTimeMs).toBe(50);
    expect(result.topSelfTime.map((s) => s.spanId).slice(0, 2)).toEqual([
      'q1',
      'q2',
    ]);
  });
});

describe('Grafana Cloud', () => {
  it('sends basic auth with the signal user id, bearer without one', () => {
    expect(grafanaAuth({ grafanaCloudToken: 'glc_x' }, '1401685')).toEqual({
      Authorization: `Basic ${Buffer.from('1401685:glc_x').toString('base64')}`,
    });
    expect(grafanaAuth({ grafanaCloudToken: 'tok' }, '')).toEqual({
      Authorization: 'Bearer tok',
    });
    expect(grafanaAuth({ grafanaCloudToken: '' }, '1')).toEqual({});
  });

  it('links a Tempo trace through Grafana Explore when Grafana is known', () => {
    expect(new TempoBackend('http://tempo').traceUrl('abc')).toBeUndefined();
    const url = new URL(
      new TempoBackend(
        'http://tempo',
        {},
        {
          url: 'https://me.grafana.net',
          datasourceUid: 'grafanacloud-traces',
        },
      ).traceUrl('abc')!,
    );
    expect(url.origin + url.pathname).toBe('https://me.grafana.net/explore');
    const panes = JSON.parse(url.searchParams.get('panes')!);
    expect(panes.a.queries[0]).toMatchObject({
      query: 'abc',
      datasource: { type: 'tempo', uid: 'grafanacloud-traces' },
    });
  });
});

describe('sampling across the window', () => {
  // A backend with inclusive bounds (the collector) returns a record sitting
  // exactly on a quarter boundary from both adjacent slices.
  it('counts a record on a slice boundary once', async () => {
    const at = [0, 250, 250, 400, 1000];
    const sample = await sampleAcrossWindow(
      0,
      1000,
      (n: number) => String(n),
      async (from, to) => ({
        items: at.filter((t) => t >= from && t <= to),
      }),
    );
    // 250 appears twice in the data (same instant, same slice) and stays twice;
    // the boundary copies from slice [0,250] and [250,500] collapse to one set.
    expect(sample.items.sort((a, b) => a - b)).toEqual([
      0, 250, 250, 400, 1000,
    ]);
  });

  it('keeps distinct records that share a slice', () => {
    expect(mergeSlices([[1, 1, 2], [2]], (n) => String(n)).sort()).toEqual([
      1, 1, 2,
    ]);
  });
});
