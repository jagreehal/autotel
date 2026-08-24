import { describe, expect, it } from 'vitest';
import {
  sanitizeAuditPayload,
  sanitizeAuditPayloadWithEvidence,
} from './privacy.js';

describe('sanitizeAuditPayloadWithEvidence', () => {
  it('counts what the profile removed, hashed, masked, and cut', () => {
    // "2 secrets redacted" is the honest line next to a shared trace.
    // Without counts, a sanitised payload and an empty one look the same.
    const { evidence } = sanitizeAuditPayloadWithEvidence({
      apiKey: 'sk-live-123',
      password: 'hunter2',
      email: 'a@b.com',
      name: 'Ada Lovelace',
      note: 'x'.repeat(500),
    });

    expect(evidence).toEqual({
      redacted: 2,
      hashed: 1,
      masked: 1,
      truncated: 1,
    });
  });

  it('reports all-zero counts when nothing was touched', () => {
    const { value, evidence } = sanitizeAuditPayloadWithEvidence({
      status: 'ok',
      attempts: 3,
    });

    expect(value).toEqual({ status: 'ok', attempts: 3 });
    expect(evidence).toEqual({
      redacted: 0,
      hashed: 0,
      masked: 0,
      truncated: 0,
    });
  });

  it('counts nested and array members, not just top-level keys', () => {
    const { evidence } = sanitizeAuditPayloadWithEvidence({
      calls: [{ token: 'a' }, { token: 'b' }],
    });

    expect(evidence.redacted).toBe(2);
  });

  it('returns the same sanitised value as sanitizeAuditPayload', () => {
    const payload = { secret: 's', email: 'a@b.com', keep: 1 };
    expect(sanitizeAuditPayloadWithEvidence(payload).value).toEqual(
      sanitizeAuditPayload(payload),
    );
  });
});
