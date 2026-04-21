import { beforeEach, describe, expect, it, vi } from 'vitest';

const spans = vi.hoisted(() => [] as MockSpan[]);
const tracer = vi.hoisted(() => ({
  startSpan: vi.fn((name: string, options: unknown) => {
    const span: MockSpan = {
      name,
      options,
      attributes: {},
      status: undefined,
      ended: false,
      exceptions: [],
      setAttribute: vi.fn((key: string, value: unknown) => {
        span.attributes[key] = value;
      }),
      setStatus: vi.fn((status: unknown) => {
        span.status = status;
      }),
      recordException: vi.fn((error: unknown) => {
        span.exceptions.push(error);
      }),
      end: vi.fn(() => {
        span.ended = true;
      }),
    };

    spans.push(span);
    return span;
  }),
}));
const runWithSpan = vi.hoisted(() =>
  vi.fn((_span: unknown, fn: () => unknown) => fn()),
);
const finalizeSpan = vi.hoisted(() =>
  vi.fn((span: MockSpan, error?: unknown) => {
    if (error === undefined) {
      span.setStatus({ code: 'OK' });
    } else {
      span.recordException(error);
      span.setStatus({ code: 'ERROR' });
    }
    span.end();
  }),
);

vi.mock('@opentelemetry/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@opentelemetry/api')>();

  return {
    ...actual,
    trace: {
      ...actual.trace,
      getTracer: vi.fn(() => tracer),
    },
  };
});

vi.mock('autotel/trace-helpers', () => ({
  runWithSpan,
  finalizeSpan,
}));

import {
  instrumentDrizzle,
  instrumentDrizzleClient,
  type InstrumentDrizzleConfig,
} from './index';

interface MockSpan {
  name: string;
  options: unknown;
  attributes: Record<string, unknown>;
  status: unknown;
  ended: boolean;
  exceptions: unknown[];
  setAttribute: ReturnType<typeof vi.fn>;
  setStatus: ReturnType<typeof vi.fn>;
  recordException: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

function getSpan(index = 0): MockSpan {
  const span = spans[index];
  expect(span).toBeDefined();
  return span as MockSpan;
}

describe('instrumentDrizzle', () => {
  beforeEach(() => {
    spans.length = 0;
    tracer.startSpan.mockClear();
    runWithSpan.mockClear();
    finalizeSpan.mockClear();
  });

  it('preserves synchronous query return values', () => {
    const client = {
      query: vi.fn(() => ({ rows: [{ id: 1 }] })),
    };

    instrumentDrizzle(client);

    const result = client.query('SELECT 1');

    expect(result).toEqual({ rows: [{ id: 1 }] });
    expect(result).not.toBeInstanceOf(Promise);
    expect(finalizeSpan).toHaveBeenCalledTimes(1);
    expect(getSpan().name).toBe('drizzle.select');
  });

  it('wraps both query and execute when both methods exist', async () => {
    const client = {
      query: vi.fn(async () => ({ source: 'query' })),
      execute: vi.fn(async () => ({ source: 'execute' })),
    };

    instrumentDrizzle(client);
    const wrappedQuery = client.query;
    const wrappedExecute = client.execute;

    instrumentDrizzle(client);

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
          callback: (error: unknown, result: { ok: true }) => void,
        ) => {
          callback(null, { ok: true });
          return;
        },
      ),
    };

    instrumentDrizzle(client);

    await new Promise<void>((resolve) => {
      const result = client.query('SELECT 1', (error, payload) => {
        expect(error).toBeNull();
        expect(payload).toEqual({ ok: true });
        resolve();
      });

      expect(result).toBeUndefined();
    });

    expect(finalizeSpan).toHaveBeenCalledWith(getSpan(), null);
  });

  it('records async failures', async () => {
    const error = new Error('boom');
    const client = {
      query: vi.fn(async () => {
        throw error;
      }),
    };

    instrumentDrizzle(client);

    await expect(client.query('SELECT 1')).rejects.toThrow(error);

    expect(getSpan().exceptions).toContain(error);
    expect(getSpan().status).toEqual({ code: 'ERROR' });
  });

  it('applies config to captured spans', async () => {
    const client = {
      execute: vi.fn(async () => ({ rows: [] })),
    };
    const config: InstrumentDrizzleConfig = {
      dbSystem: 'mysql',
      dbName: 'app',
      peerName: 'db.example.com',
      peerPort: 3306,
      maxQueryTextLength: 12,
    };

    instrumentDrizzle(client, config);
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
      query: vi.fn(async () => ({ rows: [] })),
    };

    instrumentDrizzle(client, { captureQueryText: false });
    await client.query({ text: 'UPDATE users SET name = $1' });

    expect(getSpan().attributes['db.operation']).toBe('UPDATE');
    expect(getSpan().attributes['db.statement']).toBeUndefined();
  });
});

