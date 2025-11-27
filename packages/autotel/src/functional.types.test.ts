/**
 * Type inference tests for trace() function
 *
 * These tests verify that TypeScript correctly infers return types
 * for various trace() call signatures.
 *
 * Run with: pnpm run type-check
 */

import { describe, it, expect } from 'vitest';
import { trace } from './functional';
import type { TraceContext } from './trace-helpers';

describe('trace() type inference', () => {
  // Helper to ensure we're getting the expected type
  // If the type is `unknown`, accessing .foo will cause a type error
  // This is a compile-time check

  it('trace(fn) - single argument factory should infer return type', async () => {
    // This SHOULD work - returns Promise<{ foo: string }>
    const fn1 = trace((_ctx: TraceContext) => async () => {
      return { foo: 'bar' };
    });

    const result1 = await fn1();
    // If type is correct, this compiles. If unknown, this errors.
    expect(result1.foo).toBe('bar');
  });

  it('trace(fn) - without explicit ctx type should infer return type', async () => {
    // Test from bug report: ctx without explicit type annotation
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const fn1 = trace((ctx) => async () => {
      return { foo: 'bar' };
    });

    const result1 = await fn1();
    // If type is correct, this compiles. If unknown, this errors.
    expect(result1.foo).toBe('bar');
  });

  it('trace(name, fn) - two argument factory should infer return type', async () => {
    // BUG: This SHOULD return Promise<{ foo: string }> but might return unknown
    const fn2 = trace('my-span-name', (_ctx: TraceContext) => async () => {
      return { foo: 'bar' };
    });

    const result2 = await fn2();
    // If the bug exists, TypeScript will error here because result2 is `unknown`
    // and we can't access .foo on unknown
    expect(result2.foo).toBe('bar');
  });

  it('trace(name, fn) - without explicit ctx type should infer return type', async () => {
    // Exact reproduction from bug report
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const fn2 = trace('my-span-name', (ctx) => async () => {
      return { foo: 'bar' };
    });

    const result2 = await fn2();
    // If the type is properly inferred as { foo: string }, accessing .foo should work.
    // If the bug exists and type is `unknown`, TypeScript will error here.
    // Adding @ts-expect-error would make the type check pass ONLY if there's an error.
    expect(result2.foo).toBe('bar');
  });

  it('BUG VERIFICATION: trace(name, fn) returns unknown type', async () => {
    // This test uses @ts-expect-error to VERIFY the bug exists
    // If @ts-expect-error is "unused", that means the bug is FIXED
    // If @ts-expect-error is needed, the bug EXISTS
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const fn2 = trace('my-span-name', (ctx) => async () => {
      return { foo: 'bar' };
    });

    const result2 = await fn2();

    // If result2 is inferred as `unknown`, we'd need @ts-expect-error
    // If result2 is inferred as `{ foo: string }`, this line works without error
    // BUG FIXED: No @ts-expect-error needed anymore!
    const _fooValue: string = result2.foo;
    expect(_fooValue).toBe('bar');
  });

  it('trace(fn) with args should infer return type', async () => {
    const fn3 = trace(
      (_ctx: TraceContext) => async (name: string, age: number) => {
        return { name, age };
      },
    );

    const result3 = await fn3('Alice', 30);
    expect(result3.name).toBe('Alice');
    expect(result3.age).toBe(30);
  });

  it('trace(name, fn) with args should infer return type', async () => {
    // BUG: This should also infer correctly
    const fn4 = trace(
      'user.create',
      (_ctx: TraceContext) => async (name: string, age: number) => {
        return { name, age };
      },
    );

    const result4 = await fn4('Bob', 25);
    // If type is correct, this compiles. If unknown, this errors.
    expect(result4.name).toBe('Bob');
    expect(result4.age).toBe(25);
  });

  it('trace(name, fn) sync factory should infer return type', () => {
    const fn5 = trace('sync.operation', (_ctx: TraceContext) => () => {
      return 42;
    });

    const result5 = fn5();
    // Type should be number, not unknown
    const numResult: number = result5;
    expect(numResult).toBe(42);
  });

  it('trace(name, fn) plain function should infer return type', async () => {
    // Plain function (no ctx) with name
    const fn6 = trace('plain.function', async (a: number, b: number) => {
      return a + b;
    });

    const result6 = await fn6(2, 3);
    // Type should be number, not unknown
    const numResult: number = result6;
    expect(numResult).toBe(5);
  });
});
