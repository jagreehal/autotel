import { describe, it, expect, vi } from 'vitest';
import { defineEnricher } from './enricher-toolkit';

describe('defineEnricher', () => {
  it('merges computed values into existing field by default', () => {
    const enricher = defineEnricher({
      name: 'tenant-enricher',
      field: 'tenant',
      compute: () => ({ plan: 'pro' }),
    });

    const ctx = {
      event: { tenant: { id: 't_1' } },
    };

    enricher(ctx);
    expect(ctx.event).toEqual({ tenant: { id: 't_1', plan: 'pro' } });
  });

  it('overwrites field when overwrite=true', () => {
    const enricher = defineEnricher(
      {
        name: 'tenant-enricher',
        field: 'tenant',
        compute: () => ({ plan: 'pro' }),
      },
      { overwrite: true },
    );

    const ctx = {
      event: { tenant: { id: 't_1' } },
    };

    enricher(ctx);
    expect(ctx.event).toEqual({ tenant: { plan: 'pro' } });
  });

  it('skips enrichment when compute returns undefined', () => {
    const enricher = defineEnricher({
      name: 'noop-enricher',
      field: 'tenant',
      compute: () => undefined,
    });

    const ctx = { event: { a: 1 } as Record<string, unknown> };
    enricher(ctx);
    expect(ctx.event).toEqual({ a: 1 });
  });

  it('isolates compute errors and logs them', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const enricher = defineEnricher({
      name: 'broken-enricher',
      field: 'tenant',
      compute: () => {
        throw new Error('boom');
      },
    });

    const ctx = { event: {} as Record<string, unknown> };
    enricher(ctx);

    expect(ctx.event).toEqual({});
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
