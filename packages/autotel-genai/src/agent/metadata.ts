import { AGENT_AUDIT_SCHEMA_VERSION } from './constants.js';
import { hashPayload } from './hash.js';
import type {
  AgentActionMetadata,
  AgentDecisionMetadata,
  AgentEventKind,
  GovernanceMetadata,
  ToolCallMetadata,
} from './types.js';

interface AuditMetadataLike {
  action: string;
  resource?: string;
  actorId?: string;
  category?: string;
  outcome?: string;
  [key: string]: unknown;
}

export function defaultEventKind(
  metadata: AgentActionMetadata,
): AgentEventKind {
  if (metadata.eventKind) return metadata.eventKind;
  if (metadata.tool) return 'tool_call';
  if (metadata.policy) return 'policy_decision';
  return 'action';
}

export function normalizeTool(
  tool?: ToolCallMetadata,
): ToolCallMetadata | undefined {
  if (!tool) return undefined;

  return {
    name: tool.name,
    ...(tool.callId !== undefined && { callId: tool.callId }),
    inputHash:
      tool.input === undefined
        ? tool.inputHash
        : (tool.inputHash ?? hashPayload(tool.input)),
    outputHash:
      tool.output === undefined
        ? tool.outputHash
        : (tool.outputHash ?? hashPayload(tool.output)),
    ...(tool.status !== undefined && { status: tool.status }),
    ...(tool.executionMs !== undefined && { executionMs: tool.executionMs }),
  };
}

export function sanitizeTool(
  tool?: ToolCallMetadata,
): ToolCallMetadata | undefined {
  if (!tool) return undefined;

  return {
    name: tool.name,
    ...(tool.callId !== undefined && { callId: tool.callId }),
    ...(tool.inputHash !== undefined && { inputHash: tool.inputHash }),
    ...(tool.outputHash !== undefined && { outputHash: tool.outputHash }),
    ...(tool.status !== undefined && { status: tool.status }),
    ...(tool.executionMs !== undefined && { executionMs: tool.executionMs }),
  };
}

export function sanitizeGovernance(
  governance?: GovernanceMetadata,
): GovernanceMetadata | undefined {
  if (!governance) return undefined;
  return {
    ...(governance.reviewRequired !== undefined && {
      reviewRequired: governance.reviewRequired,
    }),
    ...(governance.reviewerId !== undefined && {
      reviewerId: governance.reviewerId,
    }),
    ...(governance.controlId !== undefined && {
      controlId: governance.controlId,
    }),
    ...(governance.documentationUrl !== undefined && {
      documentationUrl: governance.documentationUrl,
    }),
    ...(governance.lifecycleStage !== undefined && {
      lifecycleStage: governance.lifecycleStage,
    }),
    ...(governance.framework !== undefined && {
      framework: governance.framework,
    }),
  };
}

function normalizeDecision(
  decision?: AgentDecisionMetadata,
  reasoningSummary?: string,
): AgentDecisionMetadata | undefined {
  if (decision) {
    return {
      ...decision,
      summary: decision.summary ?? reasoningSummary ?? '',
    };
  }

  if (reasoningSummary === undefined) return undefined;

  return {
    summary: reasoningSummary,
  };
}

export function createAgentAuditMetadata(
  metadata: AgentActionMetadata,
): AgentActionMetadata {
  const eventKind = defaultEventKind(metadata);

  if (eventKind === 'tool_call' && !metadata.tool) {
    throw new Error(
      '[autotel-genai] eventKind "tool_call" requires metadata.tool.',
    );
  }

  if (eventKind === 'policy_decision' && !metadata.policy) {
    throw new Error(
      '[autotel-genai] eventKind "policy_decision" requires metadata.policy.',
    );
  }

  if (eventKind === 'handoff' && !metadata.delegation) {
    throw new Error(
      '[autotel-genai] eventKind "handoff" requires metadata.delegation.',
    );
  }

  const delegation =
    metadata.delegation &&
    (
      metadata.delegation.authorityLineageHash === undefined ||
      metadata.delegation.depth === undefined
    )
      ? {
          ...metadata.delegation,
          ...(metadata.delegation.authorityLineage && {
            authorityLineageHash:
              metadata.delegation.authorityLineageHash ??
              hashPayload(metadata.delegation.authorityLineage),
            depth:
              metadata.delegation.depth ??
              Math.max(metadata.delegation.authorityLineage.length - 1, 0),
          }),
        }
      : metadata.delegation;

  return {
    ...metadata,
    schemaVersion: metadata.schemaVersion ?? AGENT_AUDIT_SCHEMA_VERSION,
    eventKind,
    decision: normalizeDecision(metadata.decision, metadata.reasoningSummary),
    ...(delegation !== undefined && { delegation }),
  };
}

