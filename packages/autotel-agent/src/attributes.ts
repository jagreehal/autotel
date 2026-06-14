import { AGENT_AUDIT_SCHEMA_VERSION } from './constants.js';
import { resolveContext, toAttributeValue, type AgentContext } from './context.js';
import { defaultEventKind, normalizeMetadata } from './metadata.js';
import type {
  AgentActionMetadata,
  AgentDecisionMetadata,
  AgentIdentity,
  AgentSessionMetadata,
  DelegationContext,
  GovernanceMetadata,
  PolicyMetadata,
  ToolCallMetadata,
} from './types.js';

type AttributeValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
  | boolean[];

type AttributeMap = Record<string, AttributeValue>;

function setIfPresent(target: AttributeMap, key: string, value: unknown): void {
  const attr = toAttributeValue(value);
  if (attr !== undefined) {
    target[key] = attr;
  }
}

function appendIdentityAttributes(attrs: AttributeMap, agent: AgentIdentity): void {
  setIfPresent(attrs, 'agent.id', agent.id);
  setIfPresent(attrs, 'agent.version', agent.version);
  setIfPresent(attrs, 'agent.framework', agent.framework);
  setIfPresent(attrs, 'agent.model', agent.model);
  setIfPresent(attrs, 'agent.role', agent.role);
  setIfPresent(attrs, 'agent.session.id', agent.sessionId);
  setIfPresent(attrs, 'agent.conversation.id', agent.conversationId);
}

function appendDelegationAttributes(
  attrs: AttributeMap,
  delegation?: DelegationContext,
): void {
  if (!delegation) return;
  setIfPresent(attrs, 'delegation.parent_identity', delegation.parentIdentity);
  setIfPresent(attrs, 'delegation.scope', delegation.scope);
  setIfPresent(attrs, 'delegation.token_id', delegation.tokenId);
  setIfPresent(attrs, 'delegation.id', delegation.delegationId);
  setIfPresent(attrs, 'delegation.authority_lineage', delegation.authorityLineage);
  setIfPresent(
    attrs,
    'delegation.authority_lineage_hash',
    delegation.authorityLineageHash,
  );
  setIfPresent(attrs, 'delegation.depth', delegation.depth);
  setIfPresent(attrs, 'delegation.issued_at', delegation.issuedAt);
  setIfPresent(attrs, 'delegation.expires_at', delegation.expiresAt);
}

function appendToolAttributes(attrs: AttributeMap, tool?: ToolCallMetadata): void {
  if (!tool) return;
  setIfPresent(attrs, 'tool.name', tool.name);
  setIfPresent(attrs, 'tool.call.id', tool.callId);
  setIfPresent(attrs, 'tool.input_hash', tool.inputHash);
  setIfPresent(attrs, 'tool.output_hash', tool.outputHash);
  setIfPresent(attrs, 'tool.status', tool.status);
  setIfPresent(attrs, 'tool.execution_ms', tool.executionMs);
}

function appendPolicyAttributes(attrs: AttributeMap, policy?: PolicyMetadata): void {
  if (!policy) return;
  setIfPresent(attrs, 'policy.decision', policy.decision);
  setIfPresent(attrs, 'policy.id', policy.policyId);
  setIfPresent(attrs, 'policy.risk_score', policy.riskScore);
  setIfPresent(attrs, 'policy.reason', policy.reason);
}

function appendGovernanceAttributes(
  attrs: AttributeMap,
  governance?: GovernanceMetadata,
): void {
  if (!governance) return;
  setIfPresent(attrs, 'governance.review_required', governance.reviewRequired);
  setIfPresent(attrs, 'governance.reviewer_id', governance.reviewerId);
  setIfPresent(attrs, 'governance.control_id', governance.controlId);
  setIfPresent(attrs, 'governance.documentation_url', governance.documentationUrl);
  setIfPresent(attrs, 'governance.lifecycle_stage', governance.lifecycleStage);
  setIfPresent(attrs, 'governance.framework', governance.framework);
}

function appendSessionAttributes(
  attrs: AttributeMap,
  session?: AgentSessionMetadata,
): void {
  if (!session) return;
  setIfPresent(attrs, 'agent.session.status', session.status);
  setIfPresent(attrs, 'agent.session.started_at', session.startedAt);
  setIfPresent(attrs, 'agent.session.ended_at', session.endedAt);
  setIfPresent(attrs, 'agent.session.delegated_by', session.delegatedBy);
}

function appendDecisionAttributes(
  attrs: AttributeMap,
  decision?: AgentDecisionMetadata,
): void {
  if (!decision) return;
  setIfPresent(attrs, 'decision.summary', decision.summary);
  setIfPresent(attrs, 'decision.input_hash', decision.inputHash);
  setIfPresent(attrs, 'decision.policy_ids', decision.policyIds);
  setIfPresent(attrs, 'decision.justification_codes', decision.justificationCodes);
  setIfPresent(attrs, 'decision.evidence_ids', decision.evidenceIds);
  setIfPresent(attrs, 'decision.review_required', decision.reviewRequired);
  setIfPresent(attrs, 'decision.confidence', decision.confidence);
}

export function flattenAgentAttributes(
  metadata: AgentActionMetadata,
): AttributeMap {
  const normalized = normalizeMetadata(metadata);
  const attrs: AttributeMap = {
    'autotel.agent': true,
    'agent.action': normalized.action,
    'agent.audit.version':
      normalized.schemaVersion ?? AGENT_AUDIT_SCHEMA_VERSION,
    'agent.event.kind': normalized.eventKind ?? defaultEventKind(normalized),
  };

  setIfPresent(attrs, 'agent.resource', normalized.resource);
  setIfPresent(attrs, 'agent.outcome', normalized.outcome);
  setIfPresent(attrs, 'reasoning.summary', normalized.reasoningSummary);
  appendIdentityAttributes(attrs, normalized.agent);
  appendDelegationAttributes(attrs, normalized.delegation);
  appendToolAttributes(attrs, normalized.tool);
  appendPolicyAttributes(attrs, normalized.policy);
  appendGovernanceAttributes(attrs, normalized.governance);
  appendSessionAttributes(attrs, normalized.session);
  appendDecisionAttributes(attrs, normalized.decision);

  return attrs;
}

export function setAgentAttributes(
  metadata: AgentActionMetadata,
  ctx?: AgentContext,
): void {
  const traceCtx = resolveContext(ctx);
  traceCtx.setAttributes(flattenAgentAttributes(metadata));
}

/**
 * Stamp only the terminal outcome on the active span. Used by lifecycle
 * wrappers on completion so they don't re-flatten (and clobber) richer state a
 * nested step already wrote — e.g. a tool call's `tool.status=complete`.
 */
export function setAgentOutcome(
  outcome: AgentActionMetadata['outcome'] & string,
  ctx?: AgentContext,
): void {
  resolveContext(ctx).setAttribute('agent.outcome', outcome);
}
