import { describe, expect, expectTypeOf, it } from 'vitest';
import { traceMcpHandler } from './server';

describe('traceMcpHandler', () => {
  it('returns a Promise even for a synchronous handler, and says so', async () => {
    const traced = traceMcpHandler((n: number) => ({ content: [n] }), {
      type: 'tool',
      name: 'sync',
    });

    expectTypeOf(traced).parameters.toEqualTypeOf<[number]>();
    expectTypeOf(traced).returns.toEqualTypeOf<
      Promise<{ content: number[] }>
    >();

    const pending = traced(1);
    expect(pending).toBeInstanceOf(Promise);
    expect(await pending).toEqual({ content: [1] });
  });
});
