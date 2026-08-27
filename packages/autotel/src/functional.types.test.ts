/**
 * Type inference tests for trace() function
 *
 * These tests verify that TypeScript correctly infers return types
 * for various trace() call signatures.
 *
 * Run with: pnpm run type-check
 */

import { describe, it, expect } from 'vitest';
import { instrument, withTracing, trace, span } from './functional';
import type { TraceContext } from './trace-context';

/**
 * The lazy builder an ORM returns: a full thenable, but not a Promise, so it
 * has no catch/finally and fails `instanceof Promise`.
 */
function queryBuilder(): PromiseLike<string> {
  return {
    then: (onFulfilled, onRejected) =>
      Promise.resolve('rows').then(onFulfilled, onRejected),
  };
}

describe('thenable results type as async', () => {
  it('span() returns a promise for a thenable callback', async () => {
    // Compiles only when a thenable routes through the async overload. Typed as
    // the builder instead, this assignment fails and the span silently ends
    // before the query runs.
    const rows: Promise<string> = span('db.query', () => queryBuilder());

    expect(await rows).toBe('rows');
  });

  it('trace() returns a promise for a thenable callback', async () => {
    const load = trace('db.load', () => queryBuilder());
    const rows: Promise<string> = load();

    expect(await rows).toBe('rows');
  });

  it('withTracing() accepts a factory returning a thenable', async () => {
    // withTracing takes the `(ctx) => (...args) => result` factory form.
    // WrappedFunction is `TReturn | Promise<TReturn>` by design and does not
    // narrow to Promise even for async functions, so await rather than
    // asserting the narrower type. What matters here is that it compiles: a
    // thenable factory used to be rejected outright.
    const load = withTracing({ name: 'db.load' })(() => () => queryBuilder());

    expect(await load()).toBe('rows');
  });

  it('instrument() exposes the promise it returns for a thenable function', async () => {
    const load = instrument({ key: 'db.load', fn: () => queryBuilder() });
    const rows: Promise<string> = load();

    expect(await rows).toBe('rows');
  });
});

describe('trace() type inference', () => {
  it('trace(name)(fn) preserves the wrapped signature', async () => {
    const createUser = trace('user.create')(
      async (name: string, age: number) => ({ name, age }),
    );

    const result = await createUser('Alice', 30);
    // Compiles only when the argument and return types survive the factory.
    expect(result.name).toBe('Alice');
    expect(result.age).toBe(30);
  });

  it('trace(name)(fn) keeps a sync function sync', () => {
    const add = trace('math.add')((a: number, b: number) => a + b);
    const sum: number = add(1, 2);
    expect(sum).toBe(3);
  });

  it('trace(name, fn) returns a wrapper preserving the signature', async () => {
    const createUser = trace(
      'user.create',
      async (name: string, age: number) => ({
        name,
        age,
      }),
    );

    const result = await createUser('Alice', 30);
    expect(result.name).toBe('Alice');
    expect(result.age).toBe(30);
  });

  it('trace.run(name, operation) returns the operation result, not a wrapper', async () => {
    const user = await trace.run('user.create', async (ctx) => {
      ctx.setAttribute('user.id', '123');
      return { id: '123' };
    });

    // Compiles only when this is the result type rather than a function.
    expect(user.id).toBe('123');
  });

  // Helper to ensure we're getting the expected type
  // If the type is `unknown`, accessing .foo will cause a type error
  // This is a compile-time check

  it('withTracing() factory should infer return type', async () => {
    // This SHOULD work - returns Promise<{ foo: string }>
    const fn1 = withTracing({})((_ctx: TraceContext) => async () => {
      return { foo: 'bar' };
    });

    const result1 = await fn1();
    // If type is correct, this compiles. If unknown, this errors.
    expect(result1.foo).toBe('bar');
  });

  it('withTracing() should infer ctx and return types', async () => {
    // Test from bug report: ctx without explicit type annotation
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const fn1 = withTracing({})((ctx) => async () => {
      return { foo: 'bar' };
    });

    const result1 = await fn1();
    // If type is correct, this compiles. If unknown, this errors.
    expect(result1.foo).toBe('bar');
  });

  it('withTracing({ name }) should infer return type', async () => {
    // BUG: This SHOULD return Promise<{ foo: string }> but might return unknown
    const fn2 = withTracing({ name: 'my-span-name' })(
      (_ctx: TraceContext) => async () => {
        return { foo: 'bar' };
      },
    );

    const result2 = await fn2();
    // If the bug exists, TypeScript will error here because result2 is `unknown`
    // and we can't access .foo on unknown
    expect(result2.foo).toBe('bar');
  });

  it('withTracing({ name }) should infer ctx type', async () => {
    // Exact reproduction from bug report
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const fn2 = withTracing({ name: 'my-span-name' })((ctx) => async () => {
      return { foo: 'bar' };
    });

    const result2 = await fn2();
    // If the type is properly inferred as { foo: string }, accessing .foo should work.
    // If the bug exists and type is `unknown`, TypeScript will error here.
    // Adding @ts-expect-error would make the type check pass ONLY if there's an error.
    expect(result2.foo).toBe('bar');
  });

  it('keeps the named withTracing() result concrete', async () => {
    // This test uses @ts-expect-error to VERIFY the bug exists
    // If @ts-expect-error is "unused", that means the bug is FIXED
    // If @ts-expect-error is needed, the bug EXISTS
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const fn2 = withTracing({ name: 'my-span-name' })((ctx) => async () => {
      return { foo: 'bar' };
    });

    const result2 = await fn2();

    // If result2 is inferred as `unknown`, we'd need @ts-expect-error
    // If result2 is inferred as `{ foo: string }`, this line works without error
    // BUG FIXED: No @ts-expect-error needed anymore!
    const _fooValue: string = result2.foo;
    expect(_fooValue).toBe('bar');
  });

  it('withTracing() with args should infer return type', async () => {
    const fn3 = withTracing({})(
      (_ctx: TraceContext) => async (name: string, age: number) => {
        return { name, age };
      },
    );

    const result3 = await fn3('Alice', 30);
    expect(result3.name).toBe('Alice');
    expect(result3.age).toBe(30);
  });

  it('named withTracing() with args should infer return type', async () => {
    // BUG: This should also infer correctly
    const fn4 = withTracing({ name: 'user.create' })(
      (_ctx: TraceContext) => async (name: string, age: number) => {
        return { name, age };
      },
    );

    const result4 = await fn4('Bob', 25);
    // If type is correct, this compiles. If unknown, this errors.
    expect(result4.name).toBe('Bob');
    expect(result4.age).toBe(25);
  });

  it('named withTracing() sync factory should infer return type', () => {
    const fn5 = withTracing({ name: 'sync.operation' })(
      (_ctx: TraceContext) => () => {
        return 42;
      },
    );

    // withTracing() returns the broad `T | Promise<T>` wrapper type since it
    // cannot statically know whether the inner function is sync or async.
    const result5 = fn5();
    expect(result5).toBe(42);
  });

  it('instrument({ key, fn }) should preserve a plain function type', async () => {
    const fn6 = instrument({
      key: 'plain.function',
      fn: async (a: number, b: number) => {
        return a + b;
      },
    });

    const result6 = await fn6(2, 3);
    // Type should be number, not unknown
    const numResult: number = result6;
    expect(numResult).toBe(5);
  });

  it('trace.run(name, operation) infers TraceContext and the resolved result', async () => {
    const operation = trace.run('typed.operation', async (ctx) => {
      ctx.setAttribute('typed', true);
      return 42;
    });

    const result: number = await operation;
    expect(result).toBe(42);
  });
});
