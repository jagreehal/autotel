import { describe, expect, it } from 'vitest';
import { normalizeLedgerRecord } from './ledger-normalize.js';
import { AUDIT_MATRIX_SPEC, LEDGER_ENTRY_SPEC } from './types.js';

describe('normalizeLedgerRecord', () => {
  it('accepts a current v0.2 interaction entry unchanged', () => {
    const result = normalizeLedgerRecord({
      type: 'interaction',
      spec: LEDGER_ENTRY_SPEC,
      consumer: 'A',
      provider: 'B',
      interaction: 'evt',
      states: ['ready'],
      kind: 'message',
      outcome: 'passed',
      source: 'test',
      role: 'consumer',
      duration_ms: 12,
      observed_at: '2026-05-28T00:00:00Z',
    });
    expect(result).toMatchObject({
      type: 'interaction',
      spec: LEDGER_ENTRY_SPEC,
      source: 'test',
      role: 'consumer',
      kind: 'message',
    });
  });

  it('rejects v0.1 spec strings (legacy support removed)', () => {
    expect(
      normalizeLedgerRecord({
        spec: 'autotel-pact-ledger-entry/v0.1.0',
        consumer: 'A',
        provider: 'B',
        interaction: 'evt',
        kind: 'message',
        outcome: 'passed',
        duration_ms: 0,
        observed_at: '2026-05-28T00:00:00Z',
      }),
    ).toBeNull();
  });

  it('rejects schema_version: 1 legacy rows', () => {
    expect(
      normalizeLedgerRecord({
        schema_version: 1,
        consumer: 'A',
        provider: 'B',
        interaction: 'evt',
        observed_at: '2026-05-28T00:00:00Z',
      }),
    ).toBeNull();
  });

  it('defaults missing states to [] and missing duration_ms to 0', () => {
    const result = normalizeLedgerRecord({
      spec: LEDGER_ENTRY_SPEC,
      consumer: 'A',
      provider: 'B',
      interaction: 'evt',
      outcome: 'passed',
      observed_at: '2026-05-28T00:00:00Z',
    });
    expect(result).not.toBeNull();
    if (result && result.type !== 'provider_verification_run') {
      expect(result.states).toEqual([]);
      expect(result.duration_ms).toBe(0);
      expect(result.kind).toBe('message');
    }
  });

  it('rejects unknown spec strings', () => {
    expect(
      normalizeLedgerRecord({
        spec: 'autotel-pact-ledger-entry/v9.9.9',
        consumer: 'A',
        provider: 'B',
        interaction: 'evt',
      }),
    ).toBeNull();
  });

  it('rejects entries with missing required fields', () => {
    expect(
      normalizeLedgerRecord({
        spec: LEDGER_ENTRY_SPEC,
        consumer: 'A',
        // provider missing
        interaction: 'evt',
      }),
    ).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(normalizeLedgerRecord(null)).toBeNull();
    expect(normalizeLedgerRecord('string')).toBeNull();
    expect(normalizeLedgerRecord(42)).toBeNull();
  });

  it('preserves a provider_verification_run entry', () => {
    const result = normalizeLedgerRecord({
      type: 'provider_verification_run',
      spec: LEDGER_ENTRY_SPEC,
      consumer: 'A',
      provider: 'B',
      error: 'verifier crashed',
      observed_at: '2026-05-28T00:00:00Z',
    });
    expect(result).toMatchObject({
      type: 'provider_verification_run',
      outcome: 'failed',
      role: 'provider',
      error: 'verifier crashed',
    });
  });

  it('rejects provider_verification_run with missing error', () => {
    expect(
      normalizeLedgerRecord({
        type: 'provider_verification_run',
        spec: LEDGER_ENTRY_SPEC,
        consumer: 'A',
        provider: 'B',
        observed_at: '2026-05-28T00:00:00Z',
      }),
    ).toBeNull();
  });

  it('does not migrate spec when audit-matrix spec given (rejects)', () => {
    expect(
      normalizeLedgerRecord({
        spec: AUDIT_MATRIX_SPEC,
        consumer: 'A',
        provider: 'B',
        interaction: 'evt',
      }),
    ).toBeNull();
  });
});
