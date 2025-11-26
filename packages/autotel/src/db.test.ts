import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  instrumentDatabase,
  tracebQuery,
  DB_SYSTEMS,
  DB_OPERATIONS,
} from './db';
import { configure, resetConfig } from './config';

describe('instrumentDatabase', () => {
  beforeEach(() => {
    resetConfig();
  });

  it('should instrument database methods', async () => {
    const mockSpan = {
      setStatus: vi.fn(),
      setAttributes: vi.fn(),
      setAttribute: vi.fn(),
      end: vi.fn(),
    };

    const mockTracer = {
      startActiveSpan: vi.fn((name, fn) => fn(mockSpan)),
    };

    configure({
      tracer: mockTracer as any,
    });

    const repo = {
      async findUser(id: string) {
        return { id, name: 'Test' };
      },
    };

    instrumentDatabase(repo, {
      dbSystem: DB_SYSTEMS.POSTGRESQL,
      dbName: 'testdb',
    });

    const result = await repo.findUser('123');

    expect(result).toEqual({ id: '123', name: 'Test' });
    expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
      'postgresql.SELECT user',
      expect.any(Function),
    );
    expect(mockSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'db.system': 'postgresql',
        'db.operation': 'SELECT',
      }),
    );
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('db.name', 'testdb');
    expect(mockSpan.setAttribute).toHaveBeenCalledWith('db.sql.table', 'user');
    expect(mockSpan.end).toHaveBeenCalled();
  });

  it('should infer table names from method names', async () => {
    const mockSpan = {
      setStatus: vi.fn(),
      setAttributes: vi.fn(),
      setAttribute: vi.fn(),
      end: vi.fn(),
    };

    const mockTracer = {
      startActiveSpan: vi.fn((name, fn) => fn(mockSpan)),
    };

    configure({
      tracer: mockTracer as any,
    });

    const repo = {
      async createOrder() {
        return {};
      },
      async listUsers() {
        return [];
      },
      async deletePost() {
        return true;
      },
    };

    instrumentDatabase(repo, { dbSystem: 'postgresql' });

    await repo.createOrder();
    expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
      'postgresql.INSERT order',
      expect.any(Function),
    );

    await repo.listUsers();
    expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
      'postgresql.SELECT users',
      expect.any(Function),
    );

    await repo.deletePost();
    expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
      'postgresql.DELETE post',
      expect.any(Function),
    );
  });

  it('should mark slow queries', async () => {
    const mockSpan = {
      setStatus: vi.fn(),
      setAttributes: vi.fn(),
      setAttribute: vi.fn(),
      end: vi.fn(),
    };

    const mockTracer = {
      startActiveSpan: vi.fn((name, fn) => fn(mockSpan)),
    };

    configure({
      tracer: mockTracer as any,
    });

    const repo = {
      async slowQuery() {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return [];
      },
    };

    instrumentDatabase(repo, {
      dbSystem: 'postgresql',
      slowQueryThresholdMs: 10, // Very low threshold for testing
    });
    await repo.slowQuery();

    expect(mockSpan.setAttribute).toHaveBeenCalledWith('db.slow_query', true);
    expect(mockSpan.setAttribute).toHaveBeenCalledWith(
      'db.slow_query_threshold_ms',
      10,
    );
  });

  it('should track result counts for arrays', async () => {
    const mockSpan = {
      setStatus: vi.fn(),
      setAttributes: vi.fn(),
      setAttribute: vi.fn(),
      end: vi.fn(),
    };

    const mockTracer = {
      startActiveSpan: vi.fn((name, fn) => fn(mockSpan)),
    };

    configure({
      tracer: mockTracer as any,
    });

    const repo = {
      async listItems() {
        return [1, 2, 3, 4, 5];
      },
    };

    instrumentDatabase(repo, { dbSystem: 'postgresql' });
    await repo.listItems();

    expect(mockSpan.setAttribute).toHaveBeenCalledWith('db.result_count', 5);
  });

  it('should handle errors correctly', async () => {
    const mockSpan = {
      setStatus: vi.fn(),
      setAttributes: vi.fn(),
      setAttribute: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
    };

    const mockTracer = {
      startActiveSpan: vi.fn((name, fn) => fn(mockSpan)),
    };

    configure({
      tracer: mockTracer as any,
    });

    const repo = {
      async failingQuery() {
        throw new Error('Connection timeout');
      },
    };

    instrumentDatabase(repo, { dbSystem: 'postgresql' });

    await expect(repo.failingQuery()).rejects.toThrow('Connection timeout');

    expect(mockSpan.setStatus).toHaveBeenCalledWith({
      code: 2, // SpanStatusCode.ERROR
      message: 'Connection timeout',
    });
    expect(mockSpan.end).toHaveBeenCalled();
  });
});

describe('tracebQuery', () => {
  beforeEach(() => {
    resetConfig();
  });

  it('should trace database queries', async () => {
    const mockSpan = {
      setStatus: vi.fn(),
      setAttributes: vi.fn(),
      setAttribute: vi.fn(),
      end: vi.fn(),
    };

    const mockTracer = {
      startActiveSpan: vi.fn((name, fn) => fn(mockSpan)),
    };

    configure({
      tracer: mockTracer as any,
    });

    const result = await tracebQuery(
      DB_SYSTEMS.POSTGRESQL,
      DB_OPERATIONS.SELECT,
      async () => [{ id: 1 }],
      {
        'db.statement': 'SELECT * FROM users',
      },
    );

    expect(result).toEqual([{ id: 1 }]);
    expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
      'postgresql.SELECT',
      expect.any(Function),
    );
    expect(mockSpan.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({
        'db.system': 'postgresql',
        'db.operation': 'SELECT',
        'db.statement': 'SELECT * FROM users',
      }),
    );
    expect(mockSpan.end).toHaveBeenCalled();
  });
});
