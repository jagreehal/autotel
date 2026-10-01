import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInThisContext } from 'node:vm';
import { buildSync } from 'esbuild';
import { createClient } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createDevtools, type DevtoolsInstance } from 'autotel-devtools';
import { groupOccurrences } from 'autotel-devtools/issues';
import { loadIssues, occurrencesOf } from '../src/modules/issues';
import {
  createIssueWatcher,
  destinationFromEnv,
  markSent,
  pickNotifications,
} from '../src/issue-watcher';
import { DevtoolsBackend } from '../src/backends/devtools/index';
import { JaegerBackend } from '../src/backends/jaeger/index';
import { parseOtlpTrace } from '../src/backends/tempo/index';
import { OtlpReceiver } from '../src/backends/collector/receiver';
import { CollectorStore } from '../src/backends/collector/store';
import { createSourceMapResolver } from 'autotel-devtools/sourcemaps';
import type { SpanRecord, TraceRecord } from '../src/types';
import type { TelemetryBackend } from '../src/backends/telemetry';

const STACK = [
  'TypeError: card declined for order 812',
  '    at chargeCard (file:///app/src/payments.ts:42:11)',
  '    at async handler (file:///app/node_modules/router/index.js:9:3)',
].join('\n');
const HOUR = 3_600_000;

function span(overrides: Partial<SpanRecord>): SpanRecord {
  return {
    traceId: 't',
    spanId: 's',
    parentSpanId: null,
    operationName: 'op',
    serviceName: 'checkout',
    startTimeUnixMs: 0,
    durationMs: 1,
    statusCode: 'OK',
    tags: {},
    hasError: false,
    ...overrides,
  };
}

function failingRequest(
  traceId: string,
  at: number,
  user: string,
): TraceRecord {
  return {
    traceId,
    spans: [
      span({
        traceId,
        spanId: `${traceId}-root`,
        operationName: 'GET /pay',
        startTimeUnixMs: at,
        tags: { 'http.response.status_code': 500, 'user.id': user },
      }),
      span({
        traceId,
        spanId: `${traceId}-child`,
        parentSpanId: `${traceId}-root`,
        operationName: 'payment.charge',
        startTimeUnixMs: at,
        hasError: true,
        statusCode: 'ERROR',
        tags: {
          'exception.type': 'TypeError',
          'exception.message': `card declined for order ${at}`,
          'exception.stacktrace': STACK,
        },
      }),
    ],
  };
}

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe('occurrencesOf (autotel-mcp records → shared core)', () => {
  it('one issue per bug, the throw site not the 500, identity from the root', () => {
    const [issue, ...rest] = groupOccurrences(
      occurrencesOf(
        [
          failingRequest('a', 10 * HOUR, 'u1'),
          failingRequest('b', 10 * HOUR + 1000, 'u2'),
          failingRequest('c', 12 * HOUR, 'u1'),
        ],
        [
          {
            timestampUnixMs: 5,
            severityText: 'ERROR',
            body: 'already counted',
            traceId: 'a',
          },
        ],
      ),
      { start: 9 * HOUR, end: 13 * HOUR, quietMs: HOUR, buckets: 4 },
    );
    expect(rest).toHaveLength(0);
    expect(issue).toMatchObject({
      source: 'exception',
      type: 'TypeError',
      culprit: 'chargeCard (payments.ts)',
      count: 3,
      trend: [0, 2, 0, 1],
      regression: true,
      affected: { users: 2 },
      sampleTraceIds: ['c', 'b', 'a'],
      latestStack: STACK,
    });
  });
});

