/**
 * Store contract, exercised against a real sqlite file rather than a mock.
 *
 * A mocked store cannot disagree with the code — it would pass whether or not
 * the schema, the indexes, the retention policy or the compiled SQL were
 * correct. These tests open a temp database, write to it, and read back, so the
 * things most likely to break (SQL that doesn't compile, a retention sweep that
 * deletes the wrong rows, a query whose parameters are misordered) actually
 * fail here.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DevtoolsStore } from '../store';
import { parseNavHash } from '../../../widget/url-sync';
import type { TraceData, SpanData } from '../../types';

let dir: string;
let store: DevtoolsStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'autotel-store-'));
  store = new DevtoolsStore({ path: join(dir, 'test.db') });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;

function span(overrides: Partial<SpanData> = {}): SpanData {
  seq++;
  const startTime = overrides.startTime ?? Date.now();
  const duration = overrides.duration ?? 10;
  return {
    spanId: `span-${seq}`,
    traceId: `trace-${seq}`,
    name: `op-${seq}`,
    kind: 'INTERNAL',
    startTime,
    endTime: startTime + duration,
    duration,
    attributes: {},
    status: { code: 'UNSET' },
    events: [],
    ...overrides,
  };
}

function trace(overrides: Partial<TraceData> = {}): TraceData {
  const spans = overrides.spans ?? [span()];
  const root = spans[0];
  return {
    traceId: root.traceId,
    correlationId: root.traceId,
    spans,
    startTime: root.startTime,
    endTime: root.endTime,
    duration: root.duration,
    status: 'OK',
    service: 'api',
    rootSpan: root,
    ...overrides,
  };
}

describe('DevtoolsStore — persistence', () => {
  it('reads back a written trace', () => {
    const t = trace();
    store.ingestTraces([t]);

    const found = store.getTrace(t.traceId);
    expect(found).not.toBeNull();
    expect(found!.traceId).toBe(t.traceId);
    expect(found!.spans).toHaveLength(1);
  });

  it('survives being closed and reopened', () => {
    const path = join(dir, 'persist.db');
    const first = new DevtoolsStore({ path });
    const t = trace();
    first.ingestTraces([t]);
    first.close();

    const second = new DevtoolsStore({ path });
    expect(second.getTrace(t.traceId)).not.toBeNull();
    second.close();
  });

  it('is idempotent on re-ingesting the same span', () => {
    const t = trace();
    store.ingestTraces([t]);
    store.ingestTraces([t]);

    expect(store.getTrace(t.traceId)!.spans).toHaveLength(1);
  });

  it('replaces a span attribute index when the span is re-ingested', () => {
    const original = span({
      traceId: 'replaced-attributes',
      spanId: 'query',
      attributes: { color: 'red' },
    });
    store.ingestTraces([
      trace({
        traceId: 'replaced-attributes',
        spans: [original],
        rootSpan: original,
      }),
    ]);

    const replacement = { ...original, attributes: {} };
    store.ingestTraces([
      trace({
        traceId: 'replaced-attributes',
        spans: [replacement],
        rootSpan: replacement,
      }),
    ]);

    expect(store.queryTraces({ query: 'color = red' }).traces).toEqual([]);
  });

  it('keeps equal span ids from different traces independent', () => {
    const firstSpan = span({ traceId: 'trace-a', spanId: 'shared-span' });
    const secondSpan = span({ traceId: 'trace-b', spanId: 'shared-span' });

    store.ingestTraces([
      trace({ traceId: 'trace-a', spans: [firstSpan], rootSpan: firstSpan }),
      trace({ traceId: 'trace-b', spans: [secondSpan], rootSpan: secondSpan }),
    ]);

    expect(store.countSpans()).toBe(2);
    expect(store.getTrace('trace-a')!.spans).toHaveLength(1);
    expect(store.getTrace('trace-b')!.spans).toHaveLength(1);
  });

  it('merges spans arriving for a trace in separate batches', () => {
    const first = span({ traceId: 'shared', spanId: 'a' });
    const second = span({ traceId: 'shared', spanId: 'b', parentSpanId: 'a' });

    store.ingestTraces([trace({ traceId: 'shared', spans: [first] })]);
    store.ingestTraces([trace({ traceId: 'shared', spans: [second] })]);

    expect(store.getTrace('shared')!.spans).toHaveLength(2);
  });

  it('replaces a provisional root when the real root arrives', () => {
    const child = span({
      traceId: 'shared',
      spanId: 'child',
      parentSpanId: 'root',
      startTime: 20,
    });
    store.ingestTraces([
      trace({
        traceId: 'shared',
        spans: [child],
        rootSpan: child,
        partial: true,
      }),
    ]);

    const root = span({
      traceId: 'shared',
      spanId: 'root',
      startTime: 10,
    });
    store.ingestTraces([
      trace({
        traceId: 'shared',
        spans: [root, child],
        rootSpan: root,
        partial: false,
      }),
    ]);
    // A delayed replay containing only the child must not make the trace
    // provisional again after the actual root is known.
    store.ingestTraces([
      trace({
        traceId: 'shared',
        spans: [child],
        rootSpan: child,
        partial: true,
      }),
    ]);

    const found = store.getTrace('shared');
    expect(found?.rootSpan.spanId).toBe('root');
    expect(found?.partial).toBe(false);
  });

  it('preserves attribute values and their types through a round trip', () => {
    const t = trace({
      spans: [
        span({
          attributes: {
            'http.status_code': 500,
            'http.method': 'GET',
            'retry.enabled': true,
          },
        }),
      ],
    });
    store.ingestTraces([t]);

    const attrs = store.getTrace(t.traceId)!.spans[0].attributes;
    expect(attrs['http.status_code']).toBe(500);
    expect(attrs['http.method']).toBe('GET');
    expect(attrs['retry.enabled']).toBe(true);
  });
});

describe('DevtoolsStore — querying', () => {
  beforeEach(() => {
    const now = Date.now();
    store.ingestTraces([
      trace({
        traceId: 't-api-ok',
        service: 'api',
        spans: [
          span({
            traceId: 't-api-ok',
            name: 'GET /users',
            startTime: now - 1000,
            duration: 50,
          }),
        ],
      }),
      trace({
        traceId: 't-api-slow',
        service: 'api',
        status: 'ERROR',
        spans: [
          span({
            traceId: 't-api-slow',
            name: 'POST /orders',
            startTime: now - 500,
            duration: 900,
            status: { code: 'ERROR', message: 'boom' },
            attributes: { 'http.status_code': 500 },
          }),
        ],
      }),
      trace({
        traceId: 't-worker',
        service: 'worker',
        spans: [
          span({
            traceId: 't-worker',
            name: 'job.run',
            startTime: now - 200,
            duration: 20,
          }),
        ],
      }),
    ]);
  });

  it('returns everything for an empty query', () => {
    expect(store.queryTraces({ query: '' }).traces).toHaveLength(3);
  });

  it('filters by a first-class column', () => {
    const { traces } = store.queryTraces({ query: 'service = worker' });
    expect(traces.map((t) => t.traceId)).toEqual(['t-worker']);
  });

  it('filters a distributed trace by each span service', () => {
    const root = span({
      traceId: 'distributed',
      spanId: 'root',
      attributes: { 'service.name': 'api' },
    });
    const child = span({
      traceId: 'distributed',
      spanId: 'child',
      parentSpanId: 'root',
      attributes: { 'service.name': 'worker' },
    });
    store.ingestTraces([
      trace({
        traceId: 'distributed',
        service: 'api',
        rootSpan: root,
        spans: [root, child],
      }),
    ]);

    expect(
      store
        .queryTraces({ query: 'service = worker' })
        .traces.map((item) => item.traceId),
    ).toContain('distributed');
  });

  it('filters by duration with an ordered comparison', () => {
    const { traces } = store.queryTraces({ query: 'duration > 100' });
    expect(traces.map((t) => t.traceId)).toEqual(['t-api-slow']);
  });

  it('filters by a span attribute that is not a column', () => {
    const { traces } = store.queryTraces({ query: 'http.status_code = 500' });
    expect(traces.map((t) => t.traceId)).toEqual(['t-api-slow']);
  });

  it('supports CONTAINS against a text column', () => {
    const { traces } = store.queryTraces({ query: 'name CONTAINS orders' });
    expect(traces.map((t) => t.traceId)).toEqual(['t-api-slow']);
  });

  it('supports REGEXP, which sqlite does not provide by default', () => {
    const { traces } = store.queryTraces({ query: 'name REGEXP "^GET "' });
    expect(traces.map((t) => t.traceId)).toEqual(['t-api-ok']);
  });

  it('supports IN over a set of services', () => {
    const { traces } = store.queryTraces({ query: 'service IN [worker, api]' });
    expect(traces).toHaveLength(3);
  });

  it('combines conditions with AND and OR', () => {
    const { traces } = store.queryTraces({
      query: 'service = api AND duration > 100',
    });
    expect(traces.map((t) => t.traceId)).toEqual(['t-api-slow']);
  });

  it('matches free text across default fields', () => {
    const { traces } = store.queryTraces({ query: 'job.run' });
    expect(traces.map((t) => t.traceId)).toEqual(['t-worker']);
  });

  it('discovers built-in and observed attribute fields', () => {
    const fields = store.listQueryFields('traces');
    expect(fields).toContain('service');
    expect(fields).toContain('http.status_code');
  });

  it('honours a time window', () => {
    const now = Date.now();
    const { traces } = store.queryTraces({
      query: '',
      window: { start: now - 600, end: now },
    });
    expect(traces.map((t) => t.traceId).sort()).toEqual([
      't-api-slow',
      't-worker',
    ]);
  });

  it('returns newest first', () => {
    const { traces } = store.queryTraces({ query: '' });
    const times = traces.map((t) => t.startTime);
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('pages with limit and cursor without repeating or skipping rows', () => {
    const first = store.queryTraces({ query: '', limit: 2 });
    expect(first.traces).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = store.queryTraces({
      query: '',
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.traces).toHaveLength(1);

    const ids = [...first.traces, ...second.traces].map((t) => t.traceId);
    expect(new Set(ids).size).toBe(3);
  });

  it('reports an invalid query as an error rather than throwing', () => {
    const result = store.queryTraces({ query: 'service =' });
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.traces).toEqual([]);
  });

  it('does not execute injected SQL', () => {
    const result = store.queryTraces({
      query: 'service = "api\'; DROP TABLE spans; --"',
    });
    expect(result.traces).toEqual([]);
    // The table must still be there, and still hold every row.
    expect(store.queryTraces({ query: '' }).traces).toHaveLength(3);
  });
});

describe('DevtoolsStore — retention', () => {
  it('drops the oldest traces once the row cap is exceeded', () => {
    const capped = new DevtoolsStore({
      path: join(dir, 'capped.db'),
      maxTraces: 3,
    });
    const base = Date.now() - 10_000;
    for (let i = 0; i < 6; i++) {
      capped.ingestTraces([
        trace({
          traceId: `t-${i}`,
          spans: [span({ traceId: `t-${i}`, startTime: base + i * 1000 })],
        }),
      ]);
    }
    capped.enforceRetention();

    const { traces } = capped.queryTraces({ query: '' });
    expect(traces).toHaveLength(3);
    // The survivors must be the newest three, not an arbitrary three.
    expect(traces.map((t) => t.traceId).sort()).toEqual(['t-3', 't-4', 't-5']);
    capped.close();
  });

  it('deletes the spans of a pruned trace, leaving no orphans', () => {
    const capped = new DevtoolsStore({
      path: join(dir, 'orphans.db'),
      maxTraces: 1,
    });
    const base = Date.now() - 10_000;
    capped.ingestTraces([
      trace({
        traceId: 'old',
        spans: [span({ traceId: 'old', startTime: base })],
      }),
      trace({
        traceId: 'new',
        spans: [span({ traceId: 'new', startTime: base + 5000 })],
      }),
    ]);
    capped.enforceRetention();

    expect(capped.getTrace('old')).toBeNull();
    expect(capped.countSpans()).toBe(1);
    capped.close();
  });

  it('leaves everything in place when under the cap', () => {
    const capped = new DevtoolsStore({
      path: join(dir, 'under.db'),
      maxTraces: 100,
    });
    capped.ingestTraces([trace(), trace()]);
    capped.enforceRetention();
    expect(capped.queryTraces({ query: '' }).traces).toHaveLength(2);
    capped.close();
  });
});

describe('DevtoolsStore — experiment cohorts', () => {
  function experimentTrace(
    traceId: string,
    name: string,
    variant: string,
    startTime = Date.now(),
  ): TraceData {
    const t = trace({
      traceId,
      spans: [span({ traceId, startTime })],
    });
    t.spans[0].attributes = {
      'experiment.name': name,
      'experiment.variant': variant,
    };
    return t;
  }

  it('pairs each arm with the experiment it ran under, commonest first', () => {
    store.ingestTraces([
      experimentTrace('t-1', 'checkout-pricing', 'v1'),
      experimentTrace('t-2', 'checkout-pricing', 'v2'),
      experimentTrace('t-3', 'checkout-pricing', 'v2'),
      // A second experiment. Its arms must stay its own: offering `control`
      // under `checkout-pricing` would build a cohort that matches nothing.
      experimentTrace('t-4', 'search-ranking', 'control'),
      experimentTrace('t-5', 'search-ranking', 'reranked'),
    ]);
    // A different key that must not leak into the answer.
    const other = trace();
    other.spans[0].attributes = { 'deployment.zone': 'v2' };
    store.ingestTraces([other]);

    // Grouped by experiment, each experiment's arms commonest first, which is
    // what lets the picker default to the two commonest arms of the one you
    // chose.
    expect(
      store.pairedAttributeValues(
        'traces',
        'experiment.name',
        'experiment.variant',
      ),
    ).toEqual([
      { value: 'checkout-pricing', paired: 'v2', count: 2 },
      { value: 'checkout-pricing', paired: 'v1', count: 1 },
      { value: 'search-ranking', paired: 'control', count: 1 },
      { value: 'search-ranking', paired: 'reranked', count: 1 },
    ]);
  });

  it('forgets an experiment whose traces retention has pruned', () => {
    const capped = new DevtoolsStore({
      path: join(dir, 'experiments.db'),
      maxTraces: 1,
    });
    const base = Date.now() - 10_000;
    capped.ingestTraces([
      experimentTrace('old', 'retired-experiment', 'v1', base),
      experimentTrace('new', 'live-experiment', 'v1', base + 5000),
    ]);
    capped.enforceRetention();

    // Offering an experiment whose spans are gone hands the reader an empty
    // cohort and no explanation.
    expect(
      capped
        .pairedAttributeValues(
          'traces',
          'experiment.name',
          'experiment.variant',
        )
        .map((row) => row.value),
    ).toEqual(['live-experiment']);
    capped.close();
  });
});

describe('DevtoolsStore — in-memory mode', () => {
  it('works with no path, for embedders that do not want a file', () => {
    const memory = new DevtoolsStore({});
    const t = trace();
    memory.ingestTraces([t]);
    expect(memory.getTrace(t.traceId)).not.toBeNull();
    memory.close();
  });
});

describe('DevtoolsStore — discovery and projections', () => {
  it('discovers a value before its field name is known and uses indexed equality', () => {
    const t = trace();
    t.spans[0].attributes = { 'deployment.zone': 'lon-1', attempt: 2 };
    store.ingestTraces([t]);

    expect(store.searchAttributes('traces', 'lon-1')).toEqual([
      { key: 'deployment.zone', value: 'lon-1', count: 1 },
    ]);
    expect(
      store.queryTraces({ query: 'deployment.zone = "lon-1"' }).traces,
    ).toHaveLength(1);
    expect(store.queryTraces({ query: 'attempt = 2' }).traces).toHaveLength(1);
  });

  it('projects the facts an agent needs without returning the full trace', () => {
    const root = span({
      traceId: 'projected',
      spanId: 'root',
      name: 'checkout',
      duration: 250,
      attributes: { 'service.name': 'shop' },
    });
    const model = span({
      traceId: 'projected',
      spanId: 'model',
      parentSpanId: 'root',
      name: 'chat model',
      duration: 200,
      attributes: {
        'service.name': 'ai',
        'gen_ai.request.model': 'example-model',
        'gen_ai.usage.input_tokens': 10,
        'gen_ai.usage.output_tokens': 5,
      },
      status: { code: 'ERROR' },
    });
    store.ingestTraces([
      trace({
        traceId: 'projected',
        spans: [root, model],
        rootSpan: root,
        duration: 250,
        status: 'ERROR',
        service: 'shop',
      }),
    ]);

    const summary = store.describeTrace('projected');
    expect(summary).toMatchObject({
      spanCount: 2,
      errorSpanCount: 1,
      serviceCount: 2,
      llmSpanCount: 1,
      totalTokens: 15,
      modelsUsed: ['example-model'],
    });
    expect(summary?.slowestSpans[0].name).toBe('checkout');
  });
});

describe('DevtoolsStore — byte retention and stats', () => {
  it('reports store usage and prunes telemetry when the byte cap is exceeded', () => {
    const capped = new DevtoolsStore({
      path: join(dir, 'byte-capped.db'),
      maxBytes: 1,
    });
    capped.ingestTraces([trace(), trace()]);
    capped.enforceRetention();
    const stats = capped.getStats();
    expect(stats.maxBytes).toBe(1);
    expect(stats.traceCount).toBe(0);
    expect(stats.bytesUsed).toBeGreaterThan(0);
    capped.close();
  });
});

describe('DevtoolsStore — schema version', () => {
  it('refuses a database written by a newer schema, naming the file', () => {
    const path = join(dir, 'future.db');
    const created = new DevtoolsStore({ path });
    created.ingestTraces([trace()]);
    created.close();

    // Stand in for a future release that changed the schema.
    const raw = new DatabaseSync(path);
    raw.exec('PRAGMA user_version = 9999');
    raw.close();

    expect(() => new DevtoolsStore({ path })).toThrow(path);
  });

  it('adopts a database written before the guard existed', () => {
    const path = join(dir, 'legacy.db');
    const created = new DevtoolsStore({ path });
    created.ingestTraces([trace({ traceId: 'kept' })]);
    created.close();

    // Every file written by a release before this guard carries version 0.
    const raw = new DatabaseSync(path);
    raw.exec('PRAGMA user_version = 0');
    raw.close();

    const reopened = new DevtoolsStore({ path });
    expect(reopened.getTrace('kept')).not.toBeNull();
    reopened.close();

    // Adopted once, so the next open is an ordinary version match.
    const again = new DevtoolsStore({ path });
    expect(again.getTrace('kept')).not.toBeNull();
    again.close();
  });
});

describe('DevtoolsStore — span events and links', () => {
  it('finds a trace by the name of an event on one of its spans', () => {
    const hit = span({ traceId: 'a1', spanId: 'root' });
    hit.events = [
      { name: 'cache.miss', timestamp: Date.now(), attributes: {} },
    ];
    const miss = span({ traceId: 'b2', spanId: 'root' });

    store.ingestTraces([
      trace({ traceId: 'a1', spans: [hit], rootSpan: hit }),
      trace({ traceId: 'b2', spans: [miss], rootSpan: miss }),
    ]);

    const { traces } = store.queryTraces({ query: 'event.name = cache.miss' });
    expect(traces.map((item) => item.traceId)).toEqual(['a1']);
  });

  it('finds a trace by the trace a span links to', () => {
    const linking = span({ traceId: 'a1', spanId: 'root' });
    linking.links = [{ traceId: 'upstream', spanId: 'caller' }];

    store.ingestTraces([
      trace({ traceId: 'a1', spans: [linking], rootSpan: linking }),
    ]);

    expect(
      store.queryTraces({ query: 'link.trace_id = upstream' }).traces,
    ).toHaveLength(1);
    expect(
      store.queryTraces({ query: 'link.trace_id = elsewhere' }).traces,
    ).toHaveLength(0);
  });

  it('indexes the events already in a database written before this existed', () => {
    const path = join(dir, 'preexisting.db');
    const carrier = span({ traceId: 'a1', spanId: 'root' });
    carrier.events = [
      { name: 'cache.miss', timestamp: Date.now(), attributes: {} },
    ];
    const created = new DevtoolsStore({ path });
    created.ingestTraces([
      trace({ traceId: 'a1', spans: [carrier], rootSpan: carrier }),
    ]);
    created.close();

    // Stand in for a file whose spans were written before span_events existed.
    const raw = new DatabaseSync(path);
    raw.exec('DELETE FROM span_events');
    raw.close();

    const reopened = new DevtoolsStore({ path });
    expect(
      reopened.queryTraces({ query: 'event.name = cache.miss' }).traces,
    ).toHaveLength(1);
    reopened.close();
  });
});

describe('DevtoolsStore — deep links', () => {
  /**
   * A link an agent hands a human is read later, often much later. Without a
   * window the viewer opens on its default range, which has rolled past the
   * trace, and reports "no traces" for telemetry that is still there.
   *
   * Parsed with the widget's own `parseNavHash` rather than a regex, so the
   * two halves cannot drift into agreeing on nothing.
   */
  it('carries the window and the span being discussed', () => {
    const root = span({
      traceId: 'checkout',
      spanId: 'root',
      startTime: 1_767_000_000_000,
      duration: 250,
      endTime: 1_767_000_000_250,
    });
    const slow = span({
      traceId: 'checkout',
      spanId: 'slow-db',
      parentSpanId: 'root',
      startTime: 1_767_000_000_010,
      duration: 200,
      endTime: 1_767_000_000_210,
    });
    store.ingestTraces([
      trace({ traceId: 'checkout', spans: [root, slow], rootSpan: root }),
    ]);

    const projection = store.describeTrace('checkout')!;
    const nav = parseNavHash(
      projection.deepLink.slice(projection.deepLink.indexOf('#')),
    );

    expect(nav.traceId).toBe('checkout');
    expect(nav.window?.type).toBe('custom');
    if (nav.window?.type !== 'custom') return;
    expect(nav.window.start).toBeLessThanOrEqual(root.startTime);
    expect(nav.window.end).toBeGreaterThanOrEqual(root.endTime);

    // Each listed span is what the summary is about, so its link selects that
    // span rather than dropping the reader at the top of the trace.
    expect(projection.slowestSpans.map((item) => item.spanId)).toContain(
      'slow-db',
    );
    for (const item of projection.slowestSpans) {
      const spanNav = parseNavHash(
        item.deepLink.slice(item.deepLink.indexOf('#')),
      );
      expect(spanNav.traceId).toBe('checkout');
      expect(spanNav.spanId).toBe(item.spanId);
    }
  });
});

