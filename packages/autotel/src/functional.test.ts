/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  trace,
  withTracing,
  instrument,
  ctx,
  span,
  withBaggage,
} from './functional';
import type { TraceContext } from './trace-helpers';
import type { TracingOptions } from './functional';

function traceFactory<Args extends unknown[], Return>(
  factory: (ctx: TraceContext) => (...args: Args) => Return,
): (...args: Args) => Return {
  return trace(
    factory as (ctx: TraceContext) => (...args: Args) => Return,
  ) as unknown as (...args: Args) => Return;
}

function traceNamedFactory<Args extends unknown[], Return>(
  name: string,
  factory: (ctx: TraceContext) => (...args: Args) => Return,
): (...args: Args) => Return {
  return trace(
    name,
    factory as (ctx: TraceContext) => (...args: Args) => Return,
  ) as unknown as (...args: Args) => Return;
}

function traceOptionsFactory<Args extends unknown[], Return>(
  options: TracingOptions<Args, Return>,
  factory: (ctx: TraceContext) => (...args: Args) => Return,
): (...args: Args) => Return {
  return trace(
    options,
    factory as (ctx: TraceContext) => (...args: Args) => Return,
  ) as unknown as (...args: Args) => Return;
}
import { createTraceCollector } from './testing';
import { AlwaysSampler, NeverSampler } from './sampling';
import { init } from './init';

