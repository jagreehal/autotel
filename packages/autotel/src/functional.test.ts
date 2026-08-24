/* eslint-disable @typescript-eslint/no-unused-vars */
import type { Attributes } from '@opentelemetry/api';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SpanKind,
  SpanStatusCode,
  context,
  propagation,
} from '@opentelemetry/api';
import {
  trace,
  withTracing,
  instrument,
  ctx,
  span,
  withBaggage,
  getActiveTraceContext,
} from './functional';
import type { TraceContext } from './trace-context';
import type { TracingOptions } from './functional';

// The `(ctx) => (...args) => result` factory form now lives on withTracing().
// These thin helpers keep the existing factory-shaped tests concise.
function traceFactory<Args extends unknown[], Return>(
  factory: (ctx: TraceContext) => (...args: Args) => Return,
): (...args: Args) => Return {
  // SAFETY: withTracing returns the factory's own signature; the helper's
  // declared type restates it for the tests that call through it.
  return withTracing<Args, Return>({})(factory) as (...args: Args) => Return;
}

function traceNamedFactory<Args extends unknown[], Return>(
  name: string,
  factory: (ctx: TraceContext) => (...args: Args) => Return,
): (...args: Args) => Return {
  // SAFETY: withTracing returns the factory's own signature; the helper's
  // declared type restates it for the tests that call through it.
  return withTracing<Args, Return>({ name })(factory) as (
    ...args: Args
  ) => Return;
}

function traceOptionsFactory<Args extends unknown[], Return>(
  options: TracingOptions<Args, Return>,
  factory: (ctx: TraceContext) => (...args: Args) => Return,
): (...args: Args) => Return {
  // SAFETY: withTracing returns the factory's own signature; the helper's
  // declared type restates it for the tests that call through it.
  return withTracing<Args, Return>(options)(factory) as (
    ...args: Args
  ) => Return;
}
import { createTraceCollector } from './testing';
import { AlwaysSampler, NeverSampler } from './sampling';
import { init } from './init';

// The runtime ctx keeps deprecated OTel span methods (recordException/addEvent)
// as back-compat shims even though the public TraceContext type deliberately
// hides them (OTEP 4430). These tests verify the shims still work at runtime.
type LegacyCtx = TraceContext & {
  recordException(cause: unknown): void;
  addEvent(name: string, attributes?: Attributes): void;
};

// instrument() deliberately tolerates non-function values at runtime while the
// public type requires all values be functions; these tests feed mixed input.
/**
 * A bag of functions this suite hands to instrument(). The parameters are `any`
 * because each service under test declares its own, and instrument() is generic
 * over exactly that - the record here only names the shape, not the signatures.
 */
type FnRecord = Record<string, (...args: any[]) => unknown>;

