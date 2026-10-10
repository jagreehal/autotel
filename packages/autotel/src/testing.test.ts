import { describe, expect, expectTypeOf, it } from 'vitest';
import { SpanKind, context, propagation } from '@opentelemetry/api';
import type { Attributes } from '@opentelemetry/api';
import { withTracing } from './functional';
import { createTraceCollector } from './testing';
import type { TraceContext } from './trace-context';

// addEvent is a deprecated OTel span method kept as a runtime back-compat shim
// but hidden from the public TraceContext type (OTEP 4430).
type LegacyCtx = TraceContext & {
  addEvent: (name: string, attributes?: Attributes) => void;
};

describe('createTraceCollector trace-level helpers', () => {
  it('collects trace identity, hierarchy, kind, events, and links', async () => {
    const collector = createTraceCollector();
    const child = withTracing({ name: 'child', spanKind: SpanKind.CLIENT })(
      (ctx) => async () => {
        ctx.setAttribute('key', 'answer');
        (ctx as LegacyCtx).addEvent('cache.hit', { key: 'answer' });
        ctx.addLink({
          context: {
            traceId: 'a'.repeat(32),
            spanId: 'b'.repeat(16),
            traceFlags: 1,
          },
        });
      },
    );
    const root = withTracing({ name: 'root' })(() => async () => child());

    await root();

    const rootSpan = collector.expectSpan('root');
    const childSpan = collector.expectSpan({
      name: 'child',
      kind: SpanKind.CLIENT,
      attributes: { key: 'answer' },
    });
    expect(collector.getRootSpans()).toEqual([rootSpan]);
    expect(collector.getSpansByTraceId(rootSpan.traceId)).toHaveLength(2);
    expect(collector.getDescendants(rootSpan.spanId)).toEqual([childSpan]);
    expect(childSpan.parentSpanId).toBe(rootSpan.spanId);
    expect(childSpan.kind).toBe(SpanKind.CLIENT);
    expect(childSpan.events).toEqual([
      { name: 'cache.hit', attributes: { key: 'answer' } },
    ]);
    expect(childSpan.links).toHaveLength(1);
  });

  it('reports ambiguous and missing span matches', async () => {
    const collector = createTraceCollector();
    const duplicate = withTracing({ name: 'duplicate' })(() => async () => {});

    await duplicate();
    await duplicate();

    expect(() => collector.expectSpan('missing')).toThrow(
      'Expected exactly one span matching "missing", found 0',
    );
    expect(() => collector.expectSpan('duplicate')).toThrow(
      'Expected exactly one span matching "duplicate", found 2',
    );
  });
});

describe('createTraceCollector propagation', () => {
  it('registers a W3C propagator so header propagation works without init()', async () => {
    createTraceCollector();
    const traced = withTracing({ name: 'outgoing' })(() => () => {
      const headers: Record<string, string> = {};
      propagation.inject(context.active(), headers);
      return headers;
    });
    expect(traced().traceparent).toMatch(/^00-[\da-f]{32}-[\da-f]{16}-01$/);
  });
});

describe('withTracing types', () => {
  it('types an async factory as Promise<T>, a sync one as T', () => {
    const asyncFn = withTracing({ name: 'a' })(() => async (n: number) => n);
    const syncFn = withTracing({ name: 's' })(() => (n: number) => n);
    expectTypeOf(asyncFn).returns.toEqualTypeOf<Promise<number>>();
    expectTypeOf(syncFn).returns.toEqualTypeOf<number>();
  });

  it('types a sync-or-thenable handler as T | Promise<T>', () => {
    const mixedFn = withTracing({ name: 'm' })(
      () =>
        (flag: boolean): number | PromiseLike<number> =>
          flag ? 1 : Promise.resolve(2),
    );
    expectTypeOf(mixedFn).returns.toEqualTypeOf<number | Promise<number>>();
    expectTypeOf(mixedFn).toExtend<
      (flag: boolean) => number | Promise<number>
    >();
  });
});
