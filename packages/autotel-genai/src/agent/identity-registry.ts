import { hashPayload } from './hash.js';
import { delegateToAgent } from './delegation.js';
import type {
  AgentIdentity,
  AgentIdentityRegistry,
  AgentIdentityRecord,
  AgentIdentityStatus,
  DelegationContext,
} from './types.js';

function toIsoString(value?: string | Date): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeScopes(scope?: string | string[]): string[] {
  if (!scope) return [];
  return Array.isArray(scope) ? [...scope] : [scope];
}

function isExpired(record: AgentIdentityRecord, at: string): boolean {
  return record.expiresAt !== undefined && record.expiresAt < at;
}

export interface ProvisionAgentIdentityInput {
  agent: AgentIdentity;
  scopes?: string[];
  tokenId?: string;
  delegatedBy?: string;
  provisionedAt?: string | Date;
  expiresAt?: string | Date;
  metadata?: Record<string, unknown>;
}

export interface RotateAgentIdentityInput {
  scopes?: string[];
  tokenId?: string;
  delegatedBy?: string;
  rotatedAt?: string | Date;
  expiresAt?: string | Date;
  metadata?: Record<string, unknown>;
}

export interface RevokeAgentIdentityInput {
  reason: string;
  revokedAt?: string | Date;
}

export function createAgentIdentityRegistry(
  initial: ProvisionAgentIdentityInput[] = [],
): AgentIdentityRegistry {
  const records = new Map<string, AgentIdentityRecord>();

  const provisionIdentity = (
    input: ProvisionAgentIdentityInput,
  ): AgentIdentityRecord => {
    const now = toIsoString(input.provisionedAt) ?? new Date().toISOString();
    const record: AgentIdentityRecord = {
      agent: input.agent,
      scopes: input.scopes ?? [],
      status: 'active',
      tokenId: input.tokenId,
      tokenHash:
        input.tokenId === undefined ? undefined : hashPayload(input.tokenId),
      delegatedBy: input.delegatedBy,
      provisionedAt: now,
      expiresAt: toIsoString(input.expiresAt),
      metadata: input.metadata,
    };
    records.set(input.agent.id, record);
    return record;
  };

  for (const item of initial) {
    provisionIdentity(item);
  }

  return {
    provisionIdentity,
    rotateIdentity(agentId: string, input: RotateAgentIdentityInput = {}) {
      const existing = records.get(agentId);
      if (!existing) {
        throw new Error(
          `[autotel-genai] Cannot rotate unknown agent identity "${agentId}".`,
        );
      }

      const rotatedAt = toIsoString(input.rotatedAt) ?? new Date().toISOString();
      const record: AgentIdentityRecord = {
        ...existing,
        scopes: input.scopes ?? existing.scopes,
        status: 'rotated',
        tokenId: input.tokenId ?? existing.tokenId,
        tokenHash:
          input.tokenId === undefined
            ? existing.tokenHash
            : hashPayload(input.tokenId),
        delegatedBy: input.delegatedBy ?? existing.delegatedBy,
        rotatedAt,
        expiresAt: toIsoString(input.expiresAt) ?? existing.expiresAt,
        metadata: input.metadata ?? existing.metadata,
      };
      records.set(agentId, record);
      return record;
    },
    revokeIdentity(agentId: string, input: RevokeAgentIdentityInput) {
      const existing = records.get(agentId);
      if (!existing) {
        throw new Error(
          `[autotel-genai] Cannot revoke unknown agent identity "${agentId}".`,
        );
      }

      const revokedAt = toIsoString(input.revokedAt) ?? new Date().toISOString();
      const record: AgentIdentityRecord = {
        ...existing,
        status: 'revoked',
        revokedAt,
        revocationReason: input.reason,
      };
      records.set(agentId, record);
      return record;
    },
    getIdentity(agentId: string) {
      return records.get(agentId);
    },
    getIdentityStatus(agentId: string, at = new Date().toISOString()) {
      const record = records.get(agentId);
      if (!record) return;
      return isExpired(record, at) ? 'expired' : record.status;
    },
    assertUsable(agentId: string, at = new Date().toISOString()) {
      const record = records.get(agentId);
      if (!record) {
        throw new Error(
          `[autotel-genai] Unknown agent identity "${agentId}". Provision it before use.`,
        );
      }

      const status: AgentIdentityStatus = isExpired(record, at)
        ? 'expired'
        : record.status;

      if (status !== 'active' && status !== 'rotated') {
        throw new Error(
          `[autotel-genai] Agent identity "${agentId}" is ${status} and cannot execute delegated work.`,
        );
      }

      return record;
    },
    assertScopes(agentId: string, requiredScopes: string[]) {
      const record = this.assertUsable(agentId);
      const missing = requiredScopes.filter(
        (scope) => !record.scopes.includes(scope),
      );

      if (missing.length > 0) {
        throw new Error(
          `[autotel-genai] Agent identity "${agentId}" is missing delegated scopes: ${missing.join(', ')}.`,
        );
      }

      return record;
    },
    issueDelegation(agentId: string, input) {
      const record = this.assertUsable(agentId);
      const scope = normalizeScopes(input.scope);
      if (scope.length > 0) {
        this.assertScopes(agentId, scope);
      }

      return delegateToAgent({
        parentIdentity: input.parentIdentity,
        targetAgentId: record.agent.id,
        scope: input.scope ?? record.scopes,
        tokenId: input.tokenId ?? record.tokenId,
        delegationId: input.delegationId,
        authorityLineage: input.authorityLineage,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt ?? record.expiresAt,
      }) satisfies DelegationContext;
    },
    list() {
      return [...records.values()];
    },
  };
}