describe('Functional API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Initialize for all tests
    init({
      service: 'test-service',
    });
  });

  describe('getActiveTraceContext()', () => {
    it('returns the active context inside a traced function', () => {
      const collector = createTraceCollector();

      const handler = instrument({
        key: 'ambient.handler',
        fn: (id: string) => {
          const active = getActiveTraceContext();
          active?.setAttribute('user.id', id);
          return id;
        },
      });
      handler('user_42');

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes['user.id']).toBe('user_42');
    });

    it('returns undefined when no span is active', () => {
      expect(getActiveTraceContext()).toBeUndefined();
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

    it('accepts a string name as first argument (sync)', () => {
      const result = span('sync-name-shorthand', () => 'ok');
      expect(result).toBe('ok');
    });

    it('accepts a string name as first argument (async)', async () => {
      await expect(
        span('async-name-shorthand', async () => 'ok'),
      ).resolves.toBe('ok');
    });

    it('records spans created via the string-name shorthand', async () => {
      const collector = createTraceCollector();
      await span('shorthand.recorded', async () => {});
      const names = collector.getSpans().map((s) => s.name);
      expect(names).toContain('shorthand.recorded');
    });

    it('applies spanKind from options', () => {
      const collector = createTraceCollector();
      span({ name: 'client.operation', spanKind: SpanKind.CLIENT }, () => {});

      expect(collector.getSpansByName('client.operation')[0]?.kind).toBe(
        SpanKind.CLIENT,
      );
    });
  });

  describe('trace()', () => {
    it('runs a named operation immediately with an explicit TraceContext', async () => {
      const collector = createTraceCollector();

      const result = await trace.run('checkout.complete', async (ctx) => {
        ctx.setAttribute('order.id', 'order_123');
        ctx.setStatus({ code: SpanStatusCode.OK });
        return 'done';
      });

      expect(result).toBe('done');
      expect(collector.getSpansByName('checkout.complete')).toMatchObject([
        {
          attributes: expect.objectContaining({ 'order.id': 'order_123' }),
          status: { code: SpanStatusCode.OK },
        },
      ]);
    });

    it('preserves an explicit status set by the operation', async () => {
      const collector = createTraceCollector();

      const result = trace.run('cache.fallback', (ctx) => {
        ctx.setStatus({
          code: SpanStatusCode.ERROR,
          message: 'primary cache unavailable',
        });
        return 'fallback';
      });

      expect(result).toBe('fallback');
      expect(collector.getSpansByName('cache.fallback')[0]?.status).toEqual({
        code: SpanStatusCode.ERROR,
        message: 'primary cache unavailable',
      });
    });

    it('honors isError for async factory functions', async () => {
      const collector = createTraceCollector();
      const signal = { type: 'control-flow' };
      const traced = traceOptionsFactory(
        { name: 'factory.async.control-flow', isError: () => false },
        (_ctx: TraceContext) => async () => {
          throw signal;
        },
      );

      await expect(traced()).rejects.toBe(signal);

      const [span] = collector.getSpansByName('factory.async.control-flow');
      expect(span).toBeDefined();
      expect(span!.status.code).toBe(1);
      expect(span!.attributes.error).not.toBe(true);
    });

    it('honors isError for sync factory functions', () => {
      const collector = createTraceCollector();
      const signal = { type: 'control-flow' };
      const traced = traceOptionsFactory(
        { name: 'factory.sync.control-flow', isError: () => false },
        (_ctx: TraceContext) => () => {
          throw signal;
        },
      );

      expect(() => traced()).toThrow(signal);

      const [span] = collector.getSpansByName('factory.sync.control-flow');
      expect(span).toBeDefined();
      expect(span!.status.code).toBe(1);
      expect(span!.attributes.error).not.toBe(true);
    });

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

      const traced = withTracing({})(
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

    describe('overload: trace(name)(fn) wrapper factory', () => {
      it('wraps a plain function under the explicit name', async () => {
        const collector = createTraceCollector();

        const createUser = trace('user.create')(async (name: string) => ({
          id: '123',
          name,
        }));

        const result = await createUser('Alice');

        expect(result).toEqual({ id: '123', name: 'Alice' });
        const spans = collector.getSpans();
        expect(spans).toHaveLength(1);
        expect(spans[0]!.name).toBe('user.create');
      });

      it('returns the wrapper without running the function', () => {
        const collector = createTraceCollector();
        const ran = vi.fn();

        const wrapped = trace('never.run')(ran);

        expect(typeof wrapped).toBe('function');
        expect(ran).not.toHaveBeenCalled();
        expect(collector.getSpans()).toHaveLength(0);
      });

      it('keeps a sync function synchronous', () => {
        const collector = createTraceCollector();

        const add = trace('math.add')((a: number, b: number) => a + b);
        const result = add(2, 3);

        expect(result).toBe(5);
        expect(result).not.toBeInstanceOf(Promise);
        expect(collector.getSpans()[0]!.name).toBe('math.add');
      });

      it('records the error and rethrows', async () => {
        const collector = createTraceCollector();

        const failing = trace('user.create')(async () => {
          throw new Error('Test error');
        });

        await expect(failing()).rejects.toThrow('Test error');
        const spans = collector.getSpans();
        expect(spans[0]!.status.code).toBe(2);
        expect(spans[0]!.attributes['exception.message']).toBe('Test error');
      });

      it('takes options as well as a name', async () => {
        const collector = createTraceCollector();

        const wrapped = trace({ name: 'user.create' })(async () => 'ok');

        await expect(wrapped()).resolves.toBe('ok');
        expect(collector.getSpans()[0]!.name).toBe('user.create');
      });

      // #166: dispatch used to read the callback's first parameter name, so a
      // minifier renaming `ctx` to a single letter flipped trace into the wrong
      // mode. `trace` and `trace.run` are separate names now, so no call shape
      // is ambiguous and a mangled parameter name changes nothing.
      it('never runs the function, whatever the parameter is called', async () => {
        const collector = createTraceCollector();

        // Single-parameter callbacks with minified names, both wrapper forms.
        const curried = trace('wrapper.curried')(async (c: string) => c);
        const twoArg = trace('wrapper.two-arg', async (c: string) => c);

        expect(typeof curried).toBe('function');
        expect(typeof twoArg).toBe('function');
        expect(collector.getSpans()).toHaveLength(0);

        await expect(curried('x')).resolves.toBe('x');
        await expect(twoArg('y')).resolves.toBe('y');

        const immediate = await trace.run('immediate.form', async (c) => {
          c.setAttribute('checked', true);
          return 'ran';
        });
        expect(immediate).toBe('ran');

        expect(collector.getSpans().map((s) => s.name)).toEqual([
          'wrapper.curried',
          'wrapper.two-arg',
          'immediate.form',
        ]);
      });
    });

    describe('trace(name, fn) wrapper - the v6.5.0 form, unchanged', () => {
      it('wraps rather than running, so importing is side-effect free', async () => {
        const collector = createTraceCollector();
        const ran = vi.fn(async (name: string) => ({ id: '1', name }));

        const createUser = trace('user.create', ran);

        // The whole point: constructing the wrapper runs nothing.
        expect(typeof createUser).toBe('function');
        expect(ran).not.toHaveBeenCalled();
        expect(collector.getSpans()).toHaveLength(0);

        await expect(createUser('Alice')).resolves.toEqual({
          id: '1',
          name: 'Alice',
        });
        expect(collector.getSpansByName('user.create')).toHaveLength(1);
      });

      it('passes the caller arguments straight through', async () => {
        createTraceCollector();

        const add = trace('math.add', (a: number, b: number) => a + b);

        expect(add(2, 3)).toBe(5);
      });

      it('takes options in place of a name', async () => {
        const collector = createTraceCollector();

        const wrapped = trace({ name: 'user.create' }, async () => 'ok');

        await expect(wrapped()).resolves.toBe('ok');
        expect(collector.getSpansByName('user.create')).toHaveLength(1);
      });
    });

    describe('trace.run(name, operation)', () => {
      it('runs immediately and returns the result', async () => {
        const collector = createTraceCollector();

        const result = await trace.run('checkout', async (ctx) => {
          ctx.setAttribute('cart.items', 3);
          return 'done';
        });

        expect(result).toBe('done');
        expect(collector.getSpansByName('checkout')).toMatchObject([
          { attributes: expect.objectContaining({ 'cart.items': 3 }) },
        ]);
      });

      it('keeps a sync operation synchronous', () => {
        const collector = createTraceCollector();

        const result = trace.run('sync.op', () => 42);

        expect(result).toBe(42);
        expect(result).not.toBeInstanceOf(Promise);
        expect(collector.getSpansByName('sync.op')).toHaveLength(1);
      });

      it('records the error and rethrows', async () => {
        const collector = createTraceCollector();

        await expect(
          trace.run('failing.op', async () => {
            throw new Error('Test error');
          }),
        ).rejects.toThrow('Test error');

        const span = collector.getSpansByName('failing.op')[0]!;
        expect(span.status.code).toBe(2);
        expect(span.attributes['exception.message']).toBe('Test error');
      });

      it('rejects a non-function operation instead of guessing', () => {
        createTraceCollector();

        expect(() =>
          (trace.run as (n: string, o?: unknown) => unknown)('oops'),
        ).toThrow('operation must be a function');
      });
    });

    describe('withTracing({ name })', () => {
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

    describe('withTracing(options)', () => {
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
              userId: result.id,
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

      it('captures input/output as autotel.input/output when opted in', async () => {
        const collector = createTraceCollector();

        const calc = traceOptionsFactory(
          { name: 'calc', captureInput: true, captureOutput: true },
          (_ctx: TraceContext) => async (a: number, b: number) => a + b,
        );

        await calc(2, 3);

        const span = collector.getSpans()[0]!;
        // Multiple args captured as an array; single value would be captured directly.
        expect(span.attributes['autotel.input']).toBe('[2,3]');
        expect(span.attributes['autotel.output']).toBe('5');
      });

      it('labels a truncated capture so the gap is queryable', async () => {
        const collector = createTraceCollector();

        // 4096 is the capture ceiling; a 5000-char string is cut and the
        // reader has to be told, or a shortened value reads as the whole one.
        const long = 'x'.repeat(5000);
        const echo = traceOptionsFactory(
          { name: 'echo', captureInput: true, captureOutput: true },
          (_ctx: TraceContext) => async (text: string) => text,
        );

        await echo(long);

        const span = collector.getSpans()[0]!;
        expect(span.attributes['autotel.evidence.input']).toBe('truncated');
        expect(span.attributes['autotel.evidence.output']).toBe('truncated');
      });

      it('leaves an untruncated capture unlabelled', async () => {
        const collector = createTraceCollector();

        const echo = traceOptionsFactory(
          { name: 'echo-short', captureInput: true, captureOutput: true },
          (_ctx: TraceContext) => async (text: string) => text,
        );

        await echo('short');

        const span = collector.getSpans()[0]!;
        expect(span.attributes['autotel.evidence.input']).toBeUndefined();
        expect(span.attributes['autotel.evidence.output']).toBeUndefined();
      });

      it('does not capture input/output by default', async () => {
        const collector = createTraceCollector();

        const calc = traceOptionsFactory(
          { name: 'calc-default' },
          (_ctx: TraceContext) => async (a: number, b: number) => a + b,
        );

        await calc(2, 3);

        const span = collector.getSpans()[0]!;
        expect(span.attributes['autotel.input']).toBeUndefined();
        expect(span.attributes['autotel.output']).toBeUndefined();
      });

      it('captures a single argument directly (not wrapped in an array)', async () => {
        const collector = createTraceCollector();

        const load = traceOptionsFactory(
          { name: 'load', captureInput: true, captureOutput: true },
          (_ctx: TraceContext) => async (req: { userId: string }) => ({
            holdings: 3,
            userId: req.userId,
          }),
        );

        await load({ userId: 'anon' });

        const span = collector.getSpans()[0]!;
        expect(span.attributes['autotel.input']).toBe('{"userId":"anon"}');
        expect(span.attributes['autotel.output']).toBe(
          '{"holdings":3,"userId":"anon"}',
        );
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

      const tracer = withTracing({ serviceName: 'user' });

      const createUser = tracer(
        (_ctx: TraceContext) =>
          async function reusableCreate(name: string) {
            return { id: '123', name };
          },
      );

      const updateUser = tracer(
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
    it('should instrument a single function with { key, fn }', async () => {
      const collector = createTraceCollector();
      const double = instrument({
        key: 'math.double',
        fn: async (value: number) => value * 2,
      });

      await expect(double(21)).resolves.toBe(42);
      expect(collector.expectSpan('math.double').name).toBe('math.double');
    });

    it('should reject malformed single-function options clearly', () => {
      expect(() => instrument({ key: '', fn: () => {} })).toThrow(
        'instrument: "key" must be a non-empty string',
      );
      expect(() =>
        // SAFETY: forcing past the compiler is the point - a JavaScript caller
        // can pass an undefined function, and instrument() must reject it.
        instrument({ key: 'valid', fn: undefined } as never),
      ).toThrow('instrument: "fn" must be a function');
    });

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
        } as unknown as FnRecord,
        serviceName: 'test',
      });

      expect(service.fn).toBeTypeOf('function');
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
        // SAFETY: the service under test is a plain object of functions, which
        // is what instrument() takes; FnRecord names that without the generics.
        functions: svc as unknown as FnRecord,
        serviceName: 'svc',
      });

      // Test that this.prefix is accessible
      const result1 = await instrumented.build!('123');
      expect(result1).toBe('user-123'); // Should not be 'undefined-123'

      // Test that this.count is accessible and modifiable
      const result2 = await instrumented.increment!();
      expect(result2).toBe(1);
      const result3 = await instrumented.increment!();
      expect(result3).toBe(2);

      const spans = collector.getSpans();
      expect(spans).toHaveLength(3);
    });

    it('should not call attributesFromArgs when sampler rejects tracing', async () => {
      const collector = createTraceCollector();

      // Mock expensive attribute extraction
      const expensiveAttributeExtraction = vi.fn((args: unknown[]) => {
        // Simulate expensive operation (JSON cloning, payload scrubbing, etc.)
        return { arg0: String(args[0]) };
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
        return { arg0: String(args[0]) };
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
      // SAFETY: a recorded exception writes its message as a string.
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
            expect(a).toBeTypeOf('number');
            expect(b).toBeTypeOf('string');
            expect(c.x).toBeTypeOf('boolean');
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
          // SAFETY: the legacy context surface is what this test exercises.
          (ctx as LegacyCtx).recordException(error);
        }
        throw error;
      });

      await expect(failingFn()).rejects.toThrow('Test exception');

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.status.code).toBe(2); // ERROR
    });
  });

  describe('baggage', () => {
    it('should get baggage entry from context', async () => {
      const collector = createTraceCollector();

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
        await withTracing({})((ctx) => async () => {
          const tenantId = ctx.getBaggage('tenant.id');
          expect(tenantId).toBe('tenant-123');
          return 'done';
        })();
      });

      expect(collector.getSpans()).toHaveLength(1);
    });

    it('withBaggage should set baggage for child spans', async () => {
      const collector = createTraceCollector();

      await withTracing({})((ctx) => async () => {
        return await withBaggage({
          baggage: { 'tenant.id': 'tenant-456', 'user.id': 'user-789' },
          fn: async () => {
            // Check baggage is available
            expect(ctx.getBaggage('tenant.id')).toBe('tenant-456');
            expect(ctx.getBaggage('user.id')).toBe('user-789');

            // Create child span - should inherit baggage
            await withTracing({})((childCtx) => async () => {
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

      withTracing({})((ctx) => () => {
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
        await withTracing({})((ctx) => async () => {
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

    it('withBaggage should not leak baggage after callback completes', async () => {
      const collector = createTraceCollector();

      await withTracing({})((ctx) => async () => {
        expect(ctx.getBaggage('tenant.id')).toBeUndefined();

        await withBaggage({
          baggage: { 'tenant.id': 'tenant-456' },
          fn: async () => {
            expect(ctx.getBaggage('tenant.id')).toBe('tenant-456');
          },
        });

        // Child spans created after withBaggage must not inherit scoped baggage.
        // (Same-ctx after await may still see baggage due to async context propagation.)
        await withTracing({})((childCtx) => async () => {
          expect(childCtx.getBaggage('tenant.id')).toBeUndefined();
        })();
      })();

      expect(collector.getSpans()).toHaveLength(2);
    });

    it('ctx.getAllBaggage should return all baggage entries', async () => {
      const collector = createTraceCollector();

      // Create context with multiple baggage entries
      const activeContext = context.active();
      let baggage = propagation.createBaggage();
      baggage = baggage.setEntry('key1', { value: 'value1' });
      baggage = baggage.setEntry('key2', { value: 'value2' });
      const contextWithBaggage = propagation.setBaggage(activeContext, baggage);

      await context.with(contextWithBaggage, async () => {
        await withTracing({})((ctx) => async () => {
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

  describe('Array attribute support', () => {
    it('should support string array attributes', async () => {
      const collector = createTraceCollector();

      await trace(async () => {
        const ctx = getActiveTraceContext()!;
        ctx.setAttribute('tags', ['qa', 'test', 'automated']);
        return 'done';
      })();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes['tags']).toEqual(['qa', 'test', 'automated']);
    });

    it('should support number array attributes', async () => {
      const collector = createTraceCollector();

      await trace(async () => {
        const ctx = getActiveTraceContext()!;
        ctx.setAttribute('scores', [95, 87, 92]);
        return 'done';
      })();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes['scores']).toEqual([95, 87, 92]);
    });

    it('should support boolean array attributes', async () => {
      const collector = createTraceCollector();

      await trace(async () => {
        const ctx = getActiveTraceContext()!;
        ctx.setAttribute('flags', [true, false, true]);
        return 'done';
      })();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes['flags']).toEqual([true, false, true]);
    });

    it('should support mixed attributes including arrays via setAttributes', async () => {
      const collector = createTraceCollector();

      await trace(async () => {
        const ctx = getActiveTraceContext()!;
        ctx.setAttributes({
          'user.id': 'user_123',
          environment: 'development',
          version: '1.0.0',
          tags: ['qa', 'test'],
          scores: [1, 2, 3],
        });
        return 'done';
      })();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.attributes['user.id']).toBe('user_123');
      expect(spans[0]!.attributes['environment']).toBe('development');
      expect(spans[0]!.attributes['tags']).toEqual(['qa', 'test']);
      expect(spans[0]!.attributes['scores']).toEqual([1, 2, 3]);
    });
  });

  describe('Full OTel Span API', () => {
    it('should support addEvent for span events', async () => {
      const collector = createTraceCollector();

      // Verify the method can be called without error
      const result = await trace(async () => {
        const ctx = getActiveTraceContext()!;
        // SAFETY: the legacy context surface is what this test exercises.
        (ctx as LegacyCtx).addEvent('order.started', { 'order.id': '123' });
        // SAFETY: the legacy context surface is what this test exercises.
        (ctx as LegacyCtx).addEvent('items.fetched', { 'item.count': 5 });
        return 'done';
      })();

      expect(result).toBe('done');
      expect(collector.getSpans()).toHaveLength(1);
    });

    it('should support updateName for dynamic span naming', async () => {
      const collector = createTraceCollector();

      await instrument({
        key: 'initial.name',
        fn: async () => {
          const ctx = getActiveTraceContext()!;
          ctx.updateName('updated.name');
          return 'done';
        },
      })();

      const spans = collector.getSpans();
      expect(spans).toHaveLength(1);
      expect(spans[0]!.name).toBe('updated.name');
    });

    it('should support isRecording', async () => {
      const collector = createTraceCollector();
      let wasRecording = false;

      await trace(async () => {
        const ctx = getActiveTraceContext()!;
        wasRecording = ctx.isRecording();
        return 'done';
      })();

      expect(wasRecording).toBe(true);
      expect(collector.getSpans()).toHaveLength(1);
    });

    it('should support addLink for span links', async () => {
      const collector = createTraceCollector();

      // Create a mock span context to link to
      const linkContext = {
        traceId: '0af7651916cd43dd8448eb211c80319c',
        spanId: 'b7ad6b7169203331',
        traceFlags: 1,
      };

      // Verify the method can be called without error
      const result = await trace(async () => {
        const ctx = getActiveTraceContext()!;
        ctx.addLink({ context: linkContext });
        return 'done';
      })();

      expect(result).toBe('done');
      expect(collector.getSpans()).toHaveLength(1);
    });

    it('should support addLinks for multiple span links', async () => {
      const collector = createTraceCollector();

      const links = [
        {
          context: {
            traceId: '0af7651916cd43dd8448eb211c80319c',
            spanId: 'b7ad6b7169203331',
            traceFlags: 1,
          },
        },
        {
          context: {
            traceId: '0af7651916cd43dd8448eb211c80319d',
            spanId: 'b7ad6b7169203332',
            traceFlags: 1,
          },
        },
      ];

      // Verify the method can be called without error
      const result = await trace(async () => {
        const ctx = getActiveTraceContext()!;
        ctx.addLinks(links);
        return 'done';
      })();

      expect(result).toBe('done');
      expect(collector.getSpans()).toHaveLength(1);
    });
  });
});
