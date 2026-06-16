import { describe, expect, it } from 'vitest';

import {
  allowsAdditionalAttributes,
  defineContract,
  resolveAttributeSpec,
  type TelemetryContract,
} from './contract.js';

const base: TelemetryContract = {
  service: 'checkout',
  version: '1.2.0',
  commonAttributes: {
    'user.id': { type: 'string', highCardinality: true },
  },
  spans: {
    'checkout.charge': {
      attributes: {
        'payment.provider': { type: 'string', required: true, enum: ['stripe', 'paypal'] },
        'payment.amount_cents': { type: 'number', required: true },
      },
    },
  },
};

describe('defineContract', () => {
  it('accepts and freezes a valid contract', () => {
    const c = defineContract(base);
    expect(Object.isFrozen(c)).toBe(true);
    expect(c.service).toBe('checkout');
  });

  it('rejects an empty service', () => {
    expect(() => defineContract({ ...base, service: '' })).toThrowError(/service/);
  });

  it('rejects a non-semver version', () => {
    expect(() => defineContract({ ...base, version: 'v1' })).toThrowError(/semver/);
  });

  it('rejects an unknown attribute type', () => {
    expect(() =>
      defineContract({
        ...base,
        spans: { 'x.y': { attributes: { k: { type: 'uuid' as never } } } },
      }),
    ).toThrow();
  });
});

describe('resolveAttributeSpec', () => {
  it('prefers span-specific over common attributes', () => {
    expect(resolveAttributeSpec(base, 'checkout.charge', 'payment.provider')?.required).toBe(true);
    expect(resolveAttributeSpec(base, 'checkout.charge', 'user.id')?.highCardinality).toBe(true);
    expect(resolveAttributeSpec(base, 'checkout.charge', 'nope')).toBeUndefined();
  });
});

describe('allowsAdditionalAttributes', () => {
  it('defaults to false (declared-only)', () => {
    expect(allowsAdditionalAttributes(base, 'checkout.charge')).toBe(false);
  });
  it('honors span- then contract-level overrides', () => {
    const loose = { ...base, additionalAttributes: true };
    expect(allowsAdditionalAttributes(loose, 'checkout.charge')).toBe(true);
  });
});
