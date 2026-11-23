/**
 * How ctx's baggage setters and OpenTelemetry's own scopes combine, case by
 * case, through the real async context manager. Every case reads both ways:
 * `ctx.getBaggage()` and what propagates (`getActiveContextWithBaggage()`),
 * which must always agree.
 */
import {
  context,
  propagation,
  ROOT_CONTEXT,
  trace as otelTrace,
} from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Trace, type WithTraceContext } from './decorators';
import { experiment } from './experiment';
import { trace, withBaggage } from './functional';
import {
  createTraceContext,
  defineBaggageSchema,
  getActiveContextWithBaggage,
  type TraceContext,
} from './trace-context';

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager());
});
afterAll(() => {
  context.disable();
});

/** `key` as ctx reads it and as it propagates; they must match. */
function read(ctx: TraceContext, key: string): string | undefined {
  const propagated = propagation
    .getBaggage(getActiveContextWithBaggage())
    ?.getEntry(key)?.value;
  expect(ctx.getBaggage(key)).toBe(propagated);
  return propagated;
}

/** The active context with `key` set the plain OpenTelemetry way. */
function withEntry(key: string, value: string) {
  const baggage =
    propagation.getBaggage(context.active()) ?? propagation.createBaggage();
  return propagation.setBaggage(
    context.active(),
    baggage.setEntry(key, { value }),
  );
}

