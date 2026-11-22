import { describe, expect, it } from 'vitest';
import type { Issue } from 'autotel-devtools/issues';
import {
  DEPLOY_DETECTED,
  encodeCursor,
  INDEXING_LAG_MS,
  ISSUE_OPENED,
  pollTelemetryEvents,
  REPLAY_CEILING_MS,
  type TelemetryEventSources,
} from '../src/modules/telemetry-events';
import type { SpanRecord } from '../src/types';
import { FixtureBackend } from '../src/backends/fixture/index';
import { telemetryEventSources } from '../src/tools/events';

const NOW = Date.parse('2026-11-21T12:00:00Z');
const MIN = 60_000;

const issue = (fingerprint: string, firstSeen: number): Issue => ({
  fingerprint,
  service: 'checkout',
  source: 'exception',
  title: 'TypeError: secret customer note',
  type: 'TypeError',
  message: 'secret customer note',
  operation: 'POST /checkout',
  status: 'active',
  count: 3,
  firstSeen,
  lastSeen: NOW - MIN,
  trend: [],
  regression: false,
  versions: [],
  affected: { users: 0, accounts: 0, sessions: 0 },
  sampleTraceIds: ['4bf92f3577b34da6a3ce929d0e0e4736'],
});

const span = (version: string, start: number, error = false): SpanRecord => ({
  traceId: `t${start}`,
  spanId: `s${start}`,
  parentSpanId: null,
  operationName: 'op',
  serviceName: 'checkout',
  startTimeUnixMs: start,
  durationMs: 10,
  tags: { 'service.version': version },
  hasError: error,
  statusCode: error ? 'ERROR' : 'OK',
});

function sources(issues: Issue[], spans: SpanRecord[] = [], capped = false) {
  const asked: Array<{ startMs: number; endMs: number }> = [];
  const s: TelemetryEventSources = {
    issues: async (q) => (asked.push(q), { items: issues, capped }),
    spans: async (q) => (asked.push(q), { items: spans, capped }),
  };
  return { s, asked };
}

