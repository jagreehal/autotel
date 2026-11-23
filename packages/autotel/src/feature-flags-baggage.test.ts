import { context, propagation, ROOT_CONTEXT } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { W3CBaggagePropagator } from '@opentelemetry/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FEATURE_FLAG_BAGGAGE_KEY,
  featureFlagBaggage,
  featureFlagBaggageProvider,
} from './feature-flags-baggage';
import { trace } from './functional';
import { getActiveContextWithBaggage } from './trace-context';

const provider = featureFlagBaggageProvider();

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager());
});
afterAll(() => {
  context.disable();
});

/** Through a real W3C header and back, as the next service receives it. */
function overTheWire(ctx: typeof ROOT_CONTEXT) {
  const w3c = new W3CBaggagePropagator();
  const headers: Record<string, string> = {};
  w3c.inject(ctx, headers, {
    set: (carrier, key, value) => (carrier[key] = value),
  });
  return w3c.extract(ROOT_CONTEXT, headers, {
    get: (carrier, key) => carrier[key],
    keys: (carrier) => Object.keys(carrier),
  });
}

describe('feature flag baggage', () => {
  // Nested traces and outgoing calls read the request's baggage through
  // getActiveContextWithBaggage, which overlays what ctx.setBaggage stored.
  // A restored parent context is older than the store, not newer: the child's
  // write must reach the sibling that runs after it.
  it("keeps a child's baggage update once the parent's context is restored", async () => {
    const seen = await trace.run('parent', async (ctx) => {
      ctx.setBaggage('tenant', 'old');
      await trace.run('child', async (child) => {
        child.setBaggage('tenant', 'new');
      });
      return trace.run('sibling', async (sibling) => ({
        read: sibling.getBaggage('tenant'),
        propagated: propagation
          .getBaggage(getActiveContextWithBaggage())
          ?.getEntry('tenant')?.value,
      }));
    });
    expect(seen).toEqual({ read: 'new', propagated: 'new' });
  });

  // Flags entered for one callback stay in it, even when ctx.setBaggage runs inside.
  it('keeps flag baggage inside the context.with() it was entered for', async () => {
    const seen = await trace.run('edge.request', async (ctx) => {
      const edge = featureFlagBaggage([
        { flagKey: 'express', value: true, variant: 'on' },
      ]);
      await context.with(edge, async () => {
        ctx.setBaggage('tenant', 't_1');
        expect(ctx.getBaggage(FEATURE_FLAG_BAGGAGE_KEY)).toBeDefined();
      });
      const after = propagation.getBaggage(getActiveContextWithBaggage());
      return {
        flags: after?.getEntry(FEATURE_FLAG_BAGGAGE_KEY),
        tenant: after?.getEntry('tenant')?.value,
      };
    });
    expect(seen).toEqual({ flags: undefined, tenant: 't_1' });
  });

  it('survives baggage the request set earlier with ctx.setBaggage', async () => {
    const seen = await trace.run('edge.request', async (ctx) => {
      ctx.setBaggage('tenant', 't_1');
      ctx.setBaggage('stale', 'x');
      ctx.deleteBaggage('stale');
      const edge = featureFlagBaggage([
        { flagKey: 'express', value: true, variant: 'on' },
      ]);
      return context.with(edge, () => {
        const bag = propagation.getBaggage(getActiveContextWithBaggage());
        // ctx reads the same merged view that propagates.
        expect(ctx.getBaggage('tenant')).toBe('t_1');
        expect(ctx.getAllBaggage().has(FEATURE_FLAG_BAGGAGE_KEY)).toBe(true);
        return {
          flags: bag?.getEntry(FEATURE_FLAG_BAGGAGE_KEY)?.value,
          tenant: bag?.getEntry('tenant')?.value,
          stale: bag?.getEntry('stale'),
        };
      });
    });
    expect(JSON.parse(seen.flags ?? 'null')).toEqual({
      express: { value: true, variant: 'on' },
    });
    expect(seen.tenant).toBe('t_1');
    expect(seen.stale).toBeUndefined();
  });

  it('answers downstream with what the edge evaluated, after the header round trip', async () => {
    const edge = featureFlagBaggage(
      [
        {
          flagKey: 'pricing-engine',
          value: 'v2',
          variant: 'v2',
          flagMetadata: { version: 3, flagSetId: 'checkout' },
        },
        { flagKey: 'express', value: true, variant: 'on', flagMetadata: {} },
      ],
      ROOT_CONTEXT,
    );
    const received = overTheWire(edge);

    await context.with(received, async () => {
      expect(
        await provider.resolveStringEvaluation('pricing-engine', 'control'),
      ).toEqual({
        value: 'v2',
        variant: 'v2',
        reason: 'CACHED',
        flagMetadata: { version: '3', flagSetId: 'checkout' },
      });
      const express = await provider.resolveBooleanEvaluation('express', false);
      expect(express.value).toBe(true);
    });
  });

  it('reports a flag the edge did not carry, or carried as another type, instead of guessing', async () => {
    const ctx = featureFlagBaggage(
      [{ flagKey: 'a', value: 'x' }],
      ROOT_CONTEXT,
    );
    await context.with(ctx, async () => {
      await expect(
        provider.resolveStringEvaluation('b', 'd'),
      ).rejects.toMatchObject({
        code: 'FLAG_NOT_FOUND',
      });
      await expect(
        provider.resolveBooleanEvaluation('a', false),
      ).rejects.toMatchObject({
        code: 'TYPE_MISMATCH',
      });
    });
    await expect(
      provider.resolveStringEvaluation('a', 'd'),
    ).rejects.toMatchObject({
      code: 'FLAG_NOT_FOUND',
    });
  });

  it('replaces flags that arrived with the request rather than forwarding them', async () => {
    // A client sending its own flag baggage must not reach downstream services.
    const forged = propagation.setBaggage(
      ROOT_CONTEXT,
      propagation.createBaggage({
        [FEATURE_FLAG_BAGGAGE_KEY]: {
          value: JSON.stringify({ admin: { value: true } }),
        },
        tenant: { value: 'acme' },
      }),
    );
    const edge = featureFlagBaggage([{ flagKey: 'a', value: 'x' }], forged);

    await context.with(edge, async () => {
      await expect(
        provider.resolveBooleanEvaluation('admin', false),
      ).rejects.toMatchObject({ code: 'FLAG_NOT_FOUND' });
    });
    // Other baggage is left alone.
    expect(propagation.getBaggage(edge)?.getEntry('tenant')?.value).toBe(
      'acme',
    );
  });

  it('treats malformed baggage as carrying nothing', async () => {
    const ctx = propagation.setBaggage(
      ROOT_CONTEXT,
      propagation.createBaggage({
        [FEATURE_FLAG_BAGGAGE_KEY]: { value: '{not json' },
      }),
    );
    await context.with(ctx, async () => {
      await expect(
        provider.resolveStringEvaluation('a', 'd'),
      ).rejects.toMatchObject({ code: 'FLAG_NOT_FOUND' });
    });
  });
});