describe('loadIssues', () => {
  it('groups from traces and logs when the backend keeps no issue state', async () => {
    const now = Date.now();
    const backend = {
      capabilities: () => ({
        traces: 'available',
        metrics: 'available',
        logs: 'available',
      }),
      searchTraces: async () => ({
        items: [failingRequest('x', now - 1000, 'u')],
        totalCount: 1,
      }),
      searchLogs: async () => ({
        items: [
          {
            timestampUnixMs: now,
            severityText: 'ERROR',
            body: 'queue crashed',
            serviceName: 'worker',
          },
        ],
        totalCount: 1,
      }),
    } as unknown as TelemetryBackend;
    const result = await loadIssues(backend, {
      lookbackMinutes: 60,
      quietMinutes: 60,
      nowUnixMs: now,
    });
    expect(result.source).toBe('computed');
    // Equal counts: newest first.
    expect(result.issues.map((i) => [i.source, i.status])).toEqual([
      ['error_log', 'active'],
      ['exception', 'active'],
    ]);
  });

  it('reads stored issues, with status, from a real autotel-devtools', async () => {
    const devtools: DevtoolsInstance = createDevtools({
      port: 0,
      retentionIntervalMs: 0,
    });
    cleanups.push(() => devtools.close());
    const { port } = await devtools.ready;
    const base = `http://127.0.0.1:${port}`;
    const nano = (ms: number) => String(BigInt(ms) * 1_000_000n);
    await fetch(`${base}/v1/traces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'api' } },
              ],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'ab'.repeat(16),
                    spanId: 'cd'.repeat(8),
                    name: 'POST /pay',
                    startTimeUnixNano: nano(Date.now()),
                    endTimeUnixNano: nano(Date.now() + 5),
                    status: { code: 2, message: 'card declined' },
                    attributes: [
                      {
                        key: 'exception.type',
                        value: { stringValue: 'TypeError' },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    });
    const [issue] = (
      (await (await fetch(`${base}/api/issues`)).json()) as {
        issues: Array<{ fingerprint: string }>;
      }
    ).issues;
    await fetch(`${base}/api/issues/${issue.fingerprint}/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    });

    const backend = new DevtoolsBackend(base);
    const active = await loadIssues(backend, {
      lookbackMinutes: 60,
      quietMinutes: 60,
      status: 'active',
    });
    expect(active).toEqual({ issues: [], source: 'stored' });
    const resolved = await loadIssues(backend, {
      lookbackMinutes: 60,
      quietMinutes: 60,
      status: 'resolved',
    });
    expect(resolved.issues).toMatchObject([
      { fingerprint: issue.fingerprint, status: 'resolved', type: 'TypeError' },
    ]);
  });
});

describe('pickNotifications', () => {
  const base = groupOccurrences(
    occurrencesOf([failingRequest('a', 0, 'u')], []),
    {
      start: 0,
      end: 1,
      quietMs: HOUR,
    },
  )[0]!;

  it('sends once at the threshold, again only on a return after quiet, never when ignored', () => {
    const state = new Map();
    const opts = { threshold: 2, quietMs: HOUR, previousPollUnixMs: 0 };
    expect(pickNotifications([{ ...base, count: 1 }], state, opts)).toEqual([]);
    // Polling sees counts jump: 1 → 5 still sends once.
    expect(
      pickNotifications([{ ...base, count: 5, lastSeen: 10 }], state, opts),
    ).toMatchObject([{ trigger: 'threshold' }]);
    // Not delivered yet: still due on the next poll.
    expect(
      pickNotifications([{ ...base, count: 5, lastSeen: 10 }], state, opts),
    ).toMatchObject([{ trigger: 'threshold' }]);
    markSent(state, base.fingerprint);
    expect(
      pickNotifications([{ ...base, count: 6, lastSeen: 20 }], state, {
        ...opts,
        previousPollUnixMs: 30,
      }),
    ).toEqual([]);
    expect(
      pickNotifications([{ ...base, count: 7, lastSeen: 2 * HOUR }], state, {
        ...opts,
        previousPollUnixMs: HOUR + 30,
      }),
    ).toMatchObject([{ trigger: 'recurrence' }]);
    markSent(state, base.fingerprint);
    expect(
      pickNotifications(
        [{ ...base, fingerprint: 'other', count: 9, status: 'ignored' }],
        new Map(),
        opts,
      ),
    ).toEqual([]);
  });
});

describe('destinationFromEnv', () => {
  it('takes any shared-core destination as JSON, or a signed webhook shorthand', () => {
    expect(
      destinationFromEnv({
        AUTOTEL_ISSUES_DESTINATION:
          '{"type":"claude-code","routineId":"trig_1","token":"t"}',
      }),
    ).toEqual({
      type: 'claude-code',
      routineId: 'trig_1',
      token: 't',
      id: 'env',
      name: 'claude-code',
    });
    expect(
      destinationFromEnv({
        AUTOTEL_ISSUES_WEBHOOK: 'https://x/hook',
        AUTOTEL_ISSUES_WEBHOOK_SECRET: 's',
      }),
    ).toEqual({
      type: 'webhook',
      id: 'env',
      name: 'webhook',
      url: 'https://x/hook',
      secret: 's',
    });
    expect(destinationFromEnv({})).toBeUndefined();
  });
});

