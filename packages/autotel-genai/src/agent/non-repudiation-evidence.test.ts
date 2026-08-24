import { describe, expect, it } from 'vitest';
import {
  createSignedEventEnvelope,
  verifyEventEnvelopeHash,
} from './non-repudiation.js';
import type { AgentActionMetadata, AgentAuditEventEnvelope } from './types.js';

const metadata = {
  agent: { id: 'agent-1', name: 'planner' },
  action: 'tool_call',
} as unknown as AgentActionMetadata;

describe('createSignedEventEnvelope sanitization reporting', () => {
  it('records what sanitising the evidence removed', async () => {
    // An intact hash chain proves the record was not edited. It says nothing
    // about what the record never contained — that is what these counts say.
    const envelope = await createSignedEventEnvelope(metadata, {
      emittedAt: '2026-08-24T00:00:00.000Z',
      evidence: { apiKey: 'sk-live-1', email: 'a@b.com' },
    });

    expect(envelope.sanitization).toEqual({
      redacted: 1,
      hashed: 1,
      masked: 0,
      truncated: 0,
    });
  });

  it('omits the report when there is no evidence payload to sanitise', async () => {
    const envelope = await createSignedEventEnvelope(metadata, {
      emittedAt: '2026-08-24T00:00:00.000Z',
    });

    expect(envelope.sanitization).toBeUndefined();
  });

  it('covers the report with the event hash', async () => {
    // A count a verifier cannot check is a claim, not evidence: anyone could
    // rewrite "2 secrets redacted" to "0" and the chain would still verify.
    const envelope = await createSignedEventEnvelope(metadata, {
      emittedAt: '2026-08-24T00:00:00.000Z',
      evidence: { apiKey: 'sk-live-1' },
    });

    expect(verifyEventEnvelopeHash(envelope)).toBe(true);

    const tampered: AgentAuditEventEnvelope = {
      ...envelope,
      sanitization: { redacted: 0, hashed: 0, masked: 0, truncated: 0 },
    };
    expect(verifyEventEnvelopeHash(tampered)).toBe(false);
  });

  it('still verifies an envelope written before sanitization was reported', async () => {
    const envelope = await createSignedEventEnvelope(metadata, {
      emittedAt: '2026-08-24T00:00:00.000Z',
    });
    const legacy: AgentAuditEventEnvelope = { ...envelope };
    delete legacy.sanitization;

    expect(verifyEventEnvelopeHash(legacy)).toBe(true);
  });
});
