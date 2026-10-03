import { describe, expect, it, vi } from 'vitest';
import { asQueryClient } from './boundary';

describe('asQueryClient', () => {
  it('runs a pool query on a checked-out connection and hands it back clean', async () => {
    // node-postgres: pool.query() releases its connection with the query's
    // error, which destroys it. A failed EXPLAIN must not cost a connection.
    const connection = {
      query: vi.fn(async () => {
        throw new Error('permission denied for table t');
      }),
      release: vi.fn(),
    };
    const pool = {
      totalCount: 1,
      query: vi.fn(),
      connect: vi.fn(async () => connection),
    };

    const client = asQueryClient(pool)!;
    await expect(client.query('EXPLAIN SELECT 1', [])).rejects.toThrow(
      'permission denied',
    );

    expect(pool.query).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledWith();
  });

  it('calls any other client on itself', async () => {
    const plain = {
      query: vi.fn(async function (this: unknown) {
        return this;
      }),
    };
    expect(await asQueryClient(plain)!.query('SELECT 1', [])).toBe(plain);
  });
});