describe('instrumentDrizzleClient', () => {
  beforeEach(() => {
    spans.length = 0;
    tracer.startSpan.mockClear();
    runWithSpan.mockClear();
    finalizeSpan.mockClear();
  });

  it('instruments prepared query helper methods, not just execute', () => {
    const prepared = {
      all: vi.fn(() => [{ id: 1 }]),
      get: vi.fn(() => ({ id: 1 })),
    };
    const db = {
      session: {
        prepareQuery: vi.fn(() => prepared),
      },
    };

    instrumentDrizzleClient(db);

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
    const originalClientQuery = vi.fn(async () => ({ rows: ['client'] }));
    const db = {
      session: {
        execute: vi.fn(async () => ({ rows: ['session'] })),
      },
      $client: {
        query: originalClientQuery,
      },
    };

    instrumentDrizzleClient(db);

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
      query: vi.fn(async () => ({ rows: [{ id: 1 }] })),
    };
    const db = {
      $client: client,
      session: {
        prepareQuery: vi.fn((query: { sql: string }) => ({
          execute: vi.fn(async () => client.query(query.sql)),
        })),
      },
    };

    instrumentDrizzleClient(db);

    const prepared = db.session.prepareQuery({ sql: 'SELECT 1' });
    await prepared.execute();

    // Exactly one autotel span should be created — the one from
    // instrumented prepared.execute. The inner $client.query call must
    // NOT create its own span.
    expect(spans).toHaveLength(1);
    expect(getSpan(0).name).toBe('drizzle.select');
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it('instruments transaction execute and nested transaction session queries', async () => {
    let txRef: any;
    const db = {
      session: {
        transaction: vi.fn(async (callback: (tx: unknown) => unknown) => {
          txRef = {
            execute: vi.fn(async () => ({ ok: true })),
            session: {
              query: vi.fn(async () => ({ ok: true })),
            },
          };

          return callback(txRef);
        }),
      },
    };

    instrumentDrizzleClient(db);

    await db.session.transaction(async (tx: any) => {
      await tx.execute({ sql: 'SET LOCAL role app_user' });
      await tx.session.query('SELECT 1');
    });

    expect(spans).toHaveLength(2);
    expect(getSpan(0).attributes['db.transaction']).toBe(true);
    expect(getSpan(1).attributes['db.transaction']).toBe(true);
    expect(txRef.execute).not.toBeUndefined();
  });

  it('preserves sync execution for fallback _.session.execute', () => {
    const db = {
      _: {
        session: {
          execute: vi.fn(() => ({ rows: [1] })),
        },
      },
    };

    instrumentDrizzleClient(db);

    const result = db._.session.execute('DELETE FROM users');

    expect(result).toEqual({ rows: [1] });
    expect(result).not.toBeInstanceOf(Promise);
    expect(getSpan().name).toBe('drizzle.delete');
  });

  it('is idempotent when called repeatedly', () => {
    const originalClientExecute = vi.fn(async () => ({ rows: [] }));
    const db = {
      session: {
        query: vi.fn(async () => ({ rows: [] })),
      },
      $client: {
        execute: originalClientExecute,
      },
    };

    instrumentDrizzleClient(db);
    const firstSessionQuery = db.session.query;

    instrumentDrizzleClient(db);

    expect(db.session.query).toBe(firstSessionQuery);
    // $client.execute is intentionally not wrapped by instrumentDrizzleClient.
    expect(db.$client.execute).toBe(originalClientExecute);
  });
});