export function normalizeMetadata(
  metadata: AgentActionMetadata,
): AgentActionMetadata {
  const normalized = createAgentAuditMetadata(metadata);
  return {
    ...normalized,
    tool: normalizeTool(normalized.tool),
  };
}

export function buildAuditMetadata(
  metadata: AgentActionMetadata,
): AuditMetadataLike {
  return {
    action: metadata.action,
    ...(metadata.resource !== undefined && { resource: metadata.resource }),
    actorId:
      metadata.actorId ??
      metadata.delegation?.parentIdentity ??
      metadata.agent.id,
    category: metadata.category ?? 'agent',
    ...(metadata.outcome !== undefined && { outcome: metadata.outcome }),
    agentId: metadata.agent.id,
    agentEventKind: metadata.eventKind,
    agentAuditVersion: metadata.schemaVersion,
    ...(metadata.agent.version !== undefined && {
      agentVersion: metadata.agent.version,
    }),
    ...(metadata.tool?.name !== undefined && { toolName: metadata.tool.name }),
    ...(metadata.policy?.decision !== undefined && {
      policyDecision: metadata.policy.decision,
    }),
    ...(metadata.session?.status !== undefined && {
      sessionStatus: metadata.session.status,
    }),
  };
}

export function buildLoggerContext(
  metadata: AgentActionMetadata,
): Record<string, unknown> {
  const tool = sanitizeTool(metadata.tool);
  const governance = sanitizeGovernance(metadata.governance);

  const context: Record<string, unknown> = {
    agent: {
      ...metadata.agent,
      ...(metadata.resource !== undefined && { resource: metadata.resource }),
      ...(metadata.outcome !== undefined && { outcome: metadata.outcome }),
      ...(metadata.reasoningSummary !== undefined && {
        reasoningSummary: metadata.reasoningSummary,
      }),
      schemaVersion: metadata.schemaVersion ?? AGENT_AUDIT_SCHEMA_VERSION,
      eventKind: metadata.eventKind ?? defaultEventKind(metadata),
    },
    ...(metadata.delegation !== undefined && {
      delegation: metadata.delegation,
    }),
    ...(tool !== undefined && { tool }),
    ...(metadata.policy !== undefined && { policy: metadata.policy }),
    ...(governance !== undefined && { governance }),
    ...(metadata.session !== undefined && { session: metadata.session }),
    ...(metadata.decision !== undefined && { decision: metadata.decision }),
  };

  // Hand the request logger an independent copy. `logger.set()` deep-merges and
  // intentionally *concatenates* array fields across calls (autotel wide-event
  // semantics). Agent lifecycles call `.set()` more than once per action with
  // the same `delegation`/`decision` objects, so sharing references would let
  // the merge mutate arrays (e.g. `authority_lineage`) in place — which would
  // then leak onto the span via `setAgentAttributes`. Cloning keeps the
  // span-bound metadata pristine.
  return structuredClone(context);
}

/**
 * Context for the *completion* `logger.set()` of a specialized lifecycle
 * wrapper. Carries only the domain state that finished mutating — tool or
 * session status. Outcome is owned by `withAgentAction`, which wraps every
 * variant and stamps it on both span and log. This deliberately omits the
 * request-level `delegation`/`decision` blocks: those were set once at the
 * start, and re-sending them would concatenate their array fields into the
 * wide event (see `buildLoggerContext`).
 */
export function buildLifecycleUpdateContext(
  metadata: AgentActionMetadata,
): Record<string, unknown> {
  const tool = sanitizeTool(metadata.tool);
  return {
    ...(tool !== undefined && { tool }),
    ...(metadata.session !== undefined && {
      session: structuredClone(metadata.session),
    }),
  };
}
