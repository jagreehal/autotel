import {
  INVALID_SPAN_CONTEXT,
  SpanStatusCode,
  type AttributeValue,
  type Attributes,
  type Span,
  type SpanOptions,
  type SpanStatus,
  type Tracer,
  type TracerProvider,
} from '@opentelemetry/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// SAFETY: vi.hoisted runs before the declarations below, so the empty array is
// annotated rather than inferred; every push into it is a MockSpan.
/**
 * The tests drive the instrumentation against fake drizzle drivers and read the
 * spans back from a tracer handed in through config, rather than by replacing
 * modules. `tracerProvider` is the same injection point an application uses to
 * send this client's spans somewhere of its own.
 */
const spans: MockSpan[] = [];

const tracer: Tracer = {
  // SAFETY: the instrumentation starts spans through startSpan and never calls
  // startActiveSpan, so this stands in for the interface and fails loudly
  // rather than pretending to work if that ever changes.
  startActiveSpan: (() => {
    throw new Error('the drizzle instrumentation does not use startActiveSpan');
  }) as Tracer['startActiveSpan'],
  startSpan: (name: string, options?: SpanOptions) => {
    const span: MockSpan = {
      name,
      options,
      attributes: {},
      status: undefined,
      ended: false,
      exceptions: [],
      setAttribute: (key: string, value: AttributeValue) => {
        span.attributes[key] = value;
        return span;
      },
      setStatus: (status: SpanStatus) => {
        span.status = status;
        return span;
      },
      recordException: (cause: unknown) => {
        span.exceptions.push(cause);
      },
      end: () => {
        span.ended = true;
      },
      // The rest of the Span interface, which the instrumentation never calls.
      spanContext: () => INVALID_SPAN_CONTEXT,
      setAttributes: (attributes: Attributes) => {
        Object.assign(span.attributes, attributes);
        return span;
      },
      addEvent: () => span,
      addLink: () => span,
      addLinks: () => span,
      updateName: (updated: string) => {
        span.name = updated;
        return span;
      },
      isRecording: () => !span.ended,
    };

    spans.push(span);
    return span;
  },
};

// SAFETY: MockSpan implements every member the instrumentation calls on a span,
// and the provider is only ever read back through the spans array below.
const tracerProvider: TracerProvider = {
  getTracer: () => tracer,
};

/** Config every test starts from, so spans land in the array above. */
function testConfig(config?: InstrumentDrizzleConfig): InstrumentDrizzleConfig {
  return { tracerProvider, ...config };
}

import {
  instrumentDrizzle,
  instrumentDrizzleClient,
  type InstrumentDrizzleConfig,
} from './index';

/**
 * What these tests pass a drizzle client. Drizzle's drivers each name the SQL
 * differently - a bare string, `{ sql }`, or `{ text }` - which is why the
 * instrumentation reads all three.
 */
type DrizzleQuery =
  | string
  | { sql: string; params?: unknown[] }
  | { text: string }
  | { queryString: string };

/** One node of the fake `EXPLAIN (FORMAT JSON)` plans these tests feed in. */
interface FakePlanNode {
  'Node Type': string;
  'Index Name'?: string;
  'Total Cost'?: number;
  'Plan Rows'?: number;
  'Actual Rows'?: number;
  'Rows Removed by Filter'?: number;
  'Shared Hit Blocks'?: number;
  Plans?: FakePlanNode[];
}

/** A fake postgres response to `EXPLAIN (FORMAT JSON)`. */
interface FakeExplainResponse {
  rows: Array<
    Record<string, Array<{ Plan: FakePlanNode; 'Execution Time'?: number }>>
  >;
}

/** One column value a fake driver can hand back. */
type FakeColumn = string | number | boolean | null;

/** What a fake driver returns from a query, in every shape these tests use. */
type FakeResult =
  | { rows: Array<Record<string, FakeColumn>> }
  | { ok: true }
  | { changes: number }
  | FakeColumn[][]
  | FakeExplainResponse
  | undefined;

/**
 * The transaction object a fake drizzle session hands its callback. `execute`
 * dispatches into the transaction's own session the way drizzle's does, so it
 * returns whatever that session returns.
 */
interface FakeTransaction {
  execute: (query: DrizzleQuery) => Promise<FakeResult>;
  session?: { prepareQuery?: (query: DrizzleQuery) => FakePreparedQuery };
}

/** The SQL a test handed to a fake driver, however the driver wrapped it. */
function readSql(query: Exclude<DrizzleQuery, string>): string {
  if ('sql' in query) return query.sql;
  if ('text' in query) return query.text;
  return query.queryString;
}

/**
 * A session exposing both entry points, where execute() compiles the statement
 * and hands it to prepareQuery, the way PgSession does.
 */
interface DispatchingSession {
  prepareQuery: (query: DrizzleQuery) => { execute: () => Promise<FakeResult> };
  execute: (query: DrizzleQuery) => Promise<FakeResult>;
}

/** A prepared query a fake session hands back. */
interface FakePreparedQuery {
  execute?: (...args: DrizzleQuery[]) => FakeResult | Promise<FakeResult>;
  all?: (...args: DrizzleQuery[]) => FakeResult | Promise<FakeResult>;
  get?: (...args: DrizzleQuery[]) => FakeResult | Promise<FakeResult>;
  run?: (...args: DrizzleQuery[]) => FakeResult | Promise<FakeResult>;
  values?: (...args: DrizzleQuery[]) => FakeResult | Promise<FakeResult>;
  client?: FakeQueryClient;
  query?: DrizzleQuery;
}

