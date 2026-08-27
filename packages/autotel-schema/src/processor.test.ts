import { describe, expect, it, vi } from 'vitest';

import { defineContract, type TelemetryContract } from './contract.js';
import {
  createSchemaValidationProcessor,
  SchemaValidationSpanProcessor,
} from './processor.js';
import type { SchemaViolation } from './validate.js';
import type { EmittedAttributeValue } from './validate.js';

const contract: TelemetryContract = defineContract({
  service: 'checkout',
  version: '1.0.0',
  spans: {
    'checkout.charge': {
      attributes: {
        'payment.amount_cents': { type: 'number', required: true },
      },
    },
  },
});

function endSpan(
  p: SchemaValidationSpanProcessor,
  name: string,
  attributes: Record<string, EmittedAttributeValue>,
) {
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
    const p = createSchemaValidationProcessor({
      contract,
      mode: 'throw',
      enabledInProduction: true,
    });
    expect(() => endSpan(p, 'checkout.charge', {})).toThrowError(
      /contract violation/,
    );
  });

  it('does not throw for a conformant span', () => {
    const p = createSchemaValidationProcessor({
      contract,
      mode: 'throw',
      enabledInProduction: true,
    });
    expect(() =>
      endSpan(p, 'checkout.charge', { 'payment.amount_cents': 1 }),
    ).not.toThrow();
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

describe('SchemaValidationSpanProcessor — stamping violations onto the span', () => {
  /**
   * Opt-in, because it changes what gets exported.
   *
   * The point is the handoff: the app owns the contract, so it is the only
   * thing that can validate. A viewer reading the exported spans has no
   * contract and cannot. Marking the span is what lets the violation travel
   * to wherever the span is read.
   */
  it('leaves the span untouched unless asked', () => {
    const p = createSchemaValidationProcessor({
      contract,
      mode: 'silent',
      enabledInProduction: true,
    });
    const attributes: Record<string, EmittedAttributeValue> = {};

    p.onEnd({ name: 'checkout.charge', attributes });

    expect(Object.keys(attributes)).toEqual([]);
  });

  it('marks the span with a count, a severity and the codes', () => {
    const p = createSchemaValidationProcessor({
      contract,
      mode: 'silent',
      enabledInProduction: true,
      stampViolations: true,
    });
    const attributes: Record<string, EmittedAttributeValue> = {};

    p.onEnd({ name: 'checkout.charge', attributes });

    expect(attributes['autotel.schema.violations']).toBe(1);
    expect(attributes['autotel.schema.violation.severity']).toBe('error');
    expect(attributes['autotel.schema.violation.codes']).toEqual([
      'missing_required:payment.amount_cents',
    ]);
  });

  it('leaves a conforming span unmarked, so the attribute means something', () => {
    const p = createSchemaValidationProcessor({
      contract,
      mode: 'silent',
      enabledInProduction: true,
      stampViolations: true,
    });
    const attributes: Record<string, EmittedAttributeValue> = {
      'payment.amount_cents': 500,
    };

    p.onEnd({ name: 'checkout.charge', attributes });

    expect(attributes['autotel.schema.violations']).toBeUndefined();
  });

  it('reports the worst severity, not the last one seen', () => {
    const strict = createSchemaValidationProcessor({
      contract,
      mode: 'silent',
      enabledInProduction: true,
      stampViolations: true,
      strictSpanNames: true,
    });
    const attributes: Record<string, EmittedAttributeValue> = {};

    // An undeclared span name is a warning; nothing here is an error.
    strict.onEnd({ name: 'checkout.undeclared', attributes });

    expect(attributes['autotel.schema.violation.severity']).toBe('warning');
  });

  it('caps the codes it writes, so one bad span cannot bloat the payload', () => {
    const wide = defineContract({
      service: 'checkout',
      version: '1.0.0',
      spans: {
        'checkout.wide': {
          attributes: Object.fromEntries(
            Array.from({ length: 40 }, (_, i) => [
              `field.${i}`,
              { type: 'string', required: true } as const,
            ]),
          ),
        },
      },
    });
    const p = createSchemaValidationProcessor({
      contract: wide,
      mode: 'silent',
      enabledInProduction: true,
      stampViolations: true,
    });
    const attributes: Record<string, EmittedAttributeValue> = {};

    p.onEnd({ name: 'checkout.wide', attributes });

    // The count stays honest even though the list is trimmed.
    expect(attributes['autotel.schema.violations']).toBe(40);
    expect(
      (attributes['autotel.schema.violation.codes'] as string[]).length,
    ).toBe(20);
  });
});
