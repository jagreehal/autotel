/**
 * Traces with the database spans the Queries tab, the span detail plan block
 * and the waterfall badges read, carrying the attributes autotel-drizzle and
 * autotel-mongoose actually emit:
 *
 * - `GET /feed`: one posts query, then the same comments query per post (an
 *   N+1, Postgres, grouped by `db.statement.hash`);
 * - `GET /orders`, twice: a MongoDB find that scanned the collection and
 *   carries an index suggestion, then the same statement on an index (the
 *   plan changed).
 */
import type { SpanData, TraceData } from '../../types';

function span(
  traceId: string,
  spanId: string,
  startTime: number,
  duration: number,
  name: string,
  attributes: Record<string, string | number | boolean | string[]>,
  parentSpanId?: string,
): SpanData {
  return {
    traceId,
    spanId,
    parentSpanId,
    name,
    kind: parentSpanId ? 'CLIENT' : 'SERVER',
    startTime,
    endTime: startTime + duration,
    duration,
    attributes,
    status: { code: 'OK' },
    events: [],
    // The scope the real instrumentation emits for each system.
    scope:
      attributes['db.system.name'] === 'postgresql'
        ? { name: 'autotel-plugins/drizzle' }
        : attributes['db.system.name'] === 'mongodb'
          ? { name: 'autotel-mongoose' }
          : attributes['db.system.name'] === 'redis'
            ? { name: '@opentelemetry/instrumentation-ioredis' }
            : undefined,
  };
}

function trace(spans: SpanData[], service: string): TraceData {
  const [root] = spans;
  const end = Math.max(...spans.map((s) => s.endTime));
  return {
    traceId: root!.traceId,
    correlationId: root!.traceId,
    rootSpan: root!,
    spans,
    startTime: root!.startTime,
    endTime: end,
    duration: end - root!.startTime,
    status: 'OK',
    service,
  };
}

const POSTS = {
  'db.system.name': 'postgresql',
  'db.namespace': 'blog',
  'db.operation.name': 'SELECT',
  'db.collection.name': 'posts',
  'db.query.text': 'select "id", "title" from "posts" limit $1',
  'db.statement.hash': '0a5e83d1c96b47',
};

const COMMENTS = {
  'db.system.name': 'postgresql',
  'db.namespace': 'blog',
  'db.operation.name': 'SELECT',
  'db.collection.name': 'comments',
  'db.query.text': 'select "id", "body" from "comments" where "post_id" = $1',
  'db.statement.hash': '16f2c9a04be7d1',
};

const ORDERS_FIND = {
  'db.system.name': 'mongodb',
  'db.namespace': 'shop',
  'db.operation.name': 'find',
  'db.collection.name': 'orders',
  'db.query.text':
    '{"condition":{"status":"?","total":{"$gte":"?"}},"options":{"sort":{"createdAt":"?"}}}',
  'db.statement.hash': '18365582b3015e',
};

export function sampleQueryTraces(now = Date.now()): TraceData[] {
  const feedStart = now - 60_000;
  const feed = trace(
    [
      span('t-feed', 'root', feedStart, 60, 'GET /feed', {
        'http.route': '/feed',
      }),
      span('t-feed', 'p', feedStart + 1, 3, 'SELECT posts', POSTS, 'root'),
      ...[0, 1, 2, 3, 4].map((n) =>
        span(
          't-feed',
          `c${n}`,
          feedStart + 5 + n * 10,
          8,
          'SELECT comments',
          COMMENTS,
          'root',
        ),
      ),
    ],
    'feed-api',
  );

  const scanStart = now - 40_000;
  const scan = trace(
    [
      span('t-orders-1', 'root', scanStart, 220, 'GET /orders', {
        'http.route': '/orders',
      }),
      span(
        't-orders-1',
        'find',
        scanStart + 2,
        210,
        'find orders',
        {
          ...ORDERS_FIND,
          'db.plan.status': 'captured',
          'db.plan.mode': 'analyze',
          'db.plan.node': 'SORT',
          'db.plan.stages': ['SORT', 'COLLSCAN'],
          'db.plan.blocking_sort': true,
          'db.plan.keys_examined': 0,
          'db.plan.full_scan': true,
          'db.plan.rows_examined': 60_000,
          'db.plan.rows_returned': 16,
          'db.plan.execution_ms': 190,
          'db.plan.hash': 'aaaaaaaaaaaaaa',
          'db.plan.index_suggestion':
            'db.orders.createIndex({ status: 1, createdAt: -1, total: 1 })',
          'db.plan.index_suggestion.equality': ['status'],
          'db.plan.index_suggestion.sort': ['createdAt:-1'],
          'db.plan.index_suggestion.range': ['total'],
        },
        'root',
      ),
    ],
    'orders-api',
  );

  const indexedStart = now - 20_000;
  const indexed = trace(
    [
      span('t-orders-2', 'root', indexedStart, 12, 'GET /orders', {
        'http.route': '/orders',
      }),
      span(
        't-orders-2',
        'find',
        indexedStart + 1,
        6,
        'find orders',
        {
          ...ORDERS_FIND,
          'db.plan.status': 'captured',
          'db.plan.mode': 'analyze',
          'db.plan.node': 'FETCH',
          'db.plan.stages': ['FETCH', 'IXSCAN'],
          'db.plan.blocking_sort': false,
          'db.plan.keys_examined': 16,
          'db.plan.full_scan': false,
          'db.plan.indexes': 'status_1_createdAt_-1_total_1',
          'db.plan.rows_examined': 16,
          'db.plan.rows_returned': 16,
          'db.plan.hash': 'bbbbbbbbbbbbbb',
        },
        'root',
      ),
    ],
    'orders-api',
  );

  // An explain the database refused, and a write explain has nothing for.
  const deniedStart = now - 10_000;
  const denied = trace(
    [
      span('t-audit', 'root', deniedStart, 9, 'GET /audit', {
        'http.route': '/audit',
      }),
      span(
        't-audit',
        'find',
        deniedStart + 1,
        4,
        'find audit',
        {
          'db.system.name': 'mongodb',
          'db.namespace': 'shop',
          'db.operation.name': 'find',
          'db.collection.name': 'audit',
          'db.query.text': '{"condition":{"actor":"?"}}',
          'db.statement.hash': '2b1c5ae0d93f17',
          'db.plan.status': 'failed',
          'db.plan.mode': 'plan',
          'db.plan.error': 'not authorized on shop to execute command',
        },
        'root',
      ),
      span(
        't-audit',
        'insert',
        deniedStart + 6,
        2,
        'insertMany audit',
        {
          'db.system.name': 'mongodb',
          'db.namespace': 'shop',
          'db.operation.name': 'insertMany',
          'db.collection.name': 'audit',
          'db.query.text': '{"documents":[{"actor":"?"}]}',
          'db.statement.hash': '0f6d2a9be1c443',
          'db.plan.status': 'unsupported',
          'db.plan.mode': 'plan',
        },
        'root',
      ),
    ],
    'audit-api',
  );

  // A cache read: a database span no autotel instrumentation can explain.
  const cacheStart = now - 5_000;
  const cache = trace(
    [
      span('t-cache', 'root', cacheStart, 3, 'GET /session', {
        'http.route': '/session',
      }),
      span(
        't-cache',
        'get',
        cacheStart + 1,
        1,
        'GET',
        {
          'db.system.name': 'redis',
          'db.operation.name': 'GET',
          'db.query.text': 'GET ?',
        },
        'root',
      ),
    ],
    'session-api',
  );

  return [feed, scan, indexed, denied, cache];
}
