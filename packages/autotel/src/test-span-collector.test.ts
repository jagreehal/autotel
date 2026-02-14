import { describe, expect, it, vi } from 'vitest';
import { SpanStatusCode } from '@opentelemetry/api';
import { TestSpanCollector, type SerializedSpan } from './test-span-collector';

/** Helper to create a minimal ReadableSpan mock */
function makeSpan(opts: {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime?: [number, number];
  duration?: [number, number];
  statusCode?: number;
  statusMessage?: string;
  attributes?: Record<string, unknown>;
}) {
  return {
    spanContext: () => ({ traceId: opts.traceId, spanId: opts.spanId }),
    parentSpanContext: opts.parentSpanId
      ? { spanId: opts.parentSpanId }
      : undefined,
    name: opts.name,
    startTime: opts.startTime ?? [1000, 500_000_000],
    duration: opts.duration ?? [0, 100_000_000],
    status: {
      code: opts.statusCode ?? SpanStatusCode.UNSET,
      message: opts.statusMessage ?? '',
    },
    attributes: opts.attributes ?? {},
  } as any;
}

describe('TestSpanCollector', () => {
  it('groups spans by traceId', () => {
    const collector = new TestSpanCollector();

    const callback = vi.fn();
    collector.export(
      [
        makeSpan({ traceId: 'trace-a', spanId: 'span-1', name: 'op1' }),
        makeSpan({ traceId: 'trace-b', spanId: 'span-2', name: 'op2' }),
        makeSpan({
          traceId: 'trace-a',
          spanId: 'span-3',
          parentSpanId: 'span-1',
          name: 'op3',
        }),
      ],
      callback,
    );

    expect(callback).toHaveBeenCalledWith({ code: 0 }); // ExportResultCode.SUCCESS

    const traceA = collector.drainTrace('trace-a', 'span-1');
    expect(traceA).toHaveLength(2);
    expect(traceA.map((s) => s.name)).toEqual(
      expect.arrayContaining(['op1', 'op3']),
    );

    const traceB = collector.drainTrace('trace-b', 'span-2');
    expect(traceB).toHaveLength(1);
    expect(traceB[0].name).toBe('op2');
  });

  it('drainTrace returns only descendants of rootSpanId', () => {
    const collector = new TestSpanCollector();

    collector.export(
      [
        makeSpan({ traceId: 't1', spanId: 'root', name: 'test:mytest' }),
        makeSpan({
          traceId: 't1',
          spanId: 'child1',
          parentSpanId: 'root',
          name: 'child-op',
        }),
        makeSpan({
          traceId: 't1',
          spanId: 'grandchild',
          parentSpanId: 'child1',
          name: 'grandchild-op',
        }),
        makeSpan({ traceId: 't1', spanId: 'other-root', name: 'other-test' }),
        makeSpan({
          traceId: 't1',
          spanId: 'other-child',
          parentSpanId: 'other-root',
          name: 'other-child-op',
        }),
      ],
      vi.fn(),
    );

    const spans = collector.drainTrace('t1', 'root');
    expect(spans).toHaveLength(3);
    const names = spans.map((s) => s.name);
    expect(names).toContain('test:mytest');
    expect(names).toContain('child-op');
    expect(names).toContain('grandchild-op');
    expect(names).not.toContain('other-test');
    expect(names).not.toContain('other-child-op');
  });

  it('returns [] for unknown traceId', () => {
    const collector = new TestSpanCollector();
    expect(collector.drainTrace('nonexistent', 'any-span')).toEqual([]);
  });

  it('converts HrTime to ms and maps status codes', () => {
    const collector = new TestSpanCollector();

    collector.export(
      [
        makeSpan({
          traceId: 't',
          spanId: 's1',
          name: 'ok-span',
          startTime: [100, 250_000_000],
          duration: [1, 500_000_000],
          statusCode: SpanStatusCode.OK,
        }),
        makeSpan({
          traceId: 't',
          spanId: 's2',
          parentSpanId: 's1',
          name: 'error-span',
          startTime: [200, 0],
          duration: [0, 50_000_000],
          statusCode: SpanStatusCode.ERROR,
          statusMessage: 'something failed',
        }),
      ],
      vi.fn(),
    );

    const spans = collector.drainTrace('t', 's1');
    const okSpan = spans.find((s) => s.name === 'ok-span')!;
    const errSpan = spans.find((s) => s.name === 'error-span')!;

    expect(okSpan.startTimeMs).toBe(100_250);
    expect(okSpan.durationMs).toBe(1500);
    expect(okSpan.status).toBe('ok');
    expect(okSpan.statusMessage).toBeUndefined();

    expect(errSpan.startTimeMs).toBe(200_000);
    expect(errSpan.durationMs).toBe(50);
    expect(errSpan.status).toBe('error');
    expect(errSpan.statusMessage).toBe('something failed');
  });

  it('keeps string/number/boolean + arrays of primitives, drops others', () => {
    const collector = new TestSpanCollector();

    collector.export(
      [
        makeSpan({
          traceId: 't',
          spanId: 's',
          name: 'attr-test',
          attributes: {
            str: 'hello',
            num: 42,
            bool: true,
            strArr: ['a', 'b'],
            numArr: [1, 2, 3],
            boolArr: [true, false],
            nested: { key: 'value' }, // should be dropped
            mixed: [1, 'two'], // should be dropped (mixed types)
            empty: [], // should be dropped (empty array)
            undef: undefined,
          },
        }),
      ],
      vi.fn(),
    );

    const spans = collector.drainTrace('t', 's');
    expect(spans).toHaveLength(1);
    const attrs = spans[0].attributes!;
    expect(attrs.str).toBe('hello');
    expect(attrs.num).toBe(42);
    expect(attrs.bool).toBe(true);
    expect(attrs.strArr).toEqual(['a', 'b']);
    expect(attrs.numArr).toEqual([1, 2, 3]);
    expect(attrs.boolArr).toEqual([true, false]);
    expect(attrs).not.toHaveProperty('nested');
    expect(attrs).not.toHaveProperty('mixed');
    expect(attrs).not.toHaveProperty('empty');
    expect(attrs).not.toHaveProperty('undef');
  });

  it('omits attributes field when span has no serializable attributes', () => {
    const collector = new TestSpanCollector();

    collector.export(
      [
        makeSpan({
          traceId: 't',
          spanId: 's',
          name: 'no-attrs',
          attributes: {},
        }),
      ],
      vi.fn(),
    );

    const spans = collector.drainTrace('t', 's');
    expect(spans[0].attributes).toBeUndefined();
  });

  it('clears all data on shutdown', async () => {
    const collector = new TestSpanCollector();

    collector.export(
      [makeSpan({ traceId: 't', spanId: 's', name: 'op' })],
      vi.fn(),
    );

    await collector.shutdown();
    expect(collector.drainTrace('t', 's')).toEqual([]);
  });

  it('drain removes the trace entry so second drain returns []', () => {
    const collector = new TestSpanCollector();

    collector.export(
      [makeSpan({ traceId: 't', spanId: 's', name: 'op' })],
      vi.fn(),
    );

    expect(collector.drainTrace('t', 's')).toHaveLength(1);
    expect(collector.drainTrace('t', 's')).toEqual([]);
  });
});