describe('DevtoolsStore — list hydration', () => {
  it('keeps each trace spans in start order, and keeps them in their own trace', () => {
    const build = (traceId: string, offset: number) => {
      const spans = [2, 0, 1].map((i) =>
        span({
          traceId,
          spanId: `${traceId}-${i}`,
          startTime: offset + i * 10,
          duration: 5,
          endTime: offset + i * 10 + 5,
        }),
      );
      return trace({ traceId, spans, rootSpan: spans[1] });
    };
    store.ingestTraces([build('first', 1000), build('second', 2000)]);

    const { traces } = store.queryTraces({ query: '' });
    const byId = new Map(traces.map((t) => [t.traceId, t]));

    expect(byId.get('first')!.spans.map((s) => s.spanId)).toEqual([
      'first-0',
      'first-1',
      'first-2',
    ]);
    expect(byId.get('second')!.spans.map((s) => s.spanId)).toEqual([
      'second-0',
      'second-1',
      'second-2',
    ]);
  });
});

describe('DevtoolsStore — cohort rows', () => {
  /**
   * The population a comparison runs over. One row per span, attributes plus
   * the first-class columns, because "the slow ones are all `service=payments`"
   * is exactly the kind of answer wanted and `service` is a column, not an
   * attribute.
   */
  it('flattens matching spans into rows an analysis can rank', () => {
    const fast = span({
      traceId: 'fast',
      spanId: 'f1',
      name: 'checkout',
      duration: 10,
      attributes: { 'payment.provider': 'stripe' },
    });
    const slow = span({
      traceId: 'slow',
      spanId: 's1',
      name: 'checkout',
      duration: 900,
      attributes: { 'payment.provider': 'legacy' },
    });
    store.ingestTraces([
      trace({ traceId: 'fast', spans: [fast], rootSpan: fast, service: 'api' }),
      trace({ traceId: 'slow', spans: [slow], rootSpan: slow, service: 'api' }),
    ]);

    const rows = store.cohortRows({ query: 'duration > 100' });

    expect(rows).toHaveLength(1);
    expect(rows[0]['payment.provider']).toBe('legacy');
    expect(rows[0].service).toBe('api');
    expect(rows[0].name).toBe('checkout');
  });

  it('reports a query it cannot parse rather than returning an empty cohort', () => {
    // Silently comparing against nothing would read as "no difference found".
    expect(() => store.cohortRows({ query: 'duration > >' })).toThrow();
  });
});
