import { AGENT_AUDIT_SCHEMA_VERSION } from './constants.js';
import { canonicalizeForHash, hashPayload } from './hash.js';
import { normalizeMetadata } from './metadata.js';
import { sanitizeAuditPayload, type PrivacyProfileInput } from './privacy.js';
import type {
  AgentActionMetadata,
  AgentAuditEventEnvelope,
} from './types.js';

function toIsoString(value?: string | Date): string {
  if (!value) return new Date().toISOString();
  return value instanceof Date ? value.toISOString() : value;
}

export interface CreateSignedEventEnvelopeOptions {
  emittedAt?: string | Date;
  previousEventHash?: string;
  evidence?: unknown;
  privacyProfile?: PrivacyProfileInput;
  signer?: (serialized: string) => string | Promise<string>;
}

export async function createSignedEventEnvelope(
  metadata: AgentActionMetadata,
  options: CreateSignedEventEnvelopeOptions = {},
): Promise<AgentAuditEventEnvelope> {
  const normalized = normalizeMetadata(metadata);
  const envelopeBase = {
    schemaVersion: normalized.schemaVersion ?? AGENT_AUDIT_SCHEMA_VERSION,
    emittedAt: toIsoString(options.emittedAt),
    ...(options.previousEventHash !== undefined && {
      previousEventHash: options.previousEventHash,
    }),
    metadata: normalized,
    ...(options.evidence !== undefined && {
      evidence: sanitizeAuditPayload(
        options.evidence,
        options.privacyProfile ?? 'strict',
      ),
    }),
  };

  const eventHash = hashPayload(envelopeBase);
  const signature = options.signer
    ? await options.signer(canonicalizeForHash(envelopeBase))
    : undefined;

  return {
    ...envelopeBase,
    eventHash,
    ...(signature !== undefined && { signature }),
  };
}

export function verifyEventEnvelopeHash(
  envelope: AgentAuditEventEnvelope,
): boolean {
  const expected = hashPayload({
    schemaVersion: envelope.schemaVersion,
    emittedAt: envelope.emittedAt,
    ...(envelope.previousEventHash !== undefined && {
      previousEventHash: envelope.previousEventHash,
    }),
    metadata: envelope.metadata,
    ...(envelope.evidence !== undefined && {
      evidence: envelope.evidence,
    }),
  });
  return envelope.eventHash === expected;
}
