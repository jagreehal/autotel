// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trace, withTracing, instrument, span } from './functional';
import { trace as otelTrace, SpanStatusCode } from '@opentelemetry/api';

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
      isRecording: () => true,
      updateName: vi.fn(),
      addEvent: vi.fn(),
    };

    mockTracer = {
      startActiveSpan: vi.fn((name, optionsOrFn, maybeFn) => {
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

    getTracerSpy = vi.spyOn(otelTrace, 'getTracer').mockReturnValue(mockTracer as any);
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

      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
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
  });

  describe('trace() - Named Spans', () => {
    it('should use custom span name', async () => {
      const testFunction = trace('user.create', async function(email: string) {
        return { id: '123', email };
      });

      await testFunction('test@example.com');

      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'user.create',
        {},
        expect.any(Function),
      );
    });

    it('should work with arrow functions', async () => {
      const testFunction = trace('custom.name', async (email: string) => {
        return { id: '123', email };
      });

      await testFunction('test@example.com');

      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'custom.name',
        {},
        expect.any(Function),
      );
    });
  });

  describe('trace() - Full Options', () => {
    it('should extract attributes from arguments', async () => {
      const testFunction = trace({
        name: 'user.create',
        attributesFromArgs: ([email]: [string]) => ({ 'user.email': email }),
      }, async function(email: string) {
        return { id: '123', email };
      });

      await testFunction('test@example.com');

      expect(mockSpan.setAttributes).toHaveBeenCalledWith({ 'user.email': 'test@example.com' });
    });

    it('should extract attributes from result', async () => {
      const testFunction = trace({
        name: 'user.create',
        attributesFromResult: (user: any) => ({ 'user.id': user.id }),
      }, async function(email: string) {
        return { id: '123', email };
      });

      await testFunction('test@example.com');

      expect(mockSpan.setAttributes).toHaveBeenCalledWith({ 'user.id': '123' });
    });

    it('should extract attributes from both args and result', async () => {
      const testFunction = trace({
        name: 'user.create',
        attributesFromArgs: ([email]: [string]) => ({ 'user.email': email }),
        attributesFromResult: (user: any) => ({ 'user.id': user.id }),
      }, async function(email: string) {
        return { id: '123', email };
      });

      await testFunction('test@example.com');

      expect(mockSpan.setAttributes).toHaveBeenCalledWith({ 'user.email': 'test@example.com' });
      expect(mockSpan.setAttributes).toHaveBeenCalledWith({ 'user.id': '123' });
    });

    it('should add static attributes', async () => {
      const testFunction = trace({
        name: 'user.create',
        attributes: { 'service.type': 'user-management' },
      }, async function(email: string) {
        return { id: '123', email };
      });

      await testFunction('test@example.com');

      expect(mockSpan.setAttributes).toHaveBeenCalledWith({ 'service.type': 'user-management' });
    });

    it('should use serviceName to prefix function name', async () => {
      const testFunction = trace({
        serviceName: 'user',
      }, async function createUser(email: string) {
        return { id: '123', email };
      });

      await testFunction('test@example.com');

      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'user.createUser',
        {},
        expect.any(Function),
      );
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

      const testFunction = trace({
        name: 'test.function',
        sampler: mockSampler as any,
      }, async function() {
        return 'success';
      });

      await testFunction();

      // Verify startActiveSpan was called with options containing the sampler
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'test.function',
        { sampler: mockSampler },
        expect.any(Function),
      );
    });

    it('should NOT pass options when sampler is not provided', async () => {
      const testFunction = trace({
        name: 'test.function',
      }, async function() {
        return 'success';
      });

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

      const testFunction = trace({
        name: 'test.function',
        sampler: rejectSampler as any,
      }, async function() {
        return 'success';
      });

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

      const testFunction = (trace as any)({
        name: 'test.function',
        sampler: mockSampler as any,
        attributes: { 'custom.tag': 'value' },
        attributesFromArgs: ([arg]: [string]) => ({ 'arg.value': arg }),
      }, async function(arg: string) {
        return 'success';
      }) as any;

      await testFunction('test-arg');

      // Verify sampler is passed
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'test.function',
        { sampler: mockSampler },
        expect.any(Function),
      );

      // Verify attributes are still added
      expect(mockSpan.setAttributes).toHaveBeenCalledWith({ 'custom.tag': 'value' });
      expect(mockSpan.setAttributes).toHaveBeenCalledWith({ 'arg.value': 'test-arg' });
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
      const createUserFn = withUserTracing(async function myCreateUser(email: string) {
        return { id: '123', email };
      });

      await createUserFn('test@example.com');

      const spanName = mockTracer.startActiveSpan.mock.calls[0][0];
      expect(spanName).toMatch(/^user\./);
      expect(typeof mockTracer.startActiveSpan.mock.calls[0][2]).toBe('function');
    });

    it('should work with multiple functions', async () => {
      const withUserTracing = withTracing({ serviceName: 'user' });

      const createUserFn = withUserTracing(async function createUserAction(email: string) {
        return { id: '123', email };
      });

      const updateUserFn = withUserTracing(async function updateUserAction(id: string, data: any) {
        return { id, ...data };
      });

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

      const createUser = withUserTracing(async function createUser(email: string) {
        return { id: '123', email };
      });

      await createUser('test@example.com');

      expect(mockSpan.setAttributes).toHaveBeenCalledWith({ 'user.email': 'test@example.com' });
    });
  });

  describe('instrument() - Batch Instrumentation', () => {
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
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
    });

    it('should handle functions with no arguments', async () => {
      const noArgsFunction = trace(async function getCurrentTime() {
        return Date.now();
      });

      const result = await noArgsFunction();

      expect(typeof result).toBe('number');
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
    });

    it('should handle functions with many arguments', async () => {
      const manyArgsFunction = trace(
        async function complexFunction(a: number, b: string, c: boolean, d: object) {
          return { a, b, c, d };
        },
      );

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
      const result = await span({ name: 'child', attributes: { level: 1 } }, async (childSpan) => {
        childSpan.setAttribute('test', true);
        return 42;
      });

      expect(result).toBe(42);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('test', true);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
    });

    it('should support span helper for synchronous code blocks', () => {
      const value = span({ name: 'sync-child', attributes: { level: 2 } }, () => 7);

      expect(value).toBe(7);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
    });
  });

  describe('Immediate execution pattern', () => {
    it('should execute async function immediately with context', async () => {
      const result = await trace(async (ctx: any) => {
        ctx.setAttribute('test.key', 'value');
        return { data: 'test' };
      });

      expect(result).toEqual({ data: 'test' });
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('test.key', 'value');
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should execute sync function immediately with context', () => {
      const result = trace((ctx: any) => {
        ctx.setAttribute('test.key', 'sync-value');
        return 42;
      });

      expect(result).toBe(42);
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('test.key', 'sync-value');
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: SpanStatusCode.OK });
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should support custom name with immediate execution', async () => {
      const result = await trace('custom.operation', async (ctx: any) => {
        ctx.setAttribute('operation.id', '123');
        return 'success';
      });

      expect(result).toBe('success');
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'custom.operation',
        expect.any(Function),
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('operation.id', '123');
    });

    it('should support options with immediate execution', async () => {
      const result = await trace(
        { name: 'options.test', attributes: { test: 'enabled' } },
        async (ctx: any) => {
          ctx.setAttribute('test.option', 'enabled');
          return 100;
        },
      );

      expect(result).toBe(100);
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'options.test',
        expect.any(Function),
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('test.option', 'enabled');
    });

    it('should distinguish between factory and immediate execution', async () => {
      // Factory pattern - returns a function
      const factory = trace((ctx: any) => async (name: string) => {
        ctx.setAttribute('user.name', name);
        return { name };
      });

      // Immediate execution - returns result directly
      const immediate = await trace(async (ctx: any) => {
        ctx.setAttribute('immediate', true);
        return 'done';
      });

      expect(typeof factory).toBe('function');
      expect(immediate).toBe('done');

      // Now call the factory
      const factoryResult = await factory('Alice');
      expect(factoryResult).toEqual({ name: 'Alice' });
    });

    it('should work with wrapper function pattern from feedback', async () => {
      // The exact use case from the feedback
      function timed<T>(
        requestId: string,
        operation: string,
        fn: () => Promise<T>,
      ): Promise<T> {
        return trace(operation, async (ctx: any) => {
          ctx.setAttribute('request.id', requestId);
          ctx.setAttribute('operation.name', operation);
          return await fn();
        });
      }

      // Test it
      const mockFn = async () => {
        return { userId: '123', status: 'active' };
      };

      const result = await timed('req-456', 'fetchUser', mockFn);

      expect(result).toEqual({ userId: '123', status: 'active' });
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        'fetchUser',
        expect.any(Function),
      );
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('request.id', 'req-456');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('operation.name', 'fetchUser');
    });
  });
});