describe('ctx baggage with OpenTelemetry scopes', () => {
  it('sees a context.with() entry inside the callback and not after it', async () => {
    await trace.run('request', async (ctx) => {
      ctx.setBaggage('tenant', 't_1');
      await context.with(withEntry('flag', 'on'), async () => {
        ctx.setBaggage('user', 'u_1');
        expect(read(ctx, 'flag')).toBe('on');
        expect(read(ctx, 'tenant')).toBe('t_1');
      });
      expect(read(ctx, 'flag')).toBeUndefined();
      expect(read(ctx, 'tenant')).toBe('t_1');
      expect(read(ctx, 'user')).toBe('u_1');
    });
  });

  it("keeps a child's write once the parent's context is restored", async () => {
    await trace.run('parent', async (ctx) => {
      ctx.setBaggage('tenant', 'old');
      await trace.run('child', async (child) => {
        child.setBaggage('tenant', 'new');
      });
      await trace.run('sibling', async (sibling) => {
        expect(read(sibling, 'tenant')).toBe('new');
      });
      expect(read(ctx, 'tenant')).toBe('new');
    });
  });

  it('lets an explicit context.with() override a key ctx set, for its callback only', async () => {
    await trace.run('request', async (ctx) => {
      ctx.setBaggage('tenant', 'old');
      await context.with(withEntry('tenant', 'scoped'), async () => {
        expect(read(ctx, 'tenant')).toBe('scoped');
      });
      expect(read(ctx, 'tenant')).toBe('old');
    });
  });

  it('lets a scoped override reuse a value an earlier write replaced', async () => {
    await trace.run('parent', async (ctx) => {
      ctx.setBaggage('region', 'EU');
      await trace.run('child', async (child) => {
        child.setBaggage('region', 'US');
      });
      expect(read(ctx, 'region')).toBe('US');
      await context.with(withEntry('region', 'EU'), async () => {
        expect(read(ctx, 'region')).toBe('EU');
      });
      expect(read(ctx, 'region')).toBe('US');
    });
  });

  it("keeps a child's write in a context.with() entered from the restored parent", async () => {
    await trace.run('parent', async (ctx) => {
      await trace.run('child', async (child) => {
        child.setBaggage('tenant', 'new');
      });
      await context.with(withEntry('flag', 'on'), async () => {
        expect(read(ctx, 'tenant')).toBe('new');
        expect(read(ctx, 'flag')).toBe('on');
      });
    });
  });

  it('lets a scope remove a key ctx set, for its callback only', async () => {
    await trace.run('request', async (ctx) => {
      ctx.setBaggage('tenant', 't_1');
      const without = propagation.setBaggage(
        context.active(),
        propagation.getBaggage(context.active())!.removeEntry('tenant'),
      );
      await context.with(without, async () => {
        expect(read(ctx, 'tenant')).toBeUndefined();
      });
      expect(read(ctx, 'tenant')).toBe('t_1');
    });
  });

  it('lets a scope entered after a child write remove that key', async () => {
    await trace.run('parent', async (ctx) => {
      ctx.setBaggage('tenant', 'old');
      await trace.run('child', async (child) => {
        child.setBaggage('tenant', 'new');
      });
      const without = propagation.setBaggage(
        getActiveContextWithBaggage(),
        propagation
          .getBaggage(getActiveContextWithBaggage())!
          .removeEntry('tenant'),
      );
      await context.with(without, async () => {
        expect(read(ctx, 'tenant')).toBeUndefined();
      });
      expect(read(ctx, 'tenant')).toBe('new');
    });
  });

  it("keeps a child's write made inside withBaggage() once the child returns", async () => {
    await trace.run('request', async (ctx) => {
      ctx.setBaggage('tenant', 't_1');
      await withBaggage({
        baggage: { region: 'APAC' },
        fn: async () => {
          expect(read(ctx, 'region')).toBe('APAC');
          await trace.run('child', async (child) => {
            child.setBaggage('region', 'SA');
          });
          expect(read(ctx, 'region')).toBe('SA');
        },
      });
    });
  });

  it("keeps a child's write made inside a typed baggage scope once the child returns", async () => {
    const geo = defineBaggageSchema<{ region: string }>('geo');
    await trace.run('request', async (ctx) => {
      ctx.setBaggage('tenant', 't_1');
      await geo.with({ region: 'APAC' }, async () => {
        await trace.run('child', async (child) => {
          child.setBaggage('geo.region', 'SA');
        });
        expect(read(ctx, 'geo.region')).toBe('SA');
      });
    });
  });

  it("keeps a child's write over a context.with() entered before it, whatever ctx wrote earlier", async () => {
    await trace.run('request', async (ctx) => {
      ctx.setBaggage('x', '1'); // an unrelated earlier write marks the scope
      await context.with(withEntry('a', '2'), async () => {
        await trace.run('child', async (child) => {
          child.setBaggage('a', '3');
        });
        expect(read(ctx, 'a')).toBe('3');
      });
      expect(read(ctx, 'a')).toBe('3');
    });
  });

  it('keeps a key ctx deleted deleted, through a later context.with()', async () => {
    await trace.run('request', async (ctx) => {
      ctx.setBaggage('stale', 'x');
      const captured = context.active();
      ctx.deleteBaggage('stale');
      await context.with(withEntry('flag', 'on'), async () => {
        expect(read(ctx, 'stale')).toBeUndefined();
      });
      // A context captured before the delete is older, not an override.
      await context.with(captured, async () => {
        expect(read(ctx, 'stale')).toBeUndefined();
      });
    });
  });

  it('reads an overwritten value as current again once ctx sets it back', async () => {
    await trace.run('request', async (ctx) => {
      ctx.setBaggage('tenant', 'a');
      ctx.setBaggage('tenant', 'b');
      ctx.setBaggage('tenant', 'a');
      await context.with(withEntry('flag', 'on'), async () => {
        expect(read(ctx, 'tenant')).toBe('a');
      });
    });
  });

  it('keeps baggage the request arrived with alongside ctx writes', async () => {
    const incoming = propagation.setBaggage(
      context.active(),
      propagation.createBaggage({ region: { value: 'eu' } }),
    );
    await context.with(incoming, () =>
      trace.run('request', async (ctx) => {
        ctx.setBaggage('tenant', 't_1');
        await context.with(withEntry('flag', 'on'), async () => {
          expect(read(ctx, 'region')).toBe('eu');
          expect(read(ctx, 'tenant')).toBe('t_1');
        });
        expect(read(ctx, 'region')).toBe('eu');
      }),
    );
  });

  it('keeps a ctx made outside a trace from seeding the next trace', async () => {
    const span = otelTrace.getTracer('test').startSpan('loose');
    createTraceContext(span).setBaggage('order', 'ord-leak');
    span.end();
    await trace.run('next request', async (ctx) => {
      expect(read(ctx, 'order')).toBeUndefined();
    });
  });

  it("scopes a decorated method's baggage to the call", async () => {
    class Orders {
      declare ctx: WithTraceContext['ctx'];
      @Trace()
      async place() {
        this.ctx!.setBaggage('order', 'ord-1');
        return this.ctx!.getBaggage('order');
      }
    }
    expect(await new Orders().place()).toBe('ord-1');
    await trace.run('next request', async (ctx) => {
      expect(read(ctx, 'order')).toBeUndefined();
    });
  });

  // An auto-instrumented request: a span autotel did not start, entered with
  // context.with() the way HTTP instrumentation runs each handler.
  it('writes inside a request autotel did not start, and only for it', async () => {
    const span = otelTrace.getTracer('http').startSpan('GET /checkout');
    await context.with(otelTrace.setSpan(ROOT_CONTEXT, span), async () => {
      experiment({ name: 'checkout', variant: 'b' });
      const sent = propagation
        .getBaggage(getActiveContextWithBaggage())
        ?.getEntry('experiment.variant')?.value;
      expect(sent).toBe('b');
      await trace.run('handler', async (ctx) => {
        expect(read(ctx, 'experiment.variant')).toBe('b');
      });
    });
    span.end();
    await trace.run('next request', async (ctx) => {
      expect(read(ctx, 'experiment.variant')).toBeUndefined();
    });
  });
});
