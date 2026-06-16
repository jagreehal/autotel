import { describe, expect, it, vi } from 'vitest';

import { defineContract, type TelemetryContract } from './contract.js';
import {
  createSchemaValidationProcessor,
  SchemaValidationSpanProcessor,
} from './processor.js';
import type { SchemaViolation } from './validate.js';

const contract: TelemetryContract = defineContract({
  service: 'checkout',
  version: '1.0.0',
  spans: {
    'checkout.charge': {
      attributes: { 'payment.amount_cents': { type: 'number', required: true } },
    },
  },
});

function endSpan(p: SchemaValidationSpanProcessor, name: string, attributes: Record<string, unknown>) {
  p.onEnd({ name, attributes });
}

describe('SchemaValidationSpanProcessor', () => {
  it('collects violations via onViolation in silent mode', () => {
    const seen: SchemaViolation[] = [];
    const p = createSchemaValidationProcessor({
      contract,
      mode: 'silent',
      enabledInProduction: true,
      onViolation: (v) => seen.push(v),
    });
    endSpan(p, 'checkout.charge', {}); // missing required
    expect(seen).toHaveLength(1);
    expect(seen[0].code).toBe('missing_required');
    expect(p.totalViolations).toBe(1);
  });

  it('throws on the first error in throw mode', () => {
    const p = createSchemaValidationProcessor({ contract, mode: 'throw', enabledInProduction: true });
    expect(() => endSpan(p, 'checkout.charge', {})).toThrowError(/contract violation/);
  });

  it('does not throw for a conformant span', () => {
    const p = createSchemaValidationProcessor({ contract, mode: 'throw', enabledInProduction: true });
    expect(() => endSpan(p, 'checkout.charge', { 'payment.amount_cents': 1 })).not.toThrow();
  });

  it('warns through the injected sink, deduplicated within the interval', () => {
    const onWarn = vi.fn();
    const p = createSchemaValidationProcessor({
      contract,
      mode: 'warn',
      enabledInProduction: true,
      onWarn,
      warnIntervalMs: 60_000,
    });
    endSpan(p, 'checkout.charge', {});
    endSpan(p, 'checkout.charge', {}); // identical violation → throttled
    expect(onWarn).toHaveBeenCalledTimes(1);
  });

  it('is disabled in production unless opted in', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const p = createSchemaValidationProcessor({ contract, mode: 'throw' });
      expect(() => endSpan(p, 'checkout.charge', {})).not.toThrow();
      expect(p.totalViolations).toBe(0);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