describe('collector receiver', () => {
  async function receiverWith(
    resolver?: ReturnType<typeof createSourceMapResolver>,
  ) {
    const store = new CollectorStore({ maxTraces: 10, retentionMs: HOUR });
    await store.init();
    const receiver = new OtlpReceiver(store, 0, resolver);
    await receiver.start();
    cleanups.push(() => receiver.stop());
    return { store, port: receiver.getPort() };
  }

  async function postException(port: number, traceId: string, stack: string) {
    const now = Date.now() * 1_000_000;
    await fetch(`http://127.0.0.1:${port}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resourceSpans: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'svc' } },
                { key: 'service.version', value: { stringValue: '1.4.2' } },
              ],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId,
                    spanId: 'abcd1234abcd1234',
                    name: 'op',
                    startTimeUnixNano: String(now),
                    endTimeUnixNano: String(now + 1_000_000),
                    status: { code: 2, message: 'boom' },
                    events: [
                      {
                        name: 'exception',
                        attributes: [
                          {
                            key: 'exception.type',
                            value: { stringValue: 'Error' },
                          },
                          {
                            key: 'exception.stacktrace',
                            value: { stringValue: stack },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    });
  }

  it('keeps the exception event, status message and service.version on span tags', async () => {
    const { store, port } = await receiverWith();
    const traceId = 'abcd1234abcd1234abcd1234abcd1234';
    await postException(port, traceId, STACK);
    const trace = await store.getTrace(traceId);
    expect(trace!.spans[0]!.tags).toMatchObject({
      'service.version': '1.4.2',
      'otel.status_description': 'boom',
      'exception.type': 'Error',
      'exception.stacktrace': STACK,
    });
  });

  it('source-maps bundle frames at ingest', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'autotel-mcp-sm-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(path.join(root, 'src'));
    writeFileSync(
      path.join(root, 'src', 'pay.ts'),
      'export function pay(): never {\n  throw new Error("nope");\n}\n(globalThis as any).__pay = pay;\n',
    );
    const out = path.join(root, 'dist', 'worker.js');
    buildSync({
      entryPoints: [path.join(root, 'src', 'pay.ts')],
      bundle: true,
      outfile: out,
      format: 'iife',
      sourcemap: 'external',
    });
    runInThisContext(readFileSync(out, 'utf8'), { filename: out });
    let stack = '';
    try {
      (globalThis as unknown as { __pay: () => void }).__pay();
    } catch (error) {
      stack = (error as Error).stack!;
    }

    const { store, port } = await receiverWith(
      createSourceMapResolver({ roots: [root] }),
    );
    const traceId = 'ef'.repeat(16);
    await postException(port, traceId, stack);
    const tags = (await store.getTrace(traceId))!.spans[0]!.tags;
    expect(String(tags['exception.stacktrace'])).toContain(
      `${path.join(root, 'src', 'pay.ts')}:2:`,
    );
  });
});

describe('createIssueWatcher', () => {
  it('survives a restart: nothing re-sent, history kept, regressions still sent', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'autotel-watch-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const statePath = path.join(dir, 'issues.json');
    let traces = [1, 2, 3, 4, 5, 6].map((n) =>
      failingRequest(`t${n}`, Date.now() - 1000 - n, 'u'),
    );
    const backend = {
      capabilities: () => ({
        traces: 'available',
        metrics: 'available',
        logs: 'unsupported',
      }),
      searchTraces: async () => ({ items: traces, totalCount: traces.length }),
      getCorrelatedSignals: async () => ({
        trace: null,
        metrics: [],
        logs: [],
      }),
    } as unknown as TelemetryBackend;
    const sent: string[] = [];
    const options = {
      backend,
      destination: {
        type: 'webhook',
        id: 'w',
        name: 'w',
        url: 'https://x',
      } as const,
      threshold: 5,
      quietMinutes: 60,
      statePath,
      deliver: async (_d: unknown, payload: { trigger: string }) => {
        sent.push(payload.trigger);
        return { ok: true, attempts: 1 };
      },
    };

    const first = createIssueWatcher(options);
    expect(await first.poll()).toHaveLength(1);

    // Process restarts: a fresh watcher on the same state file.
    const second = createIssueWatcher(options);
    expect(await second.poll()).toHaveLength(0);
    expect(second.runs()).toMatchObject([
      { trigger: 'threshold', ok: true, destination: 'webhook' },
    ]);

    // Silent for over an hour (as of the last poll), then it happens again.
    const third = createIssueWatcher(options);
    expect(await third.poll(Date.now() + 61 * 60_000)).toHaveLength(0);
    const later = Date.now() + 2 * 3_600_000;
    traces = [...traces, failingRequest('t7', later - 10, 'u')];
    expect(await third.poll(later)).toMatchObject([{ trigger: 'recurrence' }]);
    expect(sent).toEqual(['threshold', 'recurrence']);
    expect(JSON.parse(readFileSync(statePath, 'utf8')).runs).toHaveLength(2);
  });
});

describe('loadIssues finds failures in successful traces', () => {
  it('handled exceptions and detector reports, via a real collector store', async () => {
    const store = new CollectorStore({ maxTraces: 10, retentionMs: HOUR });
    await store.init();
    const receiver = new OtlpReceiver(store, 0);
    await receiver.start();
    cleanups.push(() => receiver.stop());
    const now = Date.now();
    const okSpan = (traceId: string, type: string, message: string) => ({
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'api' } },
            ],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId,
                  spanId: 'abcd1234abcd1234', // same id in both traces: keyed per trace
                  name: 'GET /checkout',
                  startTimeUnixNano: String(now * 1_000_000),
                  endTimeUnixNano: String((now + 5) * 1_000_000),
                  status: { code: 1 },
                  events: [
                    {
                      name: 'exception',
                      attributes: [
                        {
                          key: 'exception.type',
                          value: { stringValue: 'Error' },
                        },
                        {
                          key: 'exception.message',
                          value: { stringValue: 'fallback used' },
                        },
                      ],
                    },
                    {
                      name: 'exception',
                      attributes: [
                        { key: 'exception.type', value: { stringValue: type } },
                        {
                          key: 'exception.message',
                          value: { stringValue: message },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    for (const [traceId, type, message] of [
      ['a1'.repeat(16), 'TypeError', 'handled'],
      [
        'b2'.repeat(16),
        'autotel.LogFlood',
        '"x" logged 100+ times in one invocation',
      ],
    ] as const) {
      await fetch(`http://127.0.0.1:${receiver.getPort()}/v1/traces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(okSpan(traceId, type, message)),
      });
    }
    const backend = {
      capabilities: () => ({
        traces: 'available',
        metrics: 'available',
        logs: 'unsupported',
      }),
      searchTraces: (query: Parameters<CollectorStore['searchTraces']>[0]) =>
        store.searchTraces(query),
    } as unknown as TelemetryBackend;

    const { issues } = await loadIssues(backend, {
      lookbackMinutes: 60,
      quietMinutes: 60,
    });
    expect(issues.map((i) => i.source).sort()).toEqual([
      'handled_exception',
      'log_flood',
    ]);
  });
});

