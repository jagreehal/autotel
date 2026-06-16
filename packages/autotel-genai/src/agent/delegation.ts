import { hashPayload } from './hash.js';
import { recordPolicyDecision } from './runtime.js';
import type {
  AgentActionOptions,
  AgentIdentity,
  DelegationContext,
  GovernanceMetadata,
} from './types.js';

function buildAuthorityLineage(
  parentIdentity: string,
  agentId: string,
  existingLineage?: string[],
): string[] {
  const lineage = existingLineage ? [...existingLineage] : [parentIdentity];
  if (lineage.at(-1) !== agentId) {
    lineage.push(agentId);
  }
  return lineage;
}

export interface DelegateToAgentInput {
  parentIdentity: string;
  targetAgentId: string;
  scope?: string | string[];
  tokenId?: string;
  delegationId?: string;
  authorityLineage?: string[];
  issuedAt?: string | Date;
  expiresAt?: string | Date;
}

export interface RecordAgentHandoffMetadata {
  action: string;
  fromAgent: AgentIdentity;
  toAgent: AgentIdentity;
  parentIdentity: string;
  resource?: string;
  scope?: string | string[];
  tokenId?: string;
  delegationId?: string;
  authorityLineage?: string[];
  governance?: GovernanceMetadata;
}

export function delegateToAgent(input: DelegateToAgentInput): DelegationContext {
  const authorityLineage = buildAuthorityLineage(
    input.parentIdentity,
    input.targetAgentId,
    input.authorityLineage,
  );

  return {
    parentIdentity: input.parentIdentity,
    ...(input.scope !== undefined && { scope: input.scope }),
    ...(input.tokenId !== undefined && { tokenId: input.tokenId }),
    ...(input.delegationId !== undefined && { delegationId: input.delegationId }),
    authorityLineage,
    authorityLineageHash: hashPayload(authorityLineage),
    depth: Math.max(authorityLineage.length - 1, 0),
    issuedAt: input.issuedAt ?? new Date().toISOString(),
    ...(input.expiresAt !== undefined && { expiresAt: input.expiresAt }),
  };
}

export function recordAgentHandoff(
  metadata: RecordAgentHandoffMetadata,
  options: AgentActionOptions = {},
): void {
  // Seed the lineage with the source agent when the caller didn't supply one,
  // so the "from" side of the handoff is recorded in the canonical, queryable
  // `delegation.authority_lineage` (and its hash) rather than surviving only in
  // the free-text reasoningSummary.
  const authorityLineage =
    metadata.authorityLineage ?? [metadata.parentIdentity, metadata.fromAgent.id];

  const delegation = delegateToAgent({
    parentIdentity: metadata.parentIdentity,
    targetAgentId: metadata.toAgent.id,
    scope: metadata.scope,
    tokenId: metadata.tokenId,
    delegationId: metadata.delegationId,
    authorityLineage,
  });

  recordPolicyDecision(
    {
      action: metadata.action,
      resource: metadata.resource,
      eventKind: 'handoff',
      agent: metadata.toAgent,
      delegation,
      governance: metadata.governance,
      reasoningSummary: `Control passed from ${metadata.fromAgent.id} to ${metadata.toAgent.id}.`,
    },
    options,
  );
}
