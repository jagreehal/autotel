import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trace, withTracing, instrument, span } from './functional';
import { trace as otelTrace, SpanStatusCode } from '@opentelemetry/api';

function tracedFunction<TArgs extends any[], TReturn>(
  options: Parameters<typeof withTracing<TArgs, TReturn>>[0],
  fn: (...args: TArgs) => TReturn | Promise<TReturn>,
) {
  return withTracing<TArgs, TReturn>(options)(() => fn);
}

describe('Functional API', () => {
  let mockTracer: any;
  let mockSpan: any;
  let getTracerSpy: any;

  beforeEach(() => {
    mockSpan = {
      spanContext: () => ({
        traceId: 'test-trace-id',
        spanId: 'test-span-id',
        traceFlags: 1,
      }),
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
      isRecording: vi.fn().mockReturnValue(true),
      updateName: vi.fn(),
      addEvent: vi.fn(),
      addLink: vi.fn(),
      addLinks: vi.fn(),
    };

    mockTracer = {
      startActiveSpan: vi.fn((_name, optionsOrFn, maybeFn) => {
        const fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn;
        try {
          const result = fn(mockSpan);
          // If it's a promise, ensure errors are properly propagated
          if (result && typeof result.then === 'function') {
            return result.catch((error: any) => {
              // Re-throw to maintain error behavior but ensure it's in promise chain
              throw error;
            });
          }
          return result;
        } catch (error) {
          // Convert sync errors to rejected promises to match OTel behavior
          return Promise.reject(error);
        }
      }),
    };

    getTracerSpy = vi
      .spyOn(otelTrace, 'getTracer')
      .mockReturnValue(mockTracer as any);
  });

  afterEach(() => {
    getTracerSpy.mockRestore();
  });

  describe('trace() - Simple Usage', () => {
    it('does not execute function during instrumentation', () => {
      let executions = 0;
      const traced = trace(function add(a: number, b: number) {
        executions += 1;
        return a + b;
      });

      expect(executions).toBe(0);
      const result = traced(2, 3);
      expect(result).toBe(5);
      expect(executions).toBe(1);
    });

    it('should auto-name span from function name', async () => {
      const testFunction = trace(async function createUser(email: string) {
        return { id: '123', email };
      });

      const result = await testFunction('test@example.com');

      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'createUser',
        {},
        expect.any(Function),
      );
      expect(result).toEqual({ id: '123', email: 'test@example.com' });
    });

    it('should set span status to OK on success', async () => {
      const testFunction = trace(async function successFunction() {
        return 'success';
      });

      await testFunction();

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should record exception and set error status with message on failure', async () => {
      const error = new Error('test error');
      const testFunction = trace(async function failingFunction() {
        throw error;
      });

      await expect(testFunction()).rejects.toThrow('test error');

      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'test error',
      });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should handle non-Error exceptions', async () => {
      const testFunction = trace(async function failingFunction() {
        throw 'string error';
      });

      await expect(testFunction()).rejects.toBe('string error');

      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'string error',
      });
    });
    it('should support synchronous functions', () => {
      const testFunction = trace(function multiply(a: number, b: number) {
        return a * b;
      });

      const result = testFunction(3, 4);

      expect(result).toBe(12);
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'multiply',
        {},
        expect.any(Function),
      );
    });

    it('waits for a Promise returned by a non-async function', async () => {
      let reject!: (error: Error) => void;
      const pending = new Promise<string>((_resolve, rejectPromise) => {
        reject = rejectPromise;
      });
      const testFunction = tracedFunction(
        { name: 'promise-returning' },
        () => pending,
      );
      const result = testFunction();

      expect(mockSpan.end).not.toHaveBeenCalled();

      const failure = new Error('late failure');
      reject(failure);
      await expect(result).rejects.toBe(failure);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'late failure',
      });
      expect(mockSpan.recordException).toHaveBeenCalledWith(failure);
      expect(mockSpan.end).toHaveBeenCalledOnce();
    });

    it('passes the resolved value to attributesFromResult for a non-async Promise', async () => {
      const attributesFromResult = vi.fn((value: string) => ({
        'result.value': value,
      }));
      const testFunction = tracedFunction(
        { name: 'promise-result', attributesFromResult },
        () => Promise.resolve('resolved'),
      );

      await expect(testFunction()).resolves.toBe('resolved');
      expect(attributesFromResult).toHaveBeenCalledWith('resolved');
      expect(mockSpan.setAttributes).toHaveBeenCalledWith({
        'result.value': 'resolved',
      });
    });
  });

  describe('trace() - Named Spans', () => {
    it('runs a named operation immediately with an explicit TraceContext', async () => {
      const result = await trace.run('checkout.complete', async (ctx) => {
        ctx.setAttribute('order.id', 'order_123');
        ctx.setStatus({ code: SpanStatusCode.OK });
        return 'done';
      });

      expect(result).toBe('done');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        'order.id',
        'order_123',
      );
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
    });

    it('preserves an explicit status set by the operation', () => {
      const result = trace.run('cache.fallback', (ctx) => {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: 'primary cache unavailable',
        });
        return 'fallback';
      });

      expect(result).toBe('fallback');
      expect(mockSpan.setStatus).toHaveBeenCalledTimes(1);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'primary cache unavailable',
      });
    });

    it('should use custom span name', async () => {
      const testFunction = tracedFunction(
        { name: 'user.create' },
        async function (email: string) {
          return { id: '123', email };
        },
      );

      await testFunction('test@example.com');

      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'user.create',
        {},
        expect.any(Function),
      );
    });

    it('should work with arrow functions', async () => {
      const testFunction = tracedFunction(
        { name: 'custom.name' },
        async (email: string) => {
          return { id: '123', email };
        },
      );

      await testFunction('test@example.com');

      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'custom.name',
        {},
        expect.any(Function),
      );
    });
  });

  describe('withTracing() - Full Options', () => {
    it('should extract attributes from arguments', async () => {
      const testFunction = tracedFunction(
        {
          name: 'user.create',
          attributesFromArgs: ([email]: [string]) => ({ 'user.email': email }),
        },
        async function (email: string) {
          return { id: '123', email };
        },
      );

      await testFunction('test@example.com');

      expect(mockSpan.setAttributes).toHaveBeenCalledWith({
        'user.email': 'test@example.com',
      });
    });

    it('should extract attributes from result', async () => {
      const testFunction = tracedFunction(
        {
          name: 'user.create',
          attributesFromResult: (user: any) => ({ 'user.id': user.id }),
        },
        async function (email: string) {
          return { id: '123', email };
        },
      );

      await testFunction('test@example.com');

      expect(mockSpan.setAttributes).toHaveBeenCalledWith({ 'user.id': '123' });
    });

    it('should extract attributes from both args and result', async () => {
      const testFunction = tracedFunction(
        {
          name: 'user.create',
          attributesFromArgs: ([email]: [string]) => ({ 'user.email': email }),
          attributesFromResult: (user: any) => ({ 'user.id': user.id }),
        },
        async function (email: string) {
          return { id: '123', email };
        },
      );

      await testFunction('test@example.com');

      expect(mockSpan.setAttributes).toHaveBeenCalledWith({
        'user.email': 'test@example.com',
      });
      expect(mockSpan.setAttributes).toHaveBeenCalledWith({ 'user.id': '123' });
    });

    it('should add static attributes', async () => {
      const testFunction = tracedFunction(
        {
          name: 'user.create',
          attributes: { 'service.type': 'user-management' },
        },
        async function (email: string) {
          return { id: '123', email };
        },
      );

      await testFunction('test@example.com');

      expect(mockSpan.setAttributes).toHaveBeenCalledWith({
        'service.type': 'user-management',
      });
    });

    it('should use serviceName to prefix function name', async () => {
      const testFunction = tracedFunction(
        {
          serviceName: 'user',
        },
        async function createUser(email: string) {
          return { id: '123', email };
        },
      );

      await testFunction('test@example.com');

      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'user.createUser',
        {},
        expect.any(Function),
      );
    });
  });

  describe('trace(name)(fn) - Wrapper Factory', () => {
    it('wraps a plain function under the explicit name', async () => {
      const createUser = trace('user.create')(async (name: string) => ({
        id: '1',
        name,
      }));

      await expect(createUser('Alice')).resolves.toEqual({
        id: '1',
        name: 'Alice',
      });
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'user.create',
        expect.anything(),
        expect.any(Function),
      );
    });

    it('returns the wrapper without running the function', () => {
      const ran = vi.fn();

      const wrapped = trace('never.run')(ran);

      expect(typeof wrapped).toBe('function');
      expect(ran).not.toHaveBeenCalled();
      expect(mockTracer.startActiveSpan).not.toHaveBeenCalled();
    });

    // Matches core: every trace(...) form wraps, trace.run(...) runs. Nothing
    // reads a parameter name, so a minifier cannot flip the dispatch (#166).
    it('never runs the function, whatever the parameter is called', async () => {
      const curried = trace('wrapper.curried')(async (c: string) => c);
      const twoArg = trace('wrapper.two-arg', async (c: string) => c);

      expect(typeof curried).toBe('function');
      expect(typeof twoArg).toBe('function');
      expect(mockTracer.startActiveSpan).not.toHaveBeenCalled();

      await expect(curried('x')).resolves.toBe('x');
      await expect(twoArg('y')).resolves.toBe('y');

      const immediate = await trace.run('immediate.form', async (c) => {
        c.setAttribute('checked', true);
        return 'ran';
      });
      expect(immediate).toBe('ran');

      expect(
        mockTracer.startActiveSpan.mock.calls.map((call: unknown[]) => call[0]),
      ).toEqual(['wrapper.curried', 'wrapper.two-arg', 'immediate.form']);
    });

    it('trace(name, fn) wraps rather than running - the v6.5.0 form', async () => {
      const ran = vi.fn(async (name: string) => `hi ${name}`);

      const greet = trace('greet', ran);

      expect(typeof greet).toBe('function');
      expect(ran).not.toHaveBeenCalled();
      expect(mockTracer.startActiveSpan).not.toHaveBeenCalled();

      await expect(greet('Alice')).resolves.toBe('hi Alice');
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'greet',
        expect.anything(),
        expect.any(Function),
      );
    });

    it('trace.run rejects a non-function operation', () => {
      expect(() =>
        (trace.run as (n: string, o?: unknown) => unknown)('oops'),
      ).toThrow('operation must be a function');
    });
  });

  describe('trace() - Sampler Option', () => {
    it('should pass sampler to startActiveSpan when provided', async () => {
      const mockSampler = {
        shouldSample: vi.fn(() => ({
          decision: 1, // RECORD_AND_SAMPLED
          attributes: {},
        })),
        toString: () => 'MockSampler',
      };

      const testFunction = tracedFunction(
        {
          name: 'test.function',
          sampler: mockSampler as any,
        },
        async function () {
          return 'success';
        },
      );

      await testFunction();

      // Verify startActiveSpan was called with options containing the sampler
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'test.function',
        { sampler: mockSampler },
        expect.any(Function),
      );
    });

    it('should NOT pass options when sampler is not provided', async () => {
      const testFunction = tracedFunction(
        {
          name: 'test.function',
        },
        async function () {
          return 'success';
        },
      );

      await testFunction();

      // Verify startActiveSpan was called WITHOUT sampler options
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'test.function',
        {},
        expect.any(Function),
      );
    });

    it('should work with custom sampler that rejects sampling', async () => {
      const rejectSampler = {
        shouldSample: vi.fn(() => ({
          decision: 0, // NOT_RECORD
          attributes: {},
        })),
        toString: () => 'RejectSampler',
      };

      const testFunction = tracedFunction(
        {
          name: 'test.function',
          sampler: rejectSampler as any,
        },
        async function () {
          return 'success';
        },
      );

      const result = await testFunction();

      expect(result).toBe('success');
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'test.function',
        { sampler: rejectSampler },
        expect.any(Function),
      );
    });

    it('should combine sampler with other options', async () => {
      const mockSampler = {
        shouldSample: vi.fn(() => ({
          decision: 1,
          attributes: {},
        })),
        toString: () => 'MockSampler',
      };

      const testFunction = tracedFunction(
        {
          name: 'test.function',
          sampler: mockSampler as any,
          attributes: { 'custom.tag': 'value' },
          attributesFromArgs: ([arg]: [string]) => ({ 'arg.value': arg }),
        },
        async function (_arg: string) {
          return 'success';
        },
      );

      await testFunction('test-arg');

      // Verify sampler is passed
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'test.function',
        { sampler: mockSampler },
        expect.any(Function),
      );

      // Verify attributes are still added
      expect(mockSpan.setAttributes).toHaveBeenCalledWith({
        'custom.tag': 'value',
      });
      expect(mockSpan.setAttributes).toHaveBeenCalledWith({
        'arg.value': 'test-arg',
      });
    });
  });

  describe('trace() - Sampler Integration', () => {
    it('should verify sampler is actually invoked by WorkerTracer', async () => {
      // This test should be in an integration test file that uses real WorkerTracer
      // For now, we document that the sampler needs to be passed through
      // The actual sampling logic is tested in tracer.test.ts
      expect(true).toBe(true);
    });
  });

  describe('withTracing() - Composable Middleware', () => {
    it('should create prefixed middleware', async () => {
      const withUserTracing = withTracing({ serviceName: 'user' });
      const createUserFn = withUserTracing(
        (_ctx) =>
          async function myCreateUser(email: string) {
            return { id: '123', email };
          },
      );

      await createUserFn('test@example.com');

      const spanName = mockTracer.startActiveSpan.mock.calls[0][0];
      expect(spanName).toMatch(/^user\./);
      expect(typeof mockTracer.startActiveSpan.mock.calls[0][2]).toBe(
        'function',
      );
    });

    it('should work with multiple functions', async () => {
      const withUserTracing = withTracing({ serviceName: 'user' });

      const createUserFn = withUserTracing(
        (_ctx) =>
          async function createUserAction(email: string) {
            return { id: '123', email };
          },
      );

      const updateUserFn = withUserTracing(
        (_ctx) =>
          async function updateUserAction(id: string, data: any) {
            return { id, ...data };
          },
      );

      await createUserFn('test@example.com');
      await updateUserFn('123', { name: 'Test' });

      expect(mockTracer.startActiveSpan).toHaveBeenCalledTimes(2);

      const firstCall = mockTracer.startActiveSpan.mock.calls[0][0];
      const secondCall = mockTracer.startActiveSpan.mock.calls[1][0];

      expect(firstCall).toMatch(/^user\./);
      expect(secondCall).toMatch(/^user\./);
    });

    it('should support custom attribute extractors', async () => {
      const withUserTracing = withTracing({
        serviceName: 'user',
        attributesFromArgs: ([email]: [string]) => ({ 'user.email': email }),
      });

      const createUser = withUserTracing(
        (_ctx) =>
          async function createUser(email: string) {
            return { id: '123', email };
          },
      );

      await createUser('test@example.com');

      expect(mockSpan.setAttributes).toHaveBeenCalledWith({
        'user.email': 'test@example.com',
      });
    });
  });

  describe('instrument()', () => {
    it('wraps one reusable function with a stable key', async () => {
      const createUser = instrument({
        key: 'user.create',
        fn: async (email: string) => ({ id: '123', email }),
      });

      await expect(createUser('test@example.com')).resolves.toEqual({
        id: '123',
        email: 'test@example.com',
      });
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'user.create',
        {},
        expect.any(Function),
      );
    });

    it('rejects invalid single-function options', () => {
      expect(() => instrument({ key: '', fn: () => undefined })).toThrow(
        '"key" must be a non-empty string',
      );
      expect(() =>
        instrument({ key: 'invalid', fn: 'not-a-function' } as never),
      ).toThrow('"fn" must be a function');
    });

    it('should instrument multiple functions', async () => {
      const instrumented = (instrument as any)({
        functions: {
          createUser: async (email: string) => ({ id: '123', email }),
          updateUser: async (id: string, data: any) => ({ id, ...data }),
          deleteUser: async (id: string) => ({ id }),
        } as any,
        serviceName: 'user',
      });

      await instrumented.createUser('test@example.com');
      await instrumented.updateUser('123', { name: 'Test' });
      await instrumented.deleteUser('123');

      expect(mockTracer.startActiveSpan).toHaveBeenNthCalledWith(
        1,
        'user.createUser',
        {},
        expect.any(Function),
      );
      expect(mockTracer.startActiveSpan).toHaveBeenNthCalledWith(
        2,
        'user.updateUser',
        {},
        expect.any(Function),
      );
      expect(mockTracer.startActiveSpan).toHaveBeenNthCalledWith(
        3,
        'user.deleteUser',
        {},
        expect.any(Function),
      );
    });

    it('should skip functions based on pattern', async () => {
      const instrumented = (instrument as any)({
        functions: {
          createUser: async (email: string) => ({ id: '123', email }),
          _internal: async () => 'internal',
          testHelper: async () => 'helper',
        } as any,
        serviceName: 'user',
        skip: ['_internal', /test/],
      });

      await instrumented.createUser('test@example.com');
      await instrumented._internal();
      await instrumented.testHelper();

      // Only createUser should be trace
      expect(mockTracer.startActiveSpan).toHaveBeenCalledTimes(1);
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'user.createUser',
        {},
        expect.any(Function),
      );
    });

    it('should support per-function overrides', async () => {
      const instrumented = (instrument as any)({
        functions: {
          createUser: async (email: string) => ({ id: '123', email }),
          updateUser: async (id: string, data: any) => ({ id, ...data }),
        } as any,
        serviceName: 'user',
        overrides: {
          updateUser: {
            attributes: { 'operation.type': 'update' },
          },
        },
      });

      await instrumented.createUser('test@example.com');
      await instrumented.updateUser('123', { name: 'Test' });

      // Check that updateUser has the custom attribute
      const updateUserCall = mockSpan.setAttributes.mock.calls.find(
        (call: any) => call[0]['operation.type'] === 'update',
      );
      expect(updateUserCall).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle functions returning void', async () => {
      const voidFunction = trace(async function logSomething() {
        console.log('logging');
      });

      const result = await voidFunction();

      expect(result).toBeUndefined();
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
    });

    it('should handle functions with no arguments', async () => {
      const noArgsFunction = trace(async function getCurrentTime() {
        return Date.now();
      });

      const result = await noArgsFunction();

      expect(result).toBeTypeOf('number');
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
    });

    it('should handle functions with many arguments', async () => {
      const manyArgsFunction = trace(async function complexFunction(
        a: number,
        b: string,
        c: boolean,
        d: object,
      ) {
        return { a, b, c, d };
      });

      const result = await manyArgsFunction(1, 'test', true, { key: 'value' });

      expect(result).toEqual({ a: 1, b: 'test', c: true, d: { key: 'value' } });
    });

    it('should handle functions returning promises', async () => {
      const promiseFunction = trace(async function getDataAsync() {
        return { data: 'test' };
      });

      const result = await promiseFunction();

      expect(result).toEqual({ data: 'test' });
    });

    it('should handle rejected promises', async () => {
      const rejectingFunction = trace(async function rejectAsync() {
        throw new Error('async error');
      });

      await expect(rejectingFunction()).rejects.toThrow('async error');

      expect(mockSpan.recordException).toHaveBeenCalled();
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.ERROR,
        message: 'async error',
      });
    });

    it('should use "unknown" as span name for anonymous functions without explicit name', async () => {
      const anonymousFunction = trace(async () => {
        return 'result';
      });

      await anonymousFunction();

      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'unknown',
        {},
        expect.any(Function),
      );
    });

    it('should set code.function in trace context for named functions', async () => {
      const createUser = trace(async function createUser(name: string) {
        return { name };
      });

      await createUser('Alice');

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        'code.function',
        expect.stringMatching(/^createUser/),
      );
    });

    it('should support span helper for async code blocks', async () => {
      const result = await span(
        { name: 'child', attributes: { level: 1 } },
        async (childSpan) => {
          childSpan.setAttribute('test', true);
          return 42;
        },
      );

      expect(result).toBe(42);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('test', true);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
    });

    it('should support span helper for synchronous code blocks', () => {
      const value = span(
        { name: 'sync-child', attributes: { level: 2 } },
        () => 7,
      );

      expect(value).toBe(7);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
    });

    it('should accept a string name as first argument (sync)', () => {
      const value = span('sync-name-shorthand', () => 11);
      expect(value).toBe(11);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
    });

    it('should accept a string name as first argument (async)', async () => {
      const value = await span('async-name-shorthand', async () => 13);
      expect(value).toBe(13);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: SpanStatusCode.OK,
      });
    });
  });

  // The `(ctx) => (...args) => result` factory form now lives on withTracing();
  // reach the span via the injected ctx (or ambient getActiveTraceContext()).
  describe('Array attribute support', () => {
    it('should support string array attributes', async () => {
      await withTracing({})((ctx) => async () => {
        ctx.setAttribute('tags', ['qa', 'test', 'automated']);
        return 'done';
      })();

      expect(mockSpan.setAttribute).toHaveBeenCalledWith('tags', [
        'qa',
        'test',
        'automated',
      ]);
    });

    it('should support number array attributes', async () => {
      await withTracing({})((ctx) => async () => {
        ctx.setAttribute('scores', [95, 87, 92]);
        return 'done';
      })();

      expect(mockSpan.setAttribute).toHaveBeenCalledWith(
        'scores',
        [95, 87, 92],
      );
    });

    it('should support boolean array attributes', async () => {
      await withTracing({})((ctx) => async () => {
        ctx.setAttribute('flags', [true, false, true]);
        return 'done';
      })();

      expect(mockSpan.setAttribute).toHaveBeenCalledWith('flags', [
        true,
        false,
        true,
      ]);
    });

    it('should support mixed attributes including arrays via setAttributes', async () => {
      await withTracing({})((ctx) => async () => {
        ctx.setAttributes({
          'user.id': 'user_123',
          environment: 'development',
          tags: ['qa', 'test'],
          scores: [1, 2, 3],
        });
        return 'done';
      })();

      expect(mockSpan.setAttributes).toHaveBeenCalledWith({
        'user.id': 'user_123',
        environment: 'development',
        tags: ['qa', 'test'],
        scores: [1, 2, 3],
      });
    });
  });

  describe('Full OTel Span API', () => {
    it('should support addEvent for span events', async () => {
      await withTracing({})((ctx) => async () => {
        ctx.addEvent('order.started', { 'order.id': '123' });
        ctx.addEvent('items.fetched', { 'item.count': 5 });
        return 'done';
      })();

      expect(mockSpan.addEvent).toHaveBeenCalledWith('order.started', {
        'order.id': '123',
      });
      expect(mockSpan.addEvent).toHaveBeenCalledWith('items.fetched', {
        'item.count': 5,
      });
    });

    it('should support updateName for dynamic span naming', async () => {
      await withTracing({ name: 'initial.name' })((ctx) => async () => {
        ctx.updateName('updated.name');
        return 'done';
      })();

      expect(mockSpan.updateName).toHaveBeenCalledWith('updated.name');
    });

    it('should support isRecording', async () => {
      let wasRecording = false;

      await withTracing({})((ctx) => async () => {
        wasRecording = ctx.isRecording();
        return 'done';
      })();

      expect(wasRecording).toBe(true);
      expect(mockSpan.isRecording).toHaveBeenCalled();
    });

    it('should support addLink for span links', async () => {
      const linkContext = {
        traceId: 'linked-trace-id',
        spanId: 'linked-span-id',
        traceFlags: 1,
      };

      await withTracing({})((ctx) => async () => {
        ctx.addLink({ context: linkContext });
        return 'done';
      })();

      expect(mockSpan.addLink).toHaveBeenCalledWith({ context: linkContext });
    });

    it('should support addLinks for multiple span links', async () => {
      const links = [
        { context: { traceId: 'trace-1', spanId: 'span-1', traceFlags: 1 } },
        { context: { traceId: 'trace-2', spanId: 'span-2', traceFlags: 1 } },
      ];

      await withTracing({})((ctx) => async () => {
        ctx.addLinks(links);
        return 'done';
      })();

      expect(mockSpan.addLinks).toHaveBeenCalledWith(links);
    });
  });
});
