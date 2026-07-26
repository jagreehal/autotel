import { describe, expect, it } from 'vitest';
import { SpanKind } from '@opentelemetry/api';
import { withTracing } from './functional';
import { createTraceCollector } from './testing';
import type { TraceContext } from './trace-context';

// addEvent is a deprecated OTel span method kept as a runtime back-compat shim
// but hidden from the public TraceContext type (OTEP 4430).
type LegacyCtx = TraceContext & {
  addEvent: (name: string, attributes?: Record<string, unknown>) => void;
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