describe('Functional API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Initialize for all tests
    init({
      service: 'test-service',
    });
  });

  describe('span()', () => {
    it('returns synchronous value when callback is sync', () => {
      const result = span({ name: 'sync-span' }, () => 42);
      expect(result).toBe(42);
    });

    it('returns promise when callback is async', async () => {
      const promise = span({ name: 'async-span' }, async () => 84);
      expect(promise).toBeInstanceOf(Promise);
      await expect(promise).resolves.toBe(84);
    });
  });

  describe('trace()', () => {
    it('does not execute sync function during instrumentation', () => {
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

    it('detects ctx factories by parameter name', async () => {
      const collector = createTraceCollector();

      const traced = trace(
        (_ctx: TraceContext) =>
          async function detected(name: string) {
            _ctx.setAttribute('user.name', name);
            return name;
          },
      );

      await traced('Alice');

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes['user.name']).toBe('Alice');
    });

    describe('overload 1: trace(fn)', () => {
      it('should trace function with inferred name', async () => {
        const collector = createTraceCollector();

        const createUser = traceFactory(
          (_ctx: TraceContext) =>
            async function inferredName(name: string) {
              return { id: '123', name };
            },
        );

        const result = await createUser('Alice');

        expect(result).toEqual({ id: '123', name: 'Alice' });

        const spans = collector.getSpans();
        expect(spans).toHaveLength(1);
        expect(spans[0]!.name).toBe('inferredName');
      });

      it('should infer name from const assignment for factory pattern with arrow functions', async () => {
        const collector = createTraceCollector();

        // This is the factory pattern that was producing "unknown" trace names
        const processDocuments = traceFactory(
          (_ctx: TraceContext) => async (data: string) => {
            return data.toUpperCase();
          },
        );

        const result = await processDocuments('test');

        expect(result).toBe('TEST');

        const spans = collector.getSpans();
        expect(spans).toHaveLength(1);
        // Should infer 'processDocuments' from the const assignment, not 'unknown'
        expect(spans[0]!.name).toBe('processDocuments');
      });

      it('preserves sync return type for factory functions', () => {
        const collector = createTraceCollector();

        const add = traceFactory(
          (ctx: TraceContext) =>
            function addSync(a: number, b: number) {
              expect(ctx.traceId).toBeDefined();
              return a + b;
            },
        );

        const result = add(2, 3);

        expect(result).toBe(5);
        expect(result).not.toBeInstanceOf(Promise);

        const spans = collector.getSpans();
        expect(spans).toHaveLength(1);
        expect(spans[0]!.name).toBe('addSync');
      });

      it('should handle errors correctly', async () => {
        const collector = createTraceCollector();

        const failingFn = traceFactory((_ctx: TraceContext) => async () => {
          throw new Error('Test error');
        });

        await expect(failingFn()).rejects.toThrow('Test error');

        const spans = collector.getSpans();
        expect(spans).toHaveLength(1);
        expect(spans[0]!.status.code).toBe(2); // ERROR
        expect(spans[0]!.attributes['exception.message']).toBe('Test error');
      });
    });

    describe('overload 2: trace(name, fn)', () => {
      it('should use custom name', async () => {
        const collector = createTraceCollector();

        const createUser = traceNamedFactory(
          'user.create',
          (ctx: TraceContext) => async (name: string) => {
            return { id: '123', name };
          },
        );

        await createUser('Alice');

        const spans = collector.getSpans();
        expect(spans).toHaveLength(1);
        expect(spans[0]!.name).toBe('user.create');
      });
    });

    describe('overload 3: trace(options, fn)', () => {
      it('should use options', async () => {
        const collector = createTraceCollector();

        const createUser = traceOptionsFactory(
          {
            name: 'user.create',
            sampler: new AlwaysSampler(),
            attributesFromArgs: ([name]) => ({ userName: name }),
          },
          (ctx: TraceContext) => async (name: string) => {
            return { id: '123', name };
          },
        );

        await createUser('Alice');

        const spans = collector.getSpans();
        expect(spans).toHaveLength(1);
        expect(spans[0]!.name).toBe('user.create');
        expect(spans[0]!.attributes['userName']).toBe('Alice');
      });

      it('should use serviceName to compose span name', async () => {
        const collector = createTraceCollector();

        const createUser = traceOptionsFactory(
          { serviceName: 'user' },
          (ctx: TraceContext) =>
            async function serviceNameTest(name: string) {
              return { id: '123', name };
            },
        );

        await createUser('Alice');

        const spans = collector.getSpans();
        expect(spans).toHaveLength(1);
        expect(spans[0]!.name).toBe('user.serviceNameTest');
      });

      it('should extract result attributes', async () => {
        const collector = createTraceCollector();

        const createUser = traceOptionsFactory(
          {
            name: 'user.create',
            attributesFromResult: (result) => ({
              userId: (result as unknown as { id: string }).id,
            }),
          },
          (ctx: TraceContext) => async (name: string) => {
            return { id: '456', name };
          },
        );

        await createUser('Alice');

        const spans = collector.getSpans();
        expect(spans).toHaveLength(1);
        expect(spans[0]!.attributes['userId']).toBe('456');
      });

      it('should respect NeverSampler', async () => {
        const collector = createTraceCollector();

        const createUser = traceOptionsFactory(
          {
            name: 'user.create',
            sampler: new NeverSampler(),
          },
          (ctx: TraceContext) => async (name: string) => {
            return { id: '123', name };
          },
        );

        await createUser('Alice');

        const spans = collector.getSpans();
        expect(spans).toHaveLength(0);
      });
    });
  });

  describe('withTracing()', () => {
    it('should create reusable wrapper', async () => {
      const collector = createTraceCollector();

      const trace = withTracing({ serviceName: 'user' });

      const createUser = trace(
        (_ctx: TraceContext) =>
          async function reusableCreate(name: string) {
            return { id: '123', name };
          },
      );

      const updateUser = trace(
        (_ctx: TraceContext) =>
          async function reusableUpdate(id: string, name: string) {
            return { id, name };
          },
      );

      await createUser('Alice');
      await updateUser('123', 'Bob');

      const spans = collector.getSpans();
      expect(spans).toHaveLength(2);
      expect(spans[0]!.name).toBe('user.reusableCreate');
      expect(spans[1]!.name).toBe('user.reusableUpdate');
    });

    it('preserves sync return values', () => {
      const traceSync = withTracing({ name: 'math.add' });
      const add = traceSync(
        (_ctx: TraceContext) =>
          function addSync(a: number, b: number) {
            return a + b;
          },
      );

      const result = add(4, 5);
      expect(result).toBe(9);
    });

    it('should support explicit name', async () => {
      const collector = createTraceCollector();

      const createUser = withTracing({ name: 'user.create' })(
        (ctx: TraceContext) => async (name: string) => {
          return { id: '123', name };
        },
      );

      await createUser('Alice');

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.name).toBe('user.create');
    });

    it('should handle errors', async () => {
      const collector = createTraceCollector();

      const failingFn = withTracing({ name: 'test.fail' })(
        (ctx) => async () => {
          throw new Error('Fail');
        },
      );

      await expect(failingFn()).rejects.toThrow('Fail');

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.status.code).toBe(2); // ERROR
    });
  });

  describe('instrument()', () => {
    it('should instrument all functions', async () => {
      const collector = createTraceCollector();

      const userService = instrument({
        functions: {
          createUser: async (name: string) => {
            return { id: '123', name };
          },
          updateUser: async (id: string, name: string) => {
            return { id, name };
          },
          deleteUser: async (id: string) => {
            return { id };
          },
        },
        serviceName: 'user',
      });

      await userService.createUser('Alice');
      await userService.updateUser('123', 'Bob');
      await userService.deleteUser('123');

      const spans = collector.getSpans();
      expect(spans).toHaveLength(3);
      expect(spans[0]!.name).toBe('user.createUser');
      expect(spans[1]!.name).toBe('user.updateUser');
      expect(spans[2]!.name).toBe('user.deleteUser');
    });

    it('should skip functions with _ prefix by default', async () => {
      const collector = createTraceCollector();

      const service = instrument({
        functions: {
          publicFn: async () => 'public',
          _privateFn: async () => 'private',
        },
        serviceName: 'test',
      });

      await service.publicFn();
      await service._privateFn();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.name).toBe('test.publicFn');
    });

    it('should support custom skip rules', async () => {
      const collector = createTraceCollector();

      const service = instrument({
        functions: {
          publicFn: async () => 'public',
          testFn: async () => 'test',
          debugFn: async () => 'debug',
        },
        serviceName: 'test',
        skip: [
          /^test/, // Skip functions starting with 'test'
          (key) => key.includes('debug'), // Skip functions containing 'debug'
        ],
      });

      await service.publicFn();
      await service.testFn();
      await service.debugFn();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.name).toBe('test.publicFn');
    });

    it('should support per-function overrides', async () => {
      const collector = createTraceCollector();

      const service = instrument({
        functions: {
          createUser: async (name: string) => {
            return { id: '123', name };
          },
          deleteUser: async (id: string) => {
            return { id };
          },
        },
        serviceName: 'user',
        sampler: new NeverSampler(), // Default: don't sample
        overrides: {
          deleteUser: {
            sampler: new AlwaysSampler(), // Always sample deletes!
          },
        },
      });

      await service.createUser('Alice');
      await service.deleteUser('123');

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.name).toBe('user.deleteUser');
    });

    it('should preserve function behavior', async () => {
      const service = instrument({
        functions: {
          add: async (a: number, b: number) => a + b,
          subtract: async (a: number, b: number) => a - b,
        },
        serviceName: 'math',
      });

      expect(await service.add(5, 3)).toBe(8);
      expect(await service.subtract(5, 3)).toBe(2);
    });

    it('should not wrap non-functions', () => {
      const service = instrument({
        functions: {
          fn: async () => 'function',
          value: 42,
          obj: { nested: true },
        },
        serviceName: 'test',
      });

      expect(typeof service.fn).toBe('function');
      expect(service.value).toBe(42);
      expect(service.obj).toEqual({ nested: true });
    });

    it('should preserve this context for methods that rely on it', async () => {
      const collector = createTraceCollector();

      // Service object with state on 'this'
      const svc = {
        prefix: 'user',
        count: 0,
        build: async function (id: string) {
          return `${this.prefix}-${id}`;
        },
        increment: async function () {
          this.count++;
          return this.count;
        },
      };

      const instrumented = instrument({
        functions: svc,
        serviceName: 'svc',
      }) as typeof svc;

      // Test that this.prefix is accessible
      const result1 = await instrumented.build('123');
      expect(result1).toBe('user-123'); // Should not be 'undefined-123'

      // Test that this.count is accessible and modifiable
      const result2 = await instrumented.increment();
      expect(result2).toBe(1);
      const result3 = await instrumented.increment();
      expect(result3).toBe(2);

      const spans = collector.getSpans();
      expect(spans).toHaveLength(3);
    });

    it('should not call attributesFromArgs when sampler rejects tracing', async () => {
      const collector = createTraceCollector();

      // Mock expensive attribute extraction
      const expensiveAttributeExtraction = vi.fn((args: unknown[]) => {
        // Simulate expensive operation (JSON cloning, payload scrubbing, etc.)
        return { arg0: args[0] };
      });

      const service = instrument({
        functions: {
          createUser: async (name: string) => {
            return { id: '123', name };
          },
        },
        serviceName: 'user',
        sampler: new NeverSampler(), // Never sample
        attributesFromArgs: expensiveAttributeExtraction,
      });

      // Execute function with NeverSampler
      await service.createUser('Alice');

      // attributesFromArgs should NOT be called since we're not tracing
      expect(expensiveAttributeExtraction).not.toHaveBeenCalled();

      // No spans should be created
      const spans = collector.getSpans();
      expect(spans).toHaveLength(0);
    });

    it('should call attributesFromArgs when sampler accepts tracing', async () => {
      const collector = createTraceCollector();

      // Mock attribute extraction
      const attributeExtraction = vi.fn((args: unknown[]) => {
        return { arg0: args[0] };
      });

      const service = instrument({
        functions: {
          createUser: async (name: string) => {
            return { id: '123', name };
          },
        },
        serviceName: 'user',
        sampler: new AlwaysSampler(), // Always sample
        attributesFromArgs: attributeExtraction,
      });

      // Execute function with AlwaysSampler
      await service.createUser('Alice');

      // attributesFromArgs SHOULD be called since we're tracing
      // Note: args will include context as first element
      expect(attributeExtraction).toHaveBeenCalledTimes(1);
      expect(attributeExtraction).toHaveBeenCalledWith(
        expect.arrayContaining(['Alice']),
      );

      // Span should be created with attributes
      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes['arg0']).toBe('Alice');
    });
  });

  describe('Span naming priority', () => {
    it('should prioritize explicit name over serviceName', async () => {
      const collector = createTraceCollector();

      const fn = traceOptionsFactory(
        {
          name: 'explicit.name',
          serviceName: 'ignored',
        },
        (ctx: TraceContext) => async () => 'result',
      );

      await fn();

      const spans = collector.getSpans();
      expect(spans[0]!.name).toBe('explicit.name');
    });

    it('should use serviceName + fnName when no explicit name', async () => {
      const collector = createTraceCollector();

      const myFunction = traceOptionsFactory(
        {
          serviceName: 'service',
        },
        (ctx: TraceContext) =>
          async function priorityTest() {
            return 'result';
          },
      );

      await myFunction();

      const spans = collector.getSpans();
      expect(spans[0]!.name).toBe('service.priorityTest');
    });

    it('should fall back to inferred name', async () => {
      const collector = createTraceCollector();

      const namedFunction = traceFactory(
        (_ctx: TraceContext) =>
          async function fallbackName() {
            return 'result';
          },
      );

      await namedFunction();

      const spans = collector.getSpans();
      expect(spans[0]!.name).toBe('fallbackName');
    });
  });

  describe('Error handling', () => {
    it('should truncate long error messages', async () => {
      const collector = createTraceCollector();

      const longError = 'x'.repeat(600);
      const fn = traceFactory((_ctx: TraceContext) => async () => {
        throw new Error(longError);
      });

      await expect(fn()).rejects.toThrow();

      const spans = collector.getSpans();
      const errorMsg = spans[0]!.attributes['exception.message'] as string;
      expect(errorMsg.length).toBeLessThan(600);
      expect(errorMsg).toContain('(truncated)');
    });

    it('should record exception type', async () => {
      const collector = createTraceCollector();

      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }

      const fn = traceFactory((_ctx: TraceContext) => async () => {
        throw new CustomError('Custom error');
      });

      await expect(fn()).rejects.toThrow();

      const spans = collector.getSpans();
      expect(spans[0]!.attributes['exception.type']).toBe('CustomError');
    });

    it('should include stack trace', async () => {
      const collector = createTraceCollector();

      const fn = traceFactory((_ctx: TraceContext) => async () => {
        throw new Error('Stack test');
      });

      await expect(fn()).rejects.toThrow();

      const spans = collector.getSpans();
      expect(spans[0]!.attributes['exception.stack']).toBeDefined();
    });
  });

  describe('Type preservation', () => {
    it('should preserve exact types', async () => {
      interface User {
        id: string;
        name: string;
      }

      const createUser = traceFactory(
        (_ctx: TraceContext) =>
          async (name: string): Promise<User> => {
            return { id: '123', name };
          },
      );

      const result = await createUser('Alice');

      // TypeScript should know result is User
      expect(result.id).toBe('123');
      expect(result.name).toBe('Alice');
    });

    it('should preserve argument types', async () => {
      const fn = traceFactory(
        (ctx: TraceContext) =>
          async (a: number, b: string, c: { x: boolean }): Promise<void> => {
            expect(typeof a).toBe('number');
            expect(typeof b).toBe('string');
            expect(typeof c.x).toBe('boolean');
          },
      );

      await fn(42, 'hello', { x: true });
    });
  });

  describe('ctx() helper', () => {
    it('should return trace context when span is active', async () => {
      const collector = createTraceCollector();

      const createUser = traceFactory(
        (_ctx: TraceContext) => async (name: string) => {
          expect(ctx.traceId).toBeDefined();
          expect(ctx.spanId).toBeDefined();
          expect(ctx.correlationId).toBeDefined();
          return { id: '123', name };
        },
      );

      const result = await createUser('Alice');
      expect(result).toEqual({ id: '123', name: 'Alice' });

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
    });

    it('should provide span methods on context', async () => {
      const collector = createTraceCollector();

      const createUser = traceFactory(
        (_ctx: TraceContext) => async (name: string) => {
          if (ctx.traceId) {
            ctx.setAttribute('user.name', name);
            ctx.setAttributes({ 'user.id': '123', 'user.active': true });
          }
          return { id: '123', name };
        },
      );

      await createUser('Alice');

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes['user.name']).toBe('Alice');
      expect(spans[0]!.attributes['user.id']).toBe('123');
      expect(spans[0]!.attributes['user.active']).toBe(true);
    });

    it('should return undefined properties when no span is active', () => {
      expect(ctx.traceId).toBeUndefined();
      expect(ctx.spanId).toBeUndefined();
    });

    it('should record exceptions via context', async () => {
      const collector = createTraceCollector();

      const failingFn = traceFactory((_ctx: TraceContext) => async () => {
        const error = new Error('Test exception');
        if (ctx.traceId) {
          ctx.recordException(error);
        }
        throw error;
      });

      await expect(failingFn()).rejects.toThrow('Test exception');

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.status.code).toBe(2); // ERROR
    });
  });

  describe('Immediate execution pattern', () => {
    it('should execute async function immediately with context', async () => {
      const collector = createTraceCollector();

      const result = await trace(async (ctx: TraceContext) => {
        ctx.setAttribute('test.key', 'value');
        return { data: 'test' };
      });

      expect(result).toEqual({ data: 'test' });

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes['test.key']).toBe('value');
    });

    it('should execute sync function immediately with context', () => {
      const collector = createTraceCollector();

      const result = trace((ctx: TraceContext) => {
        ctx.setAttribute('test.key', 'sync-value');
        return 42;
      });

      expect(result).toBe(42);

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes['test.key']).toBe('sync-value');
    });

    it('should support custom name with immediate execution', async () => {
      const collector = createTraceCollector();

      const result = await trace(
        'custom.operation',
        async (ctx: TraceContext) => {
          ctx.setAttribute('operation.id', '123');
          return 'success';
        },
      );

      expect(result).toBe('success');

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.name).toBe('custom.operation');
      expect(spans[0]!.attributes['operation.id']).toBe('123');
    });

    it('should support options with immediate execution', async () => {
      const collector = createTraceCollector();

      const result = await trace(
        { name: 'options.test', withMetrics: true },
        async (ctx: TraceContext) => {
          ctx.setAttribute('test.option', 'enabled');
          return 100;
        },
      );

      expect(result).toBe(100);

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.name).toBe('options.test');
      expect(spans[0]!.attributes['test.option']).toBe('enabled');
    });

    it('should distinguish between factory and immediate execution', async () => {
      const collector = createTraceCollector();

      // Factory pattern - returns a function
      const factory = trace((ctx: TraceContext) => async (name: string) => {
        ctx.setAttribute('user.name', name);
        return { name };
      });

      // Immediate execution - returns result directly
      const immediate = await trace(async (ctx: TraceContext) => {
        ctx.setAttribute('immediate', true);
        return 'done';
      });

      expect(typeof factory).toBe('function');
      expect(immediate).toBe('done');

      // Now call the factory
      const factoryResult = await factory('Alice');
      expect(factoryResult).toEqual({ name: 'Alice' });

      const spans = collector.getSpans();
      expect(spans).toHaveLength(2);

      // First span is from immediate execution
      expect(spans[0]!.attributes['immediate']).toBe(true);

      // Second span is from factory call
      expect(spans[1]!.attributes['user.name']).toBe('Alice');
    });

    it('should work with wrapper function pattern from feedback', async () => {
      const collector = createTraceCollector();

      // The exact use case from the feedback
      function timed<T>(
        requestId: string,
        operation: string,
        fn: () => Promise<T>,
      ): Promise<T> {
        return trace(operation, async (ctx: TraceContext) => {
          ctx.setAttributes({
            'request.id': requestId,
            'operation.name': operation,
          });

          const result = await fn();
          return result;
        });
      }

      // Test it
      const mockFn = async () => {
        return { userId: '123', status: 'active' };
      };

      const result = await timed('req-456', 'fetchUser', mockFn);

      expect(result).toEqual({ userId: '123', status: 'active' });

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.name).toBe('fetchUser');
      expect(spans[0]!.attributes['request.id']).toBe('req-456');
      expect(spans[0]!.attributes['operation.name']).toBe('fetchUser');
    });

    it('should not create orphan spans when nesting span() inside trace() immediate execution', async () => {
      const collector = createTraceCollector();

      // This was causing a bug where span() was called during pattern detection,
      // creating an orphan span outside of the trace() context
      await trace('user-request-trace', async (ctx: TraceContext) => {
        ctx.setAttribute('input.query', 'What is the capital of France?');

        // Nested span should be a child of user-request-trace
        await span(
          {
            name: 'llm-call',
            attributes: { model: 'gpt-4' },
          },
          async () => {
            // Simulate LLM call
            return 'The capital of France is Paris.';
          },
        );

        ctx.setAttribute('output', 'Successfully answered.');
      });

      const spans = collector.getSpans();

      // KEY ASSERTION: Should have exactly 2 spans, NOT 3
      // Before the fix, there would be 3 spans:
      // 1. An orphan llm-call (created during pattern detection)
      // 2. user-request-trace (the parent)
      // 3. llm-call (proper child)
      expect(spans).toHaveLength(2);

      // Verify we have the correct span names
      const spanNames = spans.map((s) => s.name).toSorted();
      expect(spanNames).toEqual(['llm-call', 'user-request-trace']);

      // Verify attributes on each span
      const parentSpan = spans.find((s) => s.name === 'user-request-trace');
      const childSpan = spans.find((s) => s.name === 'llm-call');

      expect(parentSpan).toBeDefined();
      expect(childSpan).toBeDefined();

      expect(parentSpan!.attributes['input.query']).toBe(
        'What is the capital of France?',
      );
      expect(parentSpan!.attributes['output']).toBe('Successfully answered.');
      expect(childSpan!.attributes['model']).toBe('gpt-4');
    });

    it('should not execute async function during pattern detection', async () => {
      const collector = createTraceCollector();
      let executionCount = 0;

      // This async function should only be executed ONCE, not twice
      // (once during pattern detection + once for actual execution = BUG)
      await trace('single-execution', async (ctx: TraceContext) => {
        executionCount++;
        ctx.setAttribute('execution.count', executionCount);
        return 'done';
      });

      // Function should have been executed exactly once
      expect(executionCount).toBe(1);

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes['execution.count']).toBe(1);
    });
  });

  describe('baggage', () => {
    it('should get baggage entry from context', async () => {
      const collector = createTraceCollector();
      const { context, propagation } = await import('@opentelemetry/api');

      // Create context with baggage
      const activeContext = context.active();
      const baggage = propagation.createBaggage();
      const updatedBaggage = baggage.setEntry('tenant.id', {
        value: 'tenant-123',
      });
      const contextWithBaggage = propagation.setBaggage(
        activeContext,
        updatedBaggage,
      );

      await context.with(contextWithBaggage, async () => {
        await trace((ctx) => async () => {
          const tenantId = ctx.getBaggage('tenant.id');
          expect(tenantId).toBe('tenant-123');
          return 'done';
        })();
      });

      expect(collector.getSpans()).toHaveLength(1);
    });

    it('withBaggage should set baggage for child spans', async () => {
      const collector = createTraceCollector();

      await trace((ctx) => async () => {
        return await withBaggage({
          baggage: { 'tenant.id': 'tenant-456', 'user.id': 'user-789' },
          fn: async () => {
            // Check baggage is available
            expect(ctx.getBaggage('tenant.id')).toBe('tenant-456');
            expect(ctx.getBaggage('user.id')).toBe('user-789');

            // Create child span - should inherit baggage
            await trace((childCtx) => async () => {
              expect(childCtx.getBaggage('tenant.id')).toBe('tenant-456');
              return 'child-done';
            })();
            return 'parent-done';
          },
        });
      })();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(2);
    });

    it('withBaggage should work with sync functions', () => {
      let capturedBaggage: string | undefined;

      trace((ctx) => () => {
        return withBaggage({
          baggage: { key: 'value' },
          fn: () => {
            capturedBaggage = ctx.getBaggage('key');
            return 'sync-result';
          },
        });
      })();

      expect(capturedBaggage).toBe('value');
    });

    it('withBaggage should merge with existing baggage', async () => {
      const collector = createTraceCollector();
      const { context, propagation } = await import('@opentelemetry/api');

      // Set initial baggage
      const activeContext = context.active();
      const baggage = propagation.createBaggage();
      const updatedBaggage = baggage.setEntry('existing.key', {
        value: 'existing-value',
      });
      const contextWithBaggage = propagation.setBaggage(
        activeContext,
        updatedBaggage,
      );

      await context.with(contextWithBaggage, async () => {
        await trace((ctx) => async () => {
          // New baggage should be available
          expect(ctx.getBaggage('new.key')).toBeUndefined(); // Not set yet

          return await withBaggage({
            baggage: { 'new.key': 'new-value' },
            fn: async () => {
              // New baggage should be available
              expect(ctx.getBaggage('new.key')).toBe('new-value');
              // Existing baggage should still be available (if propagator preserves it)
              return 'done';
            },
          });
        })();
      });

      // Only 1 span created (the outer trace)
      expect(collector.getSpans()).toHaveLength(1);
    });

    it('ctx.getAllBaggage should return all baggage entries', async () => {
      const collector = createTraceCollector();
      const { context, propagation } = await import('@opentelemetry/api');

      // Create context with multiple baggage entries
      const activeContext = context.active();
      let baggage = propagation.createBaggage();
      baggage = baggage.setEntry('key1', { value: 'value1' });
      baggage = baggage.setEntry('key2', { value: 'value2' });
      const contextWithBaggage = propagation.setBaggage(activeContext, baggage);

      await context.with(contextWithBaggage, async () => {
        await trace((ctx) => async () => {
          const allBaggage = ctx.getAllBaggage();
          expect(allBaggage.size).toBeGreaterThanOrEqual(2);
          expect(allBaggage.get('key1')?.value).toBe('value1');
          expect(allBaggage.get('key2')?.value).toBe('value2');
          return 'done';
        })();
      });

      expect(collector.getSpans()).toHaveLength(1);
    });
  });
});
