import { describe, expect, it } from 'vitest';

import { defineContract, type TelemetryContract } from './contract.js';
import {
  formatViolation,
  hasErrors,
  validateSpan,
} from './validate.js';

const contract: TelemetryContract = defineContract({
  service: 'checkout',
  version: '1.0.0',
  commonAttributes: { 'user.id': { type: 'string' } },
  spans: {
    'checkout.charge': {
      attributes: {
        'payment.provider': { type: 'string', required: true, enum: ['stripe', 'paypal'] },
        'payment.amount_cents': { type: 'number', required: true },
      },
    },
  },
});

describe('validateSpan', () => {
  it('passes a fully-conformant span', () => {
    const v = validateSpan(
      {
        name: 'checkout.charge',
        attributes: { 'payment.provider': 'stripe', 'payment.amount_cents': 999 },
      },
      contract,
    );
    expect(v).toEqual([]);
  });

  it('flags a missing required attribute as an error', () => {
    const v = validateSpan(
      { name: 'checkout.charge', attributes: { 'payment.provider': 'stripe' } },
      contract,
    );
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ code: 'missing_required', attribute: 'payment.amount_cents' });
    expect(hasErrors(v)).toBe(true);
  });

  it('flags a wrong type', () => {
    const v = validateSpan(
      {
        name: 'checkout.charge',
        attributes: { 'payment.provider': 'stripe', 'payment.amount_cents': '999' },
      },
      contract,
    );
    expect(v.some((x) => x.code === 'type_mismatch')).toBe(true);
  });

  it('flags an enum violation', () => {
    const v = validateSpan(
      {
        name: 'checkout.charge',
        attributes: { 'payment.provider': 'bitcoin', 'payment.amount_cents': 1 },
      },
      contract,
    );
    expect(v.some((x) => x.code === 'enum_violation')).toBe(true);
  });

  it('warns on an undeclared attribute and suggests a near key', () => {
    const v = validateSpan(
      {
        name: 'checkout.charge',
        attributes: {
          'payment.provider': 'stripe',
          'payment.amount_cents': 1,
          'payment.providr': 'x', // typo of a declared key
        },
      },
      contract,
    );
    const unknown = v.find((x) => x.code === 'unknown_attribute');
    expect(unknown?.severity).toBe('warning');
    expect(unknown?.suggestion).toBe('payment.provider');
  });

  it('ignores unknown spans unless strictSpanNames is set', () => {
    expect(validateSpan({ name: 'mystery', attributes: {} }, contract)).toEqual([]);
    const strict = validateSpan({ name: 'mystery', attributes: {} }, contract, {
      strictSpanNames: true,
    });
    expect(strict[0]?.code).toBe('unknown_span');
  });

  it('formats a violation legibly', () => {
    const v = validateSpan(
      { name: 'checkout.charge', attributes: { 'payment.provider': 'stripe' } },
      contract,
    );
    expect(formatViolation(v[0])).toMatch(/\[error\] missing_required @ checkout.charge.payment.amount_cents/);
  });
});
