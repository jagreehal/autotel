import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { getActiveTraceContext, instrument, withTracing } from './functional';
import { getActiveSpan } from './trace-helpers';
import { init } from './init';
import { defineBaggageSchema } from './trace-context';

function namedWrapper<TArgs extends unknown[], TReturn>(
  name: string,
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn {
  return instrument({ key: name, fn });
}

/**
 * A nested traced function must see its own span through the ambient OTel
 * context, not an ancestor's.
 *
 * These use the real `init()` pipeline with an in-memory exporter on purpose.
 * `createTraceCollector()` cannot cover this: it swaps in mock spans backed by
 * its own AsyncLocalStorage, so it reports what the mock recorded rather than
 * which span the OpenTelemetry context was bound to. `configure({ tracer })`
 * alone is no good either, because without `init()` no context manager is
 * registered and `context.active()` never leaves ROOT.
 *
 * Regression: `wrapWithTracingSync` ran the body under
 * `getActiveContextWithBaggage()`, which for a nested call still held an
 * ancestor's context, so `getActiveSpan()` resolved to the outermost traced
 * ancestor and attributes written through it landed on the wrong span.
 */
describe('ambient span identity inside nested traced functions', () => {
  // init() registers its pipeline once per process, so the exporter is created
  // and wired a single time and reset between tests.
  const exporter = new InMemorySpanExporter();

  beforeAll(() => {
    init({
      service: 'ambient-identity-test',
      sampling: 'development',
      spanProcessor: new SimpleSpanProcessor(exporter),
    });
  });

  beforeEach(() => {
    exporter.reset();
  });

  const spanNamed = (name: string) =>
    exporter.getFinishedSpans().find((s) => s.name === name);

  const waitForSpans = async (count: number) => {
    await expect
      .poll(() => exporter.getFinishedSpans().length, { timeout: 1_000 })
      .toBe(count);
  };

  it('getActiveSpan() resolves to the innermost span, not an ancestor', async () => {
    const inner = namedWrapper('inner', async () => {
      getActiveSpan()?.setAttribute('written.by', 'inner');
    });
    await namedWrapper('outer', async () => {
      await inner();
    })();
    await waitForSpans(2);

    expect(spanNamed('inner')?.attributes['written.by']).toBe('inner');
    expect(spanNamed('outer')?.attributes['written.by']).toBeUndefined();
  });

  it('withTracing() bodies see their own span too', async () => {
    const inner = withTracing({ name: 'wt.inner' })(() => async () => {
      getActiveSpan()?.setAttribute('written.by', 'wt.inner');
    });
    await withTracing({ name: 'wt.outer' })(() => async () => {
      await inner();
    })();
    await waitForSpans(2);

    expect(spanNamed('wt.inner')?.attributes['written.by']).toBe('wt.inner');
    expect(spanNamed('wt.outer')?.attributes['written.by']).toBeUndefined();
  });

  it('getActiveTraceContext() agrees with getActiveSpan()', async () => {
    const inner = namedWrapper('ctx.inner', async () => {
      getActiveTraceContext()?.setAttribute('ctx.here', true);
      getActiveSpan()?.setAttribute('span.here', true);
    });
    await namedWrapper('ctx.outer', async () => {
      await inner();
    })();
    await waitForSpans(2);

    const innerSpan = spanNamed('ctx.inner');
    expect(innerSpan?.attributes['ctx.here']).toBe(true);
    expect(innerSpan?.attributes['span.here']).toBe(true);
  });

  it('nesting three deep keeps each level distinct', async () => {
    const c = namedWrapper('lvl.c', async () => {
      getActiveSpan()?.setAttribute('level', 'c');
    });
    const b = namedWrapper('lvl.b', async () => {
      getActiveSpan()?.setAttribute('level', 'b');
      await c();
    });
    await namedWrapper('lvl.a', async () => {
      getActiveSpan()?.setAttribute('level', 'a');
      await b();
    })();
    await waitForSpans(3);

    expect(spanNamed('lvl.a')?.attributes['level']).toBe('a');
    expect(spanNamed('lvl.b')?.attributes['level']).toBe('b');
    expect(spanNamed('lvl.c')?.attributes['level']).toBe('c');
  });

  it('the inner span is still a child of the outer span', async () => {
    const inner = namedWrapper('parent.inner', async () => {});
    await namedWrapper('parent.outer', async () => {
      await inner();
    })();
    await waitForSpans(2);

    expect(spanNamed('parent.inner')?.parentSpanContext?.spanId).toBe(
      spanNamed('parent.outer')?.spanContext().spanId,
    );
  });

  it('preserves the inner ambient span after a baggage update', async () => {
    const inner = namedWrapper('baggage.inner', async () => {
      const ctx = getActiveTraceContext();
      ctx?.setBaggage('tenant.id', 'tenant-42');
      getActiveSpan()?.setAttribute('span.after_baggage', true);
      getActiveTraceContext()?.setAttribute('ctx.after_baggage', true);
      expect(getActiveTraceContext()?.getBaggage('tenant.id')).toBe(
        'tenant-42',
      );
    });

    await namedWrapper('baggage.outer', async () => {
      await inner();
    })();
    await waitForSpans(2);

    const innerSpan = spanNamed('baggage.inner');
    const outerSpan = spanNamed('baggage.outer');
    expect(innerSpan?.attributes['span.after_baggage']).toBe(true);
    expect(innerSpan?.attributes['ctx.after_baggage']).toBe(true);
    expect(outerSpan?.attributes['span.after_baggage']).toBeUndefined();
    expect(outerSpan?.attributes['ctx.after_baggage']).toBeUndefined();
  });

  it('preserves the active span after deleting baggage', async () => {
    const inner = namedWrapper('delete.inner', async () => {
      const ctx = getActiveTraceContext();
      ctx?.setBaggage('temporary', 'value');
      ctx?.deleteBaggage('temporary');
      getActiveSpan()?.setAttribute('after.delete', true);
      expect(ctx?.getBaggage('temporary')).toBeUndefined();
    });

    await namedWrapper('delete.outer', async () => {
      await inner();
    })();
    await waitForSpans(2);

    expect(spanNamed('delete.inner')?.attributes['after.delete']).toBe(true);
    expect(
      spanNamed('delete.outer')?.attributes['after.delete'],
    ).toBeUndefined();
  });

  it('preserves the active span after typed baggage updates', async () => {
    type TenantBaggage = { tenantId: string; region: string };
    const tenantBaggage = defineBaggageSchema<TenantBaggage>('tenant');
    const inner = namedWrapper('typed.inner', async () => {
      const ctx = getActiveTraceContext<TenantBaggage>();
      if (!ctx) throw new Error('expected an active trace context');
      tenantBaggage.set(ctx, { tenantId: 'tenant-42', region: 'eu-west-2' });
      getActiveSpan()?.setAttribute('after.typed_baggage', true);
      expect(tenantBaggage.get(ctx)).toEqual({
        tenantId: 'tenant-42',
        region: 'eu-west-2',
      });
    });

    await namedWrapper('typed.outer', async () => {
      await inner();
    })();
    await waitForSpans(2);

    expect(spanNamed('typed.inner')?.attributes['after.typed_baggage']).toBe(
      true,
    );
    expect(
      spanNamed('typed.outer')?.attributes['after.typed_baggage'],
    ).toBeUndefined();
  });

  it('parents a later sibling to the outer span after baggage changes', async () => {
    const first = namedWrapper('siblings.first', async () => {
      getActiveTraceContext()?.setBaggage('shared', 'from-first');
    });
    const second = namedWrapper('siblings.second', async () => {
      expect(getActiveTraceContext()?.getBaggage('shared')).toBe('from-first');
      getActiveSpan()?.setAttribute('sibling', 'second');
    });

    await namedWrapper('siblings.outer', async () => {
      await first();
      getActiveSpan()?.setAttribute('after.first_child', true);
      await second();
    })();
    await waitForSpans(3);

    const outerSpanId = spanNamed('siblings.outer')?.spanContext().spanId;
    expect(spanNamed('siblings.first')?.parentSpanContext?.spanId).toBe(
      outerSpanId,
    );
    expect(spanNamed('siblings.second')?.parentSpanContext?.spanId).toBe(
      outerSpanId,
    );
    expect(spanNamed('siblings.second')?.attributes['sibling']).toBe('second');
    expect(spanNamed('siblings.outer')?.attributes['after.first_child']).toBe(
      true,
    );
  });

  it('isolates active spans across interleaved sibling operations', async () => {
    let markFirstUpdated!: () => void;
    let releaseFirst!: () => void;
    const firstUpdated = new Promise<void>((resolve) => {
      markFirstUpdated = resolve;
    });
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = namedWrapper('concurrent.first', async () => {
      getActiveTraceContext()?.setBaggage('branch', 'first');
      markFirstUpdated();
      await firstCanFinish;
      getActiveSpan()?.setAttribute('after.interleave', 'first');
    });
    const second = namedWrapper('concurrent.second', async () => {
      await firstUpdated;
      getActiveTraceContext()?.setBaggage('branch', 'second');
      getActiveSpan()?.setAttribute('after.interleave', 'second');
      releaseFirst();
    });

    await namedWrapper('concurrent.outer', async () => {
      await Promise.all([first(), second()]);
    })();
    await waitForSpans(3);

    const outerSpan = spanNamed('concurrent.outer');
    const firstSpan = spanNamed('concurrent.first');
    const secondSpan = spanNamed('concurrent.second');
    expect(firstSpan?.attributes['after.interleave']).toBe('first');
    expect(secondSpan?.attributes['after.interleave']).toBe('second');
    expect(outerSpan?.attributes['after.interleave']).toBeUndefined();
    expect(firstSpan?.parentSpanContext?.spanId).toBe(
      outerSpan?.spanContext().spanId,
    );
    expect(secondSpan?.parentSpanContext?.spanId).toBe(
      outerSpan?.spanContext().spanId,
    );
  });

  it('keeps sync nested functions on their own span after baggage updates', async () => {
    const inner = namedWrapper('sync.inner', () => {
      getActiveTraceContext()?.setBaggage('sync', 'true');
      getActiveSpan()?.setAttribute('sync.after_baggage', true);
    });

    namedWrapper('sync.outer', () => {
      inner();
    })();
    await waitForSpans(2);

    expect(spanNamed('sync.inner')?.attributes['sync.after_baggage']).toBe(
      true,
    );
    expect(
      spanNamed('sync.outer')?.attributes['sync.after_baggage'],
    ).toBeUndefined();
  });
});
