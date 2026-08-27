/**
 * Reading contract violations off a span.
 *
 * Devtools takes no dependency on `autotel-schema` for this, and should not:
 * the app owns the contract and does the validating, then writes the result
 * onto the span. All the viewer does is read three attributes, which is why
 * this works against any backend the span reaches, not just this one.
 */

import { describe, it, expect } from 'vitest';
import { schemaViolations } from './schemaViolations';
import type { SpanData } from '../types';

function span(attributes: Record<string, unknown>): SpanData {
  return {
    traceId: 'a'.repeat(32),
    spanId: 'b'.repeat(16),
    name: 'checkout.charge',
    kind: 'INTERNAL',
    startTime: 1,
    endTime: 2,
    duration: 1,
    attributes: attributes as SpanData['attributes'],
    status: { code: 'OK' },
  };
}

describe('schemaViolations', () => {
  it('reads the count, severity and codes', () => {
    const found = schemaViolations(
      span({
        'autotel.schema.violations': 2,
        'autotel.schema.violation.severity': 'error',
        'autotel.schema.violation.codes': [
          'missing_required:payment.amount_cents',
          'unknown_attribute:paymnet.provider',
        ],
      }),
    );

    expect(found).toEqual({
      count: 2,
      severity: 'error',
      codes: [
        'missing_required:payment.amount_cents',
        'unknown_attribute:paymnet.provider',
      ],
    });
  });

  it('returns null for a span that conforms', () => {
    // A conforming span carries no attribute at all, which is what makes the
    // presence of one meaningful.
    expect(schemaViolations(span({ 'payment.amount_cents': 500 }))).toBeNull();
  });

  it('reports a count it was given without codes to go with it', () => {
    // The codes list is capped at the source, so a wide span can arrive with a
    // count larger than the list. Showing the honest count beats showing none.
    const found = schemaViolations(
      span({
        'autotel.schema.violations': 40,
        'autotel.schema.violation.severity': 'error',
      }),
    );

    expect(found?.count).toBe(40);
    expect(found?.codes).toEqual([]);
  });

  it('treats an unrecognised severity as a warning rather than trusting it', () => {
    const found = schemaViolations(
      span({
        'autotel.schema.violations': 1,
        'autotel.schema.violation.severity': 'catastrophe',
      }),
    );

    expect(found?.severity).toBe('warning');
  });
});