describe('telemetry events', () => {
  it('starts from now on a null cursor, reading nothing', async () => {
    const { s, asked } = sources([issue('a', NOW - MIN)]);
    const result = await pollTelemetryEvents(
      { name: ISSUE_OPENED, cursor: null },
      s,
      NOW,
    );
    expect(result).toMatchObject({ events: [], cursor: encodeCursor(NOW) });
    expect(asked).toEqual([]);
  });

  it('delivers issues first seen since the cursor, with ids and no error text', async () => {
    const { s } = sources([
      issue('old', NOW - 30 * MIN),
      issue('new', NOW - 2 * MIN),
    ]);
    const { events, cursor, truncated } = await pollTelemetryEvents(
      { name: ISSUE_OPENED, cursor: encodeCursor(NOW - 5 * MIN) },
      s,
      NOW,
    );
    expect(events).toEqual([
      {
        eventId: 'issue:new',
        name: ISSUE_OPENED,
        timestamp: new Date(NOW - 2 * MIN).toISOString(),
        data: {
          fingerprint: 'new',
          service: 'checkout',
          errorType: 'TypeError',
          operation: 'POST /checkout',
          firstSeen: new Date(NOW - 2 * MIN).toISOString(),
          occurrences: 3,
          traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        },
      },
    ]);
    // An exception message is untrusted input: the agent fetches it with get_issue.
    expect(JSON.stringify(events)).not.toContain('secret');
    expect(cursor).toBe(encodeCursor(NOW - INDEXING_LAG_MS));
    expect(truncated).toBe(false);
  });

  // A backend indexes late: an issue that happened a minute ago may not be
  // visible yet, so the cursor must not step past it.
  it('holds the cursor behind now, so a record indexed late is still delivered', async () => {
    const indexed: Issue[] = [];
    const { s } = sources(indexed);
    const first = await pollTelemetryEvents(
      { name: ISSUE_OPENED, cursor: encodeCursor(NOW - 5 * MIN) },
      s,
      NOW,
    );
    expect(first.events).toEqual([]);
    indexed.push(issue('late', NOW - MIN));
    const next = await pollTelemetryEvents(
      { name: ISSUE_OPENED, cursor: first.cursor },
      s,
      NOW + MIN,
    );
    expect(next.events.map((e) => e.eventId)).toEqual(['issue:late']);
  });

  // maxAgeMs inside the indexing lag must still deliver what is settled.
  it('delivers events with a maxAgeMs shorter than the indexing lag', async () => {
    const { s } = sources([issue('recent', NOW - INDEXING_LAG_MS - 30_000)]);
    const result = await pollTelemetryEvents(
      {
        name: ISSUE_OPENED,
        cursor: encodeCursor(NOW - 10 * MIN),
        maxAgeMs: 60_000,
      },
      s,
      NOW,
    );
    expect(result.events.map((e) => e.eventId)).toEqual(['issue:recent']);
    expect(result.truncated).toBe(true);
  });

  it('says truncated when issues came from searches that hit their limit', async () => {
    const { s } = sources([], [], true);
    const result = await pollTelemetryEvents(
      { name: ISSUE_OPENED, cursor: encodeCursor(NOW - 5 * MIN) },
      s,
      NOW,
    );
    expect(result.truncated).toBe(true);
  });

  // A to B, a rollback through C to A, then A to B again: two deploys.
  it('gives a version rolled out twice two event ids', async () => {
    const { s } = sources(
      [],
      [
        'A',
        'A',
        'A',
        'B',
        'B',
        'B',
        'C',
        'C',
        'C',
        'A',
        'A',
        'A',
        'B',
        'B',
        'B',
      ].map((version, index) => span(version, NOW - (40 - index * 2) * MIN)),
    );
    const { events } = await pollTelemetryEvents(
      { name: DEPLOY_DETECTED, cursor: encodeCursor(NOW - 60 * MIN) },
      s,
      NOW,
    );
    const ids = events.map((e) => e.eventId);
    expect(
      ids.filter((id) => id.startsWith('deploy:checkout:A:B:')),
    ).toHaveLength(2);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Events tied at the settled instant, read one per page within the same
  // millisecond: the second page must still be there.
  it('pages through events tied at the settled instant', async () => {
    const settled = NOW - INDEXING_LAG_MS;
    const { s } = sources([issue('a', settled), issue('b', settled)]);
    const first = await pollTelemetryEvents(
      { name: ISSUE_OPENED, cursor: encodeCursor(NOW - 5 * MIN), maxEvents: 1 },
      s,
      NOW,
    );
    expect(first).toMatchObject({ hasMore: true });
    const rest = await pollTelemetryEvents(
      { name: ISSUE_OPENED, cursor: first.cursor, maxEvents: 1 },
      s,
      NOW,
    );
    expect(rest.events.map((e) => e.eventId)).toEqual(['issue:b']);
    expect(rest.hasMore).toBe(false);
  });

  // A low-traffic rollback: the first poll sees one span of the old version,
  // the next sees it confirmed. The event must not fall behind the cursor.
  it('delivers a rollback confirmed after a poll passed its first span', async () => {
    const spans = [
      span('A', NOW - 50 * MIN),
      span('A', NOW - 45 * MIN),
      span('A', NOW - 40 * MIN),
      span('B', NOW - 30 * MIN),
      span('B', NOW - 25 * MIN),
      span('B', NOW - 20 * MIN),
      span('A', NOW - 10 * MIN),
    ];
    const { s } = sources([], spans);
    const first = await pollTelemetryEvents(
      { name: DEPLOY_DETECTED, cursor: encodeCursor(NOW - 15 * MIN) },
      s,
      NOW,
    );
    expect(first.events).toEqual([]);
    spans.push(span('A', NOW + 5 * MIN), span('A', NOW + 10 * MIN));
    const later = NOW + 15 * MIN;
    const second = await pollTelemetryEvents(
      { name: DEPLOY_DETECTED, cursor: first.cursor },
      s,
      later,
    );
    expect(second.events).toEqual([
      expect.objectContaining({
        eventId: `deploy:checkout:B:A:${NOW - 10 * MIN}`,
        timestamp: new Date(NOW + 10 * MIN).toISOString(),
        data: expect.objectContaining({
          changedAt: new Date(NOW - 10 * MIN).toISOString(),
        }),
      }),
    ]);
  });

  // A third version's spans say nothing about a return to an earlier one.
  it('does not confirm a rollback from spans of a third version', async () => {
    const spans = [
      span('A', NOW - 50 * MIN),
      span('B', NOW - 40 * MIN),
      span('A', NOW - 30 * MIN),
      span('C', NOW - 20 * MIN),
      span('C', NOW - 10 * MIN),
    ];
    const { s } = sources([], spans);
    const result = await pollTelemetryEvents(
      { name: DEPLOY_DETECTED, cursor: encodeCursor(NOW - 55 * MIN) },
      s,
      NOW,
    );
    expect(
      result.events.map((e) => [e.data?.fromVersion, e.data?.toVersion]),
    ).toEqual([
      ['A', 'B'],
      ['B', 'C'],
    ]);
  });

  it('says truncated when the deploy sample was capped', async () => {
    const { s } = sources([], [span('1.0', NOW - 20 * MIN)], true);
    const result = await pollTelemetryEvents(
      { name: DEPLOY_DETECTED, cursor: encodeCursor(NOW - 5 * MIN) },
      s,
      NOW,
    );
    expect(result.truncated).toBe(true);
  });

  it('honours maxEvents when events share an instant', async () => {
    const { s } = sources([
      issue('a', NOW - 3 * MIN),
      issue('b', NOW - 3 * MIN),
    ]);
    const first = await pollTelemetryEvents(
      { name: ISSUE_OPENED, cursor: encodeCursor(NOW - 5 * MIN), maxEvents: 1 },
      s,
      NOW,
    );
    expect(first.events.map((e) => e.eventId)).toEqual(['issue:a']);
    expect(first.hasMore).toBe(true);
    const rest = await pollTelemetryEvents(
      { name: ISSUE_OPENED, cursor: first.cursor, maxEvents: 1 },
      s,
      NOW,
    );
    expect(rest.events.map((e) => e.eventId)).toEqual(['issue:b']);
    expect(rest.hasMore).toBe(false);
  });

  // Unencoded, A -> B:C and A:B -> C would share an id.
  it('encodes each part of a deploy id', async () => {
    const { s } = sources(
      [],
      [span('A', NOW - 20 * MIN), span('B:C', NOW - 3 * MIN)],
    );
    const { events } = await pollTelemetryEvents(
      { name: DEPLOY_DETECTED, cursor: encodeCursor(NOW - 5 * MIN) },
      s,
      NOW,
    );
    expect(events.map((e) => e.eventId)).toEqual([
      `deploy:checkout:A:B%3AC:${NOW - 3 * MIN}`,
    ]);
  });

  it('detects a deploy after the cursor against spans from before it', async () => {
    const { s, asked } = sources(
      [],
      [
        span('1.0', NOW - 40 * MIN),
        span('1.0', NOW - 20 * MIN),
        span('1.1', NOW - 3 * MIN, true),
        span('1.1', NOW - MIN),
      ],
    );
    const { events } = await pollTelemetryEvents(
      { name: DEPLOY_DETECTED, cursor: encodeCursor(NOW - 5 * MIN) },
      s,
      NOW,
    );
    expect(asked[0]?.startMs).toBe(NOW - 5 * MIN - 60 * MIN);
    expect(events).toEqual([
      expect.objectContaining({
        eventId: `deploy:checkout:1.0:1.1:${NOW - 3 * MIN}`,
        data: expect.objectContaining({
          fromVersion: '1.0',
          toVersion: '1.1',
          errorRateBefore: 0,
          errorRateAfter: 0.5,
        }),
      }),
    ]);
  });

  it('says truncated when the cursor is older than the replay ceiling or maxAgeMs', async () => {
    const { s } = sources([issue('a', NOW - 2 * MIN)]);
    const stale = await pollTelemetryEvents(
      { name: ISSUE_OPENED, cursor: encodeCursor(NOW - REPLAY_CEILING_MS - 1) },
      s,
      NOW,
    );
    expect(stale.truncated).toBe(true);
    expect(stale.events).toHaveLength(1);

    const bounded = await pollTelemetryEvents(
      {
        name: ISSUE_OPENED,
        cursor: encodeCursor(NOW - 10 * MIN),
        maxAgeMs: MIN,
      },
      s,
      NOW,
    );
    // Counted back from the newest deliverable instant, two minutes ago.
    expect(bounded.truncated).toBe(true);
    expect(bounded.events.map((e) => e.eventId)).toEqual(['issue:a']);
  });

  it('returns a partial batch with hasMore and a cursor at its last event', async () => {
    const { s } = sources([
      issue('a', NOW - 4 * MIN),
      issue('b', NOW - 3 * MIN),
      issue('c', NOW - 2 * MIN),
    ]);
    const first = await pollTelemetryEvents(
      { name: ISSUE_OPENED, cursor: encodeCursor(NOW - 5 * MIN), maxEvents: 2 },
      s,
      NOW,
    );
    expect(first.events.map((e) => e.eventId)).toEqual(['issue:a', 'issue:b']);
    expect(first).toMatchObject({
      hasMore: true,
      cursor: encodeCursor(NOW - 3 * MIN, 'issue:b'),
    });
    const rest = await pollTelemetryEvents(
      { name: ISSUE_OPENED, cursor: first.cursor },
      s,
      NOW,
    );
    expect(rest.events.map((e) => e.eventId)).toEqual(['issue:c']);
  });

  it('refuses an unknown event type and a cursor it did not issue', async () => {
    const { s } = sources([]);
    await expect(
      pollTelemetryEvents({ name: 'made.up', cursor: null }, s, NOW),
    ).rejects.toMatchObject({ kind: 'NotFound' });
    await expect(
      pollTelemetryEvents(
        { name: ISSUE_OPENED, cursor: 'historyId_9' },
        s,
        NOW,
      ),
    ).rejects.toMatchObject({ kind: 'InvalidParams' });
  });

  it('reads a real backend through the same sources the server uses', async () => {
    const backend = new FixtureBackend(
      new URL('../fixtures/telemetry.json', import.meta.url).pathname,
    );
    const real = telemetryEventSources(backend);
    for (const name of [ISSUE_OPENED, DEPLOY_DETECTED]) {
      const result = await pollTelemetryEvents(
        { name, cursor: encodeCursor(Date.now() - 10 * MIN) },
        real,
      );
      expect(Array.isArray(result.events)).toBe(true);
      expect(result.cursor).toMatch(/^t:\d+(:.+)?$/);
    }
  });

  it('recommends a slower poll on a rate-limited backend', async () => {
    const backend = new FixtureBackend(
      new URL('../fixtures/telemetry.json', import.meta.url).pathname,
    );
    const limited = telemetryEventSources(
      // SAFETY: telemetryEventSources reads only `aggregateSpans` off it, to
      // pick the poll interval; the fixture backend serves the rest.
      Object.assign(backend, { aggregateSpans: async () => [] }) as never,
    );
    const result = await pollTelemetryEvents(
      { name: ISSUE_OPENED, cursor: null },
      limited,
    );
    expect(result.nextPollMs).toBe(300_000);
  });
});