/** A fake client that answers raw SQL, used for the EXPLAIN tests. */
interface FakeQueryClient {
  query: (statement: string, params?: FakeColumn[]) => Promise<FakeResult>;
}

/**
 * A real OpenTelemetry span that also records what was set on it, so a test can
 * read back the name, attributes, and status the instrumentation produced.
 */
interface MockSpan extends Span {
  name: string;
  options: SpanOptions | undefined;
  attributes: Attributes;
  status: SpanStatus | undefined;
  ended: boolean;
  exceptions: unknown[];
}

function getSpan(index = 0): MockSpan {
  const span = spans[index];
  expect(span).toBeDefined();
  // SAFETY: the expectation above fails the test when the span is absent.
  return span as MockSpan;
}

describe('instrumentDrizzle', () => {
  beforeEach(() => {
    spans.length = 0;
  });

  it('preserves synchronous query return values', () => {
    const client = {
      query: vi.fn((_query: DrizzleQuery) => ({ rows: [{ id: 1 }] })),
    };

    instrumentDrizzle(client, testConfig());

    const result = client.query('SELECT 1');

    expect(result).toEqual({ rows: [{ id: 1 }] });
    expect(result).not.toBeInstanceOf(Promise);
    expect(spans).toHaveLength(1);
    expect(getSpan().ended).toBe(true);
    expect(getSpan().name).toBe('drizzle.select');
  });

  it('names spans after the library by default', async () => {
    const client = {
      query: vi.fn(async (_query: DrizzleQuery) => ({ rows: [] })),
    };
    instrumentDrizzle(client, testConfig());

    await client.query('SELECT id FROM comments WHERE post_id = $1');

    expect(getSpan().name).toBe('drizzle.select');
  });

  it('names spans the way semconv asks when spanNaming is semconv', async () => {
    const client = {
      query: vi.fn(async (_query: DrizzleQuery) => ({ rows: [] })),
    };
    instrumentDrizzle(client, testConfig({ spanNaming: 'semconv' }));

    await client.query('SELECT id FROM comments WHERE post_id = $1');

    // Semconv: "{db.operation.name} {target}", e.g. the MySQL example "SELECT orders".
    expect(getSpan().name).toBe('SELECT comments');
  });

  it('falls back to the operation alone when no table can be read', async () => {
    const client = {
      query: vi.fn(async (_query: DrizzleQuery) => ({ rows: [] })),
    };
    instrumentDrizzle(client, testConfig({ spanNaming: 'semconv' }));

    await client.query('SELECT 1');

    expect(getSpan().name).toBe('SELECT');
  });

  it('wraps both query and execute when both methods exist', async () => {
    const client = {
      query: vi.fn(async (_query: DrizzleQuery) => ({ source: 'query' })),
      execute: vi.fn(async (_query: DrizzleQuery) => ({ source: 'execute' })),
    };

    instrumentDrizzle(client, testConfig());
    const wrappedQuery = client.query;
    const wrappedExecute = client.execute;

    instrumentDrizzle(client, testConfig());

    expect(client.query).toBe(wrappedQuery);
    expect(client.execute).toBe(wrappedExecute);

    await client.query('SELECT 1');
    await client.execute({ sql: 'DELETE FROM users' });

    expect(spans).toHaveLength(2);
    expect(getSpan(0).name).toBe('drizzle.select');
    expect(getSpan(1).name).toBe('drizzle.delete');
  });

  it('keeps callback-style clients callback-style', async () => {
    const client = {
      query: vi.fn(
        (
          _query: string,
          callback: (cause: unknown, result: { ok: true }) => void,
        ) => {
          callback(null, { ok: true });
          return;
        },
      ),
    };

    instrumentDrizzle(client, testConfig());

    await new Promise<void>((resolve) => {
      const result = client.query('SELECT 1', (error, payload) => {
        expect(error).toBeNull();
        expect(payload).toEqual({ ok: true });
        resolve();
      });

      expect(result).toBeUndefined();
    });

    // A driver reporting `null` for its error argument means success.
    expect(getSpan().status).toEqual({ code: SpanStatusCode.OK });
    expect(getSpan().ended).toBe(true);
  });

  it('records async failures', async () => {
    const error = new Error('boom');
    const client = {
      query: vi.fn(async (_query: DrizzleQuery) => {
        throw error;
      }),
    };

    instrumentDrizzle(client, testConfig());

    await expect(client.query('SELECT 1')).rejects.toThrow(error);

    expect(getSpan().exceptions).toContain(error);
    expect(getSpan().status).toEqual({ code: SpanStatusCode.ERROR });
  });

  it('applies config to captured spans', async () => {
    const client = {
      execute: vi.fn(async (_query: DrizzleQuery) => ({ rows: [] })),
    };
    const config: InstrumentDrizzleConfig = {
      dbSystem: 'mysql',
      dbName: 'app',
      peerName: 'db.example.com',
      peerPort: 3306,
      maxQueryTextLength: 12,
    };

    instrumentDrizzle(client, testConfig(config));
    await client.execute('SELECT * FROM very_long_table_name');

    expect(getSpan().attributes).toMatchObject({
      'db.system': 'mysql',
      'db.name': 'app',
      'net.peer.name': 'db.example.com',
      'net.peer.port': 3306,
      'db.operation': 'SELECT',
      'db.statement': 'SELECT * FRO...',
    });
  });

  it('skips db.statement when query capture is disabled', async () => {
    const client = {
      query: vi.fn(async (_query: DrizzleQuery) => ({ rows: [] })),
    };

    instrumentDrizzle(client, testConfig({ captureQueryText: false }));
    await client.query({ text: 'UPDATE users SET name = $1' });

    expect(getSpan().attributes['db.operation']).toBe('UPDATE');
    expect(getSpan().attributes['db.statement']).toBeUndefined();
  });

  it('emits db.statement.hash even when statement text is suppressed', async () => {
    const client = {
      query: vi.fn(async (_query: DrizzleQuery) => ({ rows: [] })),
    };

    instrumentDrizzle(client, testConfig({ captureQueryText: false }));
    await client.query({ text: 'UPDATE users SET name = $1' });

    const hash = getSpan().attributes['db.statement.hash'];
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('produces identical db.statement.hash for identical statements', async () => {
    const client = {
      query: vi.fn(async (_query: DrizzleQuery) => ({ rows: [] })),
    };

    instrumentDrizzle(client, testConfig({}));
    await client.query({ text: 'SELECT * FROM users WHERE id = $1' });
    await client.query({ text: 'SELECT * FROM users WHERE id = $1' });

    expect(getSpan(0).attributes['db.statement.hash']).toBeDefined();
    expect(getSpan(0).attributes['db.statement.hash']).toBe(
      getSpan(1).attributes['db.statement.hash'],
    );
  });

  it('produces different db.statement.hash for different statements', async () => {
    const client = {
      query: vi.fn(async (_query: DrizzleQuery) => ({ rows: [] })),
    };

    instrumentDrizzle(client, testConfig({}));
    await client.query({ text: 'SELECT * FROM users WHERE id = $1' });
    await client.query({ text: 'SELECT * FROM accounts WHERE id = $1' });

    expect(getSpan(0).attributes['db.statement.hash']).not.toBe(
      getSpan(1).attributes['db.statement.hash'],
    );
  });
});

describe('instrumentDrizzleClient', () => {
  beforeEach(() => {
    spans.length = 0;
  });

  it('instruments prepared query helper methods, not just execute', () => {
    const prepared = {
      all: vi.fn(() => [{ id: 1 }]),
      get: vi.fn(() => ({ id: 1 })),
    };
    const db = {
      session: {
        prepareQuery: vi.fn((_query: DrizzleQuery) => prepared),
      },
    };

    instrumentDrizzleClient(db, testConfig());

    const preparedQuery = db.session.prepareQuery({
      queryString: 'SELECT * FROM users',
    });

    const allResult = preparedQuery.all();
    const getResult = preparedQuery.get();

    expect(allResult).toEqual([{ id: 1 }]);
    expect(getResult).toEqual({ id: 1 });
    expect(spans).toHaveLength(2);
    expect(getSpan(0).attributes['db.statement']).toBe('SELECT * FROM users');
    expect(getSpan(1).attributes['db.operation']).toBe('SELECT');
  });

  it('instruments the session but leaves $client untouched', async () => {
    const originalClientQuery = vi.fn(async (_query: DrizzleQuery) => ({
      rows: ['client'],
    }));
    const db = {
      session: {
        execute: vi.fn(async (_query: DrizzleQuery) => ({ rows: ['session'] })),
      },
      $client: {
        query: originalClientQuery,
      },
    };

    instrumentDrizzleClient(db, testConfig());

    await db.session.execute('INSERT INTO users VALUES (1)');
    expect(spans).toHaveLength(1);
    expect(getSpan(0).name).toBe('drizzle.insert');

    // $client.query must remain the original reference. Instrumenting it here
    // would produce duplicate spans because drizzle's session internally calls
    // $client.query from within its own already-traced execute path.
    expect(db.$client.query).toBe(originalClientQuery);

    await db.$client.query('SELECT 1');
    expect(spans).toHaveLength(1);
  });

  it('produces one span when drizzle session.prepareQuery routes through the shared $client', async () => {
    // Simulates the real drizzle-orm/node-postgres flow where
    // prepared.execute() internally dispatches to db.$client.query().
    const client = {
      query: vi.fn(async (_query: DrizzleQuery) => ({ rows: [{ id: 1 }] })),
    };
    const db = {
      $client: client,
      session: {
        prepareQuery: vi.fn((query: Exclude<DrizzleQuery, string>) => ({
          execute: vi.fn(async () => client.query(readSql(query))),
        })),
      },
    };

    instrumentDrizzleClient(db, testConfig());

    const prepared = db.session.prepareQuery({ sql: 'SELECT 1' });
    await prepared.execute();

    // Exactly one autotel span should be created — the one from
    // instrumented prepared.execute. The inner $client.query call must
    // NOT create its own span.
    expect(spans).toHaveLength(1);
    expect(getSpan(0).name).toBe('drizzle.select');
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('traces a transaction query once and tags it db.transaction', async () => {
    // Mirrors drizzle's real transaction shape: the transaction object carries
    // its own session, and tx.execute() compiles the statement and dispatches
    // into that session's prepareQuery. Only the session sees the final SQL.
    let txRef: FakeTransaction | undefined;
    const db = {
      session: {
        prepareQuery: vi.fn((_query: DrizzleQuery) => ({
          execute: vi.fn(async () => ({ rows: [] })),
        })),
        transaction: vi.fn(
          async (callback: (tx: FakeTransaction) => Promise<FakeResult>) => {
            const txSession = {
              prepareQuery: vi.fn((_query: DrizzleQuery) => ({
                execute: vi.fn(async () => ({ rows: [] })),
              })),
            };

            txRef = {
              session: txSession,
              execute: vi.fn(async (query: DrizzleQuery) =>
                txSession.prepareQuery(query).execute?.(),
              ),
            };

            return callback(txRef);
          },
        ),
      },
    };

    instrumentDrizzleClient(db, testConfig());

    await db.session.transaction(async (tx: any) => {
      await tx.execute({ sql: 'SET LOCAL role app_user' });
    });

    // The transaction span opens first and wraps the statement span.
    expect(spans.map((span) => span.name)).toEqual([
      'drizzle.transaction',
      'drizzle.set',
    ]);
    expect(getSpan(1).attributes['db.statement']).toBe(
      'SET LOCAL role app_user',
    );
    expect(getSpan(0).attributes['db.transaction']).toBe(true);
    expect(getSpan(1).attributes['db.transaction']).toBe(true);
    expect(txRef?.execute).not.toBeUndefined();
  });

  it('traces db.execute() once when it dispatches into session.prepareQuery', async () => {
    // The drizzle-orm/node-postgres shape: db.execute() lives on the database
    // object, the session below it only exposes prepareQuery, and every
    // db.execute() call funnels through it. Wrapping both layers used to emit
    // a second span carrying no db.statement and no db.operation, because the
    // SQL template has not been compiled yet at the db layer.
    const session = {
      prepareQuery: vi.fn((_query: DrizzleQuery) => ({
        execute: vi.fn(async () => ({ rows: [{ id: 1 }] })),
      })),
    };
    const db = {
      session,
      execute: vi.fn(async (query: DrizzleQuery) =>
        session.prepareQuery(query).execute?.(),
      ),
    };

    instrumentDrizzleClient(db, testConfig());

    await db.execute({ sql: 'SELECT 1' });

    expect(spans).toHaveLength(1);
    expect(getSpan(0).name).toBe('drizzle.select');
    expect(getSpan(0).attributes['db.statement']).toBe('SELECT 1');
  });

  it('traces once when one session exposes both execute and prepareQuery', async () => {
    // PgSession.prototype.execute() compiles the statement and then calls
    // this.prepareQuery(), so both methods are wrappable on the same object
    // and only prepareQuery should take the span.
    // execute() must go through session.prepareQuery, not a captured copy of
    // it, or the wrapper under test is never reached.
    const session: DispatchingSession = {
      prepareQuery: vi.fn((_query: DrizzleQuery) => ({
        execute: vi.fn(async () => ({ rows: [] })),
      })),
      execute: async (query: DrizzleQuery) =>
        session.prepareQuery(query).execute(),
    };

    instrumentDrizzleClient({ session }, testConfig());

    await session.execute({ sql: 'SELECT 1' });

    expect(spans).toHaveLength(1);
    expect(getSpan(0).attributes['db.statement']).toBe('SELECT 1');
  });

  it('still traces a transaction once after repeated instrumentation', async () => {
    // instrumentDrizzleClient(, testConfig()) is safe to call twice, and drizzle reaches a
    // transaction target through both the wrapped db.transaction and the
    // wrapped session.transaction. Coverage has to be read from the flags
    // rather than from "did this call wrap something", which is false on every
    // repeat visit and used to re-wrap tx.execute on top of its session.
    const db = {
      session: {
        prepareQuery: vi.fn((_query: DrizzleQuery) => ({
          execute: vi.fn(async () => ({ rows: [] })),
        })),
        transaction: vi.fn(
          async (callback: (tx: FakeTransaction) => Promise<FakeResult>) => {
            const txSession = {
              prepareQuery: vi.fn((_query: DrizzleQuery) => ({
                execute: vi.fn(async () => ({ rows: [] })),
              })),
            };

            return callback({
              session: txSession,
              execute: vi.fn(async (query: DrizzleQuery) =>
                txSession.prepareQuery(query).execute?.(),
              ),
            });
          },
        ),
      },
    };

    instrumentDrizzleClient(db, testConfig());
    instrumentDrizzleClient(db, testConfig());

    await db.session.transaction(async (tx: any) => {
      await tx.execute({ sql: 'SELECT 1' });
    });

    // Repeated instrumentation must not stack a second transaction span, nor
    // a second span for the statement.
    expect(spans.map((span) => span.name)).toEqual([
      'drizzle.transaction',
      'drizzle.select',
    ]);
    expect(getSpan(1).attributes['db.statement']).toBe('SELECT 1');
  });

  it('preserves sync execution for fallback _.session.execute', () => {
    const db = {
      _: {
        session: {
          execute: vi.fn((_query: DrizzleQuery) => ({ rows: [1] })),
        },
      },
    };

    instrumentDrizzleClient(db, testConfig());

    const result = db._.session.execute('DELETE FROM users');

    expect(result).toEqual({ rows: [1] });
    expect(result).not.toBeInstanceOf(Promise);
    expect(getSpan().name).toBe('drizzle.delete');
  });

  it('is idempotent when called repeatedly', () => {
    const originalClientExecute = vi.fn(async (_query: DrizzleQuery) => ({
      rows: [],
    }));
    const db = {
      session: {
        query: vi.fn(async (_query: DrizzleQuery) => ({ rows: [] })),
      },
      $client: {
        execute: originalClientExecute,
      },
    };

    instrumentDrizzleClient(db, testConfig());
    const firstSessionQuery = db.session.query;

    instrumentDrizzleClient(db, testConfig());

    expect(db.session.query).toBe(firstSessionQuery);
    // $client.execute is intentionally not wrapped by instrumentDrizzleClient.
    expect(db.$client.execute).toBe(originalClientExecute);
  });
});

describe('explain', () => {
  beforeEach(() => {
    spans.length = 0;
  });

  const planPayload = (plan: FakePlanNode, executionTime?: number) => ({
    rows: [
      {
        'QUERY PLAN': [
          executionTime === undefined
            ? { Plan: plan }
            : { Plan: plan, 'Execution Time': executionTime },
        ],
      },
    ],
  });

  const seqScan = {
    'Node Type': 'Seq Scan',
    'Total Cost': 3462,
    'Plan Rows': 397,
    'Actual Rows': 400,
    'Rows Removed by Filter': 199_600,
    'Shared Hit Blocks': 1082,
  };

  const indexScan = {
    'Node Type': 'Bitmap Heap Scan',
    'Total Cost': 12.4,
    'Plan Rows': 398,
    'Actual Rows': 400,
    Plans: [
      {
        'Node Type': 'Bitmap Index Scan',
        'Index Name': 'idx_events_tenant',
        'Actual Rows': 400,
        'Shared Hit Blocks': 4,
      },
    ],
  };

  function buildDb(explainResult: FakeExplainResponse) {
    const client = {
      query: vi.fn(async (statement: string) =>
        statement.startsWith('EXPLAIN') ? explainResult : { rows: [] },
      ),
    };

    return {
      client,
      db: {
        $client: client,
        session: {
          prepareQuery: vi.fn((query: { sql: string; params: unknown[] }) => ({
            execute: vi.fn(async () => ({ rows: [] })),
            client,
            query,
          })),
        },
      },
    };
  }

  it('collects nothing and runs no extra query when left off', async () => {
    const { db, client } = buildDb(planPayload(seqScan));

    instrumentDrizzleClient(db, testConfig({ dbSystem: 'postgresql' }));

    await db.session.prepareQuery({ sql: 'SELECT 1', params: [] }).execute();

    expect(client.query).not.toHaveBeenCalled();
    expect(getSpan(0).attributes['db.plan.node']).toBeUndefined();
  });

  it('records the plan a statement was given', async () => {
    const { db, client } = buildDb(planPayload(seqScan));

    instrumentDrizzleClient(
      db,
      testConfig({
        dbSystem: 'postgresql',
        explain: 'plan',
      }),
    );

    await db.session
      .prepareQuery({
        sql: 'SELECT id FROM events WHERE tenant_id = $1',
        params: [42],
      })
      .execute();

    expect(client.query).toHaveBeenCalledWith(
      'EXPLAIN (FORMAT JSON) SELECT id FROM events WHERE tenant_id = $1',
      [42],
    );
    expect(getSpan(0).attributes['db.plan.node']).toBe('Seq Scan');
    expect(getSpan(0).attributes['db.plan.seq_scan']).toBe(true);
    expect(getSpan(0).attributes['db.plan.rows_estimated']).toBe(397);
    // Measured counts belong to ANALYZE, which this mode does not run.
    expect(getSpan(0).attributes['db.plan.rows_examined']).toBeUndefined();
  });

  it('counts rows the scan discarded, not only the rows returned', async () => {
    const { db } = buildDb(planPayload(seqScan, 6.65));

    instrumentDrizzleClient(
      db,
      testConfig({
        dbSystem: 'postgresql',
        explain: 'analyze',
      }),
    );

    await db.session
      .prepareQuery({
        sql: 'SELECT id FROM events WHERE tenant_id = $1',
        params: [42],
      })
      .execute();

    expect(getSpan(0).attributes['db.plan.rows_examined']).toBe(200_000);
    expect(getSpan(0).attributes['db.plan.rows_returned']).toBe(400);
    expect(getSpan(0).attributes['db.plan.blocks']).toBe(1082);
    expect(getSpan(0).attributes['db.plan.execution_ms']).toBe(6.65);
  });

  it('counts a row once per plan, not once per level of the tree', async () => {
    const { db } = buildDb(planPayload(indexScan, 0.5));

    instrumentDrizzleClient(
      db,
      testConfig({
        dbSystem: 'postgresql',
        explain: 'analyze',
      }),
    );

    await db.session
      .prepareQuery({
        sql: 'SELECT id FROM events WHERE tenant_id = $1',
        params: [42],
      })
      .execute();

    // The heap scan and the index scan below it both report 400 rows. Only the
    // leaf counts, or an index lookup looks twice as expensive as it is.
    expect(getSpan(0).attributes['db.plan.rows_examined']).toBe(400);
    expect(getSpan(0).attributes['db.plan.indexes']).toBe('idx_events_tenant');
    expect(getSpan(0).attributes['db.plan.seq_scan']).toBe(false);
  });

  it('changes db.plan.hash when the planner changes its mind', async () => {
    const first = buildDb(planPayload(seqScan, 6.65));
    instrumentDrizzleClient(
      first.db,
      testConfig({
        dbSystem: 'postgresql',
        explain: 'analyze',
      }),
    );
    await first.db.session
      .prepareQuery({ sql: 'SELECT 1 FROM events', params: [] })
      .execute();

    const second = buildDb(planPayload(indexScan, 0.5));
    instrumentDrizzleClient(
      second.db,
      testConfig({
        dbSystem: 'postgresql',
        explain: 'analyze',
      }),
    );
    await second.db.session
      .prepareQuery({ sql: 'SELECT 1 FROM events', params: [] })
      .execute();

    // Same statement, so the same statement hash. Different plan, so a
    // different plan hash. That pair is what an index change is judged on.
    expect(getSpan(0).attributes['db.statement.hash']).toBe(
      getSpan(1).attributes['db.statement.hash'],
    );
    expect(getSpan(0).attributes['db.plan.hash']).not.toBe(
      getSpan(1).attributes['db.plan.hash'],
    );
  });

  it('never runs ANALYZE on a statement that writes', async () => {
    const { db, client } = buildDb(planPayload(seqScan, 1));

    instrumentDrizzleClient(
      db,
      testConfig({
        dbSystem: 'postgresql',
        explain: 'analyze',
      }),
    );

    await db.session
      .prepareQuery({
        sql: 'INSERT INTO events (tenant_id) VALUES ($1)',
        params: [1],
      })
      .execute();

    // EXPLAIN ANALYZE executes what it measures, so running it here would
    // insert the row twice.
    expect(client.query).not.toHaveBeenCalled();
    expect(getSpan(0).attributes['db.plan.node']).toBeUndefined();
  });

  it('never runs ANALYZE on a CTE that writes', async () => {
    const { db, client } = buildDb(planPayload(seqScan, 1));

    instrumentDrizzleClient(
      db,
      testConfig({
        dbSystem: 'postgresql',
        explain: 'analyze',
      }),
    );

    await db.session
      .prepareQuery({
        sql: 'WITH gone AS (DELETE FROM events WHERE id = $1 RETURNING *) SELECT * FROM gone',
        params: [1],
      })
      .execute();

    expect(client.query).not.toHaveBeenCalled();
  });

  it('plans a read-only CTE', async () => {
    const { db, client } = buildDb(planPayload(seqScan));

    instrumentDrizzleClient(
      db,
      testConfig({ dbSystem: 'postgresql', explain: 'plan' }),
    );

    await db.session
      .prepareQuery({
        sql: 'WITH recent AS (SELECT * FROM events) SELECT * FROM recent',
        params: [],
      })
      .execute();

    expect(client.query).toHaveBeenCalled();
    expect(getSpan(0).attributes['db.plan.node']).toBe('Seq Scan');
  });

  it('ignores the setting for a database that is not postgres', async () => {
    const { db, client } = buildDb(planPayload(seqScan));

    instrumentDrizzleClient(
      db,
      testConfig({ dbSystem: 'mysql', explain: 'analyze' }),
    );

    await db.session.prepareQuery({ sql: 'SELECT 1', params: [] }).execute();

    expect(client.query).not.toHaveBeenCalled();
  });

  it('runs EXPLAIN on the client it came from', async () => {
    // A pooled driver keeps its connection state on the receiver. Calling the
    // bare query function throws, collectPlan swallows the error, and the plan
    // disappears with nothing failing to say so.
    class PooledClient {
      readonly connected = true;

      async query(statement: string): Promise<FakeResult> {
        if (!this.connected) {
          throw new Error('called without its receiver');
        }

        return statement.startsWith('EXPLAIN')
          ? planPayload(seqScan, 1)
          : { rows: [] };
      }
    }

    const client = new PooledClient();
    const db = {
      $client: client,
      session: {
        prepareQuery: vi.fn((_query: DrizzleQuery) => ({
          execute: vi.fn(async () => ({ rows: [] })),
          client,
        })),
      },
    };

    instrumentDrizzleClient(
      db,
      testConfig({ dbSystem: 'postgresql', explain: 'plan' }),
    );

    await db.session.prepareQuery({ sql: 'SELECT 1' }).execute();

    expect(getSpan(0).attributes['db.plan.node']).toBe('Seq Scan');
  });

  it('still runs and traces the query when EXPLAIN fails', async () => {
    const client = {
      query: vi.fn(async () => {
        throw new Error('permission denied for table events');
      }),
    };
    const executed = vi.fn(async () => ({ rows: [{ id: 1 }] }));
    const db = {
      $client: client,
      session: {
        prepareQuery: vi.fn((_query: DrizzleQuery) => ({
          execute: executed,
          client,
        })),
      },
    };

    instrumentDrizzleClient(
      db,
      testConfig({
        dbSystem: 'postgresql',
        explain: 'analyze',
      }),
    );

    const result = await db.session
      .prepareQuery({ sql: 'SELECT 1', params: [] })
      .execute();

    expect(result).toEqual({ rows: [{ id: 1 }] });
    expect(executed).toHaveBeenCalledTimes(1);
    expect(getSpan(0).attributes['db.plan.node']).toBeUndefined();
    expect(getSpan(0).status).toEqual({ code: SpanStatusCode.OK });
  });
});

describe('semantic conventions', () => {
  beforeEach(() => {
    spans.length = 0;
    delete process.env.OTEL_SEMCONV_STABILITY_OPT_IN;
  });

  function buildDb() {
    return {
      session: {
        prepareQuery: vi.fn((_query: DrizzleQuery) => ({
          execute: vi.fn(async () => ({ rows: [] })),
        })),
      },
    };
  }

  async function run(config?: InstrumentDrizzleConfig) {
    const db = buildDb();
    instrumentDrizzleClient(
      db,
      testConfig({
        dbSystem: 'postgresql',
        dbName: 'shop',
        ...config,
      }),
    );
    await db.session.prepareQuery({ sql: 'SELECT id FROM "orders"' }).execute();
  }

  it('emits the old attribute names by default', async () => {
    await run();

    expect(getSpan(0).attributes['db.system']).toBe('postgresql');
    expect(getSpan(0).attributes['db.operation']).toBe('SELECT');
    expect(getSpan(0).attributes['db.statement']).toBe(
      'SELECT id FROM "orders"',
    );
    expect(getSpan(0).attributes['db.name']).toBe('shop');
    expect(getSpan(0).attributes['db.system.name']).toBeUndefined();
    expect(getSpan(0).attributes['db.query.text']).toBeUndefined();
  });

  it('emits the current attribute names on request', async () => {
    await run({ semconv: 'stable' });

    expect(getSpan(0).attributes['db.system.name']).toBe('postgresql');
    expect(getSpan(0).attributes['db.operation.name']).toBe('SELECT');
    expect(getSpan(0).attributes['db.query.text']).toBe(
      'SELECT id FROM "orders"',
    );
    expect(getSpan(0).attributes['db.namespace']).toBe('shop');
    expect(getSpan(0).attributes['db.system']).toBeUndefined();
    expect(getSpan(0).attributes['db.statement']).toBeUndefined();
  });

  it('emits both names during a migration', async () => {
    await run({ semconv: 'dup' });

    expect(getSpan(0).attributes['db.system']).toBe('postgresql');
    expect(getSpan(0).attributes['db.system.name']).toBe('postgresql');
    expect(getSpan(0).attributes['db.statement']).toBe(
      'SELECT id FROM "orders"',
    );
    expect(getSpan(0).attributes['db.query.text']).toBe(
      'SELECT id FROM "orders"',
    );
  });

  it('follows OTEL_SEMCONV_STABILITY_OPT_IN', async () => {
    process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'http,database';
    await run();

    expect(getSpan(0).attributes['db.system.name']).toBe('postgresql');
    expect(getSpan(0).attributes['db.system']).toBeUndefined();
  });

  it('reads database/dup from OTEL_SEMCONV_STABILITY_OPT_IN', async () => {
    process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'database/dup';
    await run();

    expect(getSpan(0).attributes['db.system']).toBe('postgresql');
    expect(getSpan(0).attributes['db.system.name']).toBe('postgresql');
  });

  it('lets explicit config beat the environment', async () => {
    process.env.OTEL_SEMCONV_STABILITY_OPT_IN = 'database';
    await run({ semconv: 'legacy' });

    expect(getSpan(0).attributes['db.system']).toBe('postgresql');
    expect(getSpan(0).attributes['db.system.name']).toBeUndefined();
  });
});

describe('db.collection.name', () => {
  beforeEach(() => {
    spans.length = 0;
  });

  async function tableFor(sql: string) {
    const db = {
      session: {
        prepareQuery: vi.fn((_query: DrizzleQuery) => ({
          execute: vi.fn(async () => ({ rows: [] })),
        })),
      },
    };
    instrumentDrizzleClient(db, testConfig({ dbSystem: 'postgresql' }));
    await db.session.prepareQuery({ sql }).execute();
    return spans.at(-1)?.attributes['db.collection.name'];
  }

  it('reads the table off each kind of statement', async () => {
    expect(await tableFor('select "id" from "posts" where "id" = $1')).toBe(
      'posts',
    );
    expect(await tableFor('insert into "users" ("id") values ($1)')).toBe(
      'users',
    );
    expect(await tableFor('update "comments" set "body" = $1')).toBe(
      'comments',
    );
    expect(await tableFor('delete from "sessions" where "id" = $1')).toBe(
      'sessions',
    );
  });

  it('reads unquoted and raw SQL the same way', async () => {
    expect(await tableFor('SELECT * FROM orders WHERE id = 1')).toBe('orders');
    expect(await tableFor('UPDATE ONLY inventory SET qty = 0')).toBe(
      'inventory',
    );
  });

  it('names the driving table of a join', async () => {
    expect(
      await tableFor(
        'select p.id from "posts" p left join "comments" c on p.id = c.post_id',
      ),
    ).toBe('posts');
  });

  it('says nothing rather than guessing', async () => {
    expect(await tableFor('commit')).toBeUndefined();
    expect(await tableFor('SET LOCAL role app_user')).toBeUndefined();
  });
});

describe('transaction spans', () => {
  beforeEach(() => {
    spans.length = 0;
  });

  function buildDb() {
    return {
      session: {
        prepareQuery: vi.fn((_query: DrizzleQuery) => ({
          execute: vi.fn(async () => ({ rows: [] })),
        })),
        transaction: vi.fn(
          async (callback: (tx: FakeTransaction) => Promise<FakeResult>) => {
            const txSession = {
              prepareQuery: vi.fn((_query: DrizzleQuery) => ({
                execute: vi.fn(async () => ({ rows: [] })),
              })),
            };

            return callback({
              session: txSession,
              execute: vi.fn(async (query: DrizzleQuery) =>
                txSession.prepareQuery(query).execute?.(),
              ),
            });
          },
        ),
      },
    };
  }

  it('wraps the whole callback, including time between statements', async () => {
    const db = buildDb();
    instrumentDrizzleClient(db, testConfig({ dbSystem: 'postgresql' }));

    await db.session.transaction(async (tx: any) => {
      await tx.execute({ sql: 'SELECT 1' });
      await tx.execute({ sql: 'SELECT 2' });
    });

    expect(spans.map((span) => span.name)).toEqual([
      'drizzle.transaction',
      'drizzle.select',
      'drizzle.select',
    ]);
    // The transaction span must still be open while its statements run, or it
    // measures nothing useful.
    expect(getSpan(0).ended).toBe(true);
  });

  it('can be turned off', async () => {
    const db = buildDb();
    instrumentDrizzleClient(
      db,
      testConfig({
        dbSystem: 'postgresql',
        traceTransactions: false,
      }),
    );

    await db.session.transaction(async (tx: any) => {
      await tx.execute({ sql: 'SELECT 1' });
    });

    expect(spans.map((span) => span.name)).toEqual(['drizzle.select']);
  });

  it('records a failed transaction on the span', async () => {
    const db = {
      session: {
        transaction: vi.fn(
          async (callback: (tx: FakeTransaction) => Promise<FakeResult>) => {
            await callback({
              execute: async () => ({ ok: true }),
              session: { prepareQuery: vi.fn() },
            });
            throw new Error('deadlock detected');
          },
        ),
      },
    };

    instrumentDrizzleClient(db, testConfig({ dbSystem: 'postgresql' }));

    await expect(
      db.session.transaction(async () => {
        // The callback succeeds; the transaction itself fails on commit.
      }),
    ).rejects.toThrow('deadlock detected');

    expect(getSpan(0).name).toBe('drizzle.transaction');
    expect(getSpan(0).status).toEqual({ code: SpanStatusCode.ERROR });
  });
});

describe('other drizzle dialects', () => {
  beforeEach(() => {
    spans.length = 0;
  });

  it('reads a backtick-quoted mysql table', async () => {
    const db = {
      session: {
        prepareQuery: vi.fn((_query: DrizzleQuery) => ({
          execute: vi.fn(async () => ({ rows: [] })),
        })),
      },
    };
    instrumentDrizzleClient(db, testConfig({ dbSystem: 'mysql' }));

    await db.session
      .prepareQuery({ sql: 'insert into `bt_users` (`name`) values (?)' })
      .execute();

    expect(getSpan(0).attributes['db.collection.name']).toBe('bt_users');
  });

  it('drops the schema qualifier so one table groups under one name', async () => {
    const db = {
      session: {
        prepareQuery: vi.fn((_query: DrizzleQuery) => ({
          execute: vi.fn(async () => ({ rows: [] })),
        })),
      },
    };
    instrumentDrizzleClient(db, testConfig({ dbSystem: 'postgresql' }));

    await db.session
      .prepareQuery({ sql: 'select * from "public"."orders"' })
      .execute();

    expect(getSpan(0).attributes['db.collection.name']).toBe('orders');
  });

  it('traces one span when a prepared query answers all() with values()', () => {
    // The better-sqlite3 and bun-sqlite shape: both methods are traced, and
    // all() does its work by calling this.values() on the same object.
    const rawValues = vi.fn(() => [['a']]);
    const prepared: FakePreparedQuery & { values: () => FakeResult } = {
      values: rawValues,
    };
    prepared.all = vi.fn(() => prepared.values());

    const db = {
      session: {
        prepareQuery: vi.fn((_query: DrizzleQuery) => prepared),
      },
    };
    instrumentDrizzleClient(db, testConfig({ dbSystem: 'sqlite' }));

    const rows = db.session
      .prepareQuery({ sql: 'select "id" from "u"' })
      .all?.();

    expect(rows).toEqual([['a']]);
    expect(spans).toHaveLength(1);
    expect(getSpan(0).name).toBe('drizzle.select');
    // The delegated call still runs; it just does not open a second span.
    expect(rawValues).toHaveBeenCalledTimes(1);
  });

  it('keeps a span for each execution of a reused prepared query', async () => {
    // The guard must not outlive the synchronous call, or two concurrent runs
    // of one prepared statement would report a single span.
    const prepared: FakePreparedQuery & {
      execute: () => Promise<FakeResult>;
    } = {
      execute: vi.fn(
        async () =>
          new Promise<FakeResult>((resolve) =>
            setTimeout(() => resolve({ rows: [] }), 5),
          ),
      ),
    };
    const db = {
      session: { prepareQuery: vi.fn((_query: DrizzleQuery) => prepared) },
    };
    instrumentDrizzleClient(db, testConfig({ dbSystem: 'postgresql' }));

    const statement = db.session.prepareQuery({ sql: 'select 1' });
    await Promise.all([statement.execute(), statement.execute()]);

    expect(spans).toHaveLength(2);
  });

  it('leaves a synchronous driver synchronous', () => {
    // better-sqlite3 rejects a transaction callback that returns a promise, so
    // the wrapper must not turn a sync call into an async one.
    const prepared = { run: vi.fn(() => ({ changes: 1 })) };
    const db = {
      session: { prepareQuery: vi.fn((_query: DrizzleQuery) => prepared) },
    };
    instrumentDrizzleClient(db, testConfig({ dbSystem: 'sqlite' }));

    const result = db.session
      .prepareQuery({ sql: 'insert into "u" values (1)' })
      .run();

    expect(result).toEqual({ changes: 1 });
    expect(result).not.toBeInstanceOf(Promise);
  });

  it('ignores explain for a database that cannot answer it', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })) };
    const db = {
      $client: client,
      session: {
        prepareQuery: vi.fn((_query: DrizzleQuery) => ({
          execute: vi.fn(async () => ({ rows: [] })),
          client,
        })),
      },
    };

    for (const dbSystem of ['mysql', 'sqlite']) {
      instrumentDrizzleClient(
        { ...db, session: { ...db.session } },
        testConfig({ dbSystem, explain: 'analyze' }),
      );
    }

    instrumentDrizzleClient(
      db,
      testConfig({ dbSystem: 'sqlite', explain: 'analyze' }),
    );
    await db.session.prepareQuery({ sql: 'select 1' }).execute();

    expect(client.query).not.toHaveBeenCalled();
  });
});