describe('trace backends keep exception events for issues', () => {
  it('Tempo: a successful span carrying autotel.LogFlood becomes a log_flood issue', () => {
    const trace = parseOtlpTrace(
      {
        batches: [
          {
            resource: {
              attributes: [
                { key: 'service.name', value: { stringValue: 'api' } },
              ],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    traceId: 'c3'.repeat(16),
                    spanId: 'c3'.repeat(8),
                    name: 'GET /items',
                    startTimeUnixNano: '1000000000',
                    endTimeUnixNano: '2000000000',
                    status: { code: 1 },
                    events: [
                      {
                        name: 'exception',
                        attributes: [
                          {
                            key: 'exception.type',
                            value: { stringValue: 'autotel.LogFlood' },
                          },
                          {
                            key: 'exception.message',
                            value: {
                              stringValue:
                                '"item <n>" logged 100+ times in one invocation',
                            },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      'c3'.repeat(16),
    )!;
    expect(trace.spans[0]!.tags['exception.type']).toBe('autotel.LogFlood');
    const [issue] = groupOccurrences(occurrencesOf([trace], []), {
      start: 0,
      end: 3000,
      quietMs: HOUR,
    });
    expect(issue?.source).toBe('log_flood');
  });

  it('Jaeger: an exception sent as a span log becomes a handled_exception issue', () => {
    const backend = new JaegerBackend('http://localhost:16686');
    const trace = backend.toTraceRecord({
      traceID: 'd4'.repeat(16),
      processes: { p1: { serviceName: 'api' } },
      spans: [
        {
          traceID: 'd4'.repeat(16),
          spanID: 'd4'.repeat(8),
          operationName: 'GET /pay',
          processID: 'p1',
          startTime: 1_000_000,
          duration: 5000,
          tags: [{ key: 'otel.status_code', type: 'string', value: 'OK' }],
          logs: [
            {
              timestamp: 1_000_100,
              fields: [
                { key: 'event', type: 'string', value: 'exception' },
                { key: 'exception.type', type: 'string', value: 'TypeError' },
                {
                  key: 'exception.message',
                  type: 'string',
                  value: 'fallback used',
                },
                {
                  key: 'exception.stacktrace',
                  type: 'string',
                  value:
                    'TypeError: fallback used\n    at pay (/app/src/pay.ts:3:9)',
                },
              ],
            },
          ],
        },
      ],
    });
    const [issue] = groupOccurrences(occurrencesOf([trace], []), {
      start: 0,
      end: 3000,
      quietMs: HOUR,
    });
    expect(issue).toMatchObject({
      source: 'handled_exception',
      type: 'TypeError',
      culprit: 'pay (pay.ts)',
    });
  });
});

describe('createIssueWatcher retries what it could not send', () => {
  it('a failed context lookup leaves the issue pending, and the next poll sends it', async () => {
    const traces = [1, 2, 3, 4, 5].map((n) =>
      failingRequest(`r${n}`, Date.now() - n, 'u'),
    );
    let lookups = 0;
    const backend = {
      capabilities: () => ({
        traces: 'available',
        metrics: 'available',
        logs: 'unsupported',
      }),
      searchTraces: async () => ({ items: traces, totalCount: traces.length }),
      getCorrelatedSignals: async () => {
        lookups += 1;
        if (lookups === 1) throw new Error('backend timeout');
        return { trace: null, metrics: [], logs: [] };
      },
    } as unknown as TelemetryBackend;
    const sent: string[] = [];
    const watcher = createIssueWatcher({
      backend,
      destination: { type: 'webhook', id: 'w', name: 'w', url: 'https://x' },
      threshold: 5,
      quietMinutes: 60,
      deliver: async (_d, payload) => {
        sent.push(payload.trigger);
        return { ok: true, attempts: 1 };
      },
    });

    expect(await watcher.poll()).toMatchObject([
      { ok: false, error: 'backend timeout' },
    ]);
    expect(sent).toEqual([]);
    expect(await watcher.poll()).toMatchObject([
      { ok: true, trigger: 'threshold' },
    ]);
    expect(await watcher.poll()).toEqual([]);
    expect(sent).toEqual(['threshold']);
  });
});

describe('collector span identity', () => {
  it('keys spans by (trace_id, span_id), migrating a span_id-keyed file', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'autotel-pk-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const url = `file:${path.join(dir, 'old.db')}`;
    const old = createClient({ url });
    await old.execute(
      "CREATE TABLE spans (trace_id TEXT NOT NULL, span_id TEXT NOT NULL PRIMARY KEY, parent_span_id TEXT, operation_name TEXT NOT NULL, service_name TEXT NOT NULL, start_time_unix_ms INTEGER NOT NULL, duration_ms REAL NOT NULL, status_code TEXT NOT NULL DEFAULT 'UNSET', tags TEXT NOT NULL DEFAULT '{}', has_error INTEGER NOT NULL DEFAULT 0)",
    );
    await old.execute(
      "INSERT INTO spans (trace_id, span_id, operation_name, service_name, start_time_unix_ms, duration_ms) VALUES ('t-kept', 'kept000000000000', 'GET /kept', 'api', 1, 1)",
    );
    old.close();

    const store = new CollectorStore({ maxTraces: 10, retentionMs: HOUR, url });
    await store.init();
    // Rows from the old table survive the upgrade.
    expect((await store.getTrace('t-kept'))?.spans).toMatchObject([
      { spanId: 'kept000000000000', operationName: 'GET /kept' },
    ]);
    const same = (traceId: string) =>
      span({
        traceId,
        spanId: 'shared0000000000',
        startTimeUnixMs: Date.now(),
      });
    await store.insertSpans([same('t-one'), same('t-two')]);
    expect((await store.getTrace('t-one'))?.spans).toHaveLength(1);
    expect((await store.getTrace('t-two'))?.spans).toHaveLength(1);
  });
});
