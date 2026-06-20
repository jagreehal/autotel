import { createStructuredError } from 'autotel';
import { securityEvent } from 'autotel-audit';
import { sanitizeAuditPayload, type PrivacyProfileInput } from './privacy.js';
import { recordDecisionBasis, recordPolicyDecision, withAgentToolCall } from './runtime.js';
import { hashPayload } from './hash.js';
import type {
  AgentActionOptions,
  AgentDecisionMetadata,
  AgentHandler,
  AgentToolCallOptions,
  DelegationContext,
  GovernanceMetadata,
  PolicyMetadata,
  ScopedToolDefinition,
} from './types.js';

function normalizeScopes(scope?: string | string[]): string[] {
  if (!scope) return [];
  return Array.isArray(scope) ? scope : [scope];
}

function missingScopes(
  delegated: string[],
  required: string[],
): string[] {
  return required.filter((scope) => !delegated.includes(scope));
}

interface ScopeDenial {
  scopes: string[];
  reason: string;
  why: string;
}

/**
 * Decide whether a scoped tool call must be denied.
 *
 * When the identity is registry-backed, the registry is authoritative: a
 * delegation may only *narrow* the stored grant, never widen it. Scopes a
 * caller claims that the registry never granted are a forged escalation and are
 * denied before any missing-scope check — otherwise passing an explicit
 * `delegation.scope` could grant access the registry record does not allow.
 */
function resolveScopeDenial(
  claimedScopes: string[],
  requiredScopes: string[],
  registryScopes: string[] | undefined,
): ScopeDenial | undefined {
  const unauthorized = registryScopes
    ? claimedScopes.filter((scope) => !registryScopes.includes(scope))
    : [];
  if (unauthorized.length > 0) {
    return {
      scopes: unauthorized,
      reason: `unauthorized_scope:${unauthorized.join(',')}`,
      why: `Delegation claims scopes the identity was never granted: ${unauthorized.join(', ')}`,
    };
  }

  const missing = missingScopes(claimedScopes, requiredScopes);
  if (missing.length > 0) {
    return {
      scopes: missing,
      reason: `missing_scope:${missing.join(',')}`,
      why: `Missing delegated scopes: ${missing.join(', ')}`,
    };
  }

  return undefined;
}

function resolveDelegation(
  definition: Pick<ScopedToolDefinition<unknown>, 'agent' | 'delegation' | 'identityRegistry'>,
): DelegationContext | undefined {
  const registry = definition.identityRegistry;
  if (registry) {
    registry.assertUsable(definition.agent.id);
  }

  return definition.delegation;
}

function buildGovernance(
  governance: GovernanceMetadata | undefined,
  reviewRequired: boolean | undefined,
): GovernanceMetadata | undefined {
  if (!governance && reviewRequired === undefined) return governance;
  return {
    ...governance,
    ...(reviewRequired !== undefined && { reviewRequired }),
  };
}

function buildDecision(
  input: unknown,
  decision: AgentDecisionMetadata | undefined,
  privacyProfile: PrivacyProfileInput | undefined,
): AgentDecisionMetadata | undefined {
  if (!decision) return undefined;

  const sanitizedInput = sanitizeAuditPayload(input, privacyProfile ?? 'strict');
  return {
    ...decision,
    inputHash: decision.inputHash ?? hashPayload(sanitizedInput),
  };
}

export async function withScopedTool<TInput, TOutput>(
  definition: ScopedToolDefinition<TInput>,
  input: TInput,
  fn: AgentHandler<TOutput>,
  options: AgentToolCallOptions & AgentActionOptions = {},
): Promise<TOutput> {
  const requiredScopes = definition.requiredScopes ?? [];
  const delegation = resolveDelegation(definition);
  const registryScopes = definition.identityRegistry?.getIdentity(
    definition.agent.id,
  )?.scopes;
  const claimedScopes = normalizeScopes(delegation?.scope ?? registryScopes);
  const denial = resolveScopeDenial(
    claimedScopes,
    requiredScopes,
    registryScopes,
  );
  const policy: PolicyMetadata | undefined =
    definition.policyId || definition.riskScore !== undefined || denial
      ? {
          decision: denial ? 'deny' : 'permit',
          ...(definition.policyId !== undefined && {
            policyId: definition.policyId,
          }),
          ...(definition.riskScore !== undefined && {
            riskScore: definition.riskScore,
          }),
          ...(denial && { reason: denial.reason }),
        }
      : undefined;

  const governance = buildGovernance(
    definition.governance,
    definition.reviewRequired,
  );

  if (policy && policy.decision === 'deny' && denial) {
    recordPolicyDecision(
      {
        action: definition.action,
        resource: definition.resource ?? definition.tool.name,
        category: definition.category,
        agent: definition.agent,
        delegation,
        policy,
        governance,
        decision: buildDecision(
          input,
          definition.decision,
          definition.privacyProfile,
        ),
      },
      options,
    );

    securityEvent(
      {
        name: 'llm.tool_call.denied',
        category: 'llm',
        outcome: 'denied',
        severity: 'warning',
        reason: denial.reason,
        targetType: 'tool',
        targetId: definition.tool.name,
        policyId: definition.policyId,
      },
      { ctx: options.ctx, onMissingContext: options.onMissingContext ?? 'warn' },
    );

    throw createStructuredError({
      status: 403,
      code: 'AGENT_SCOPE_DENIED',
      message: `Agent "${definition.agent.id}" cannot invoke ${definition.tool.name}.`,
      why: denial.why,
      fix: 'Grant the missing scopes or route the task to an agent with the required delegation.',
    });
  }

  if (policy) {
    recordPolicyDecision(
      {
        action: `${definition.action}.policy`,
        resource: definition.resource ?? definition.tool.name,
        category: definition.category,
        agent: definition.agent,
        delegation,
        policy,
        governance,
      },
      options,
    );
  }

  if (definition.decision) {
    recordDecisionBasis(
      {
        action: `${definition.action}.decision`,
        resource: definition.resource ?? definition.tool.name,
        category: definition.category,
        agent: definition.agent,
        delegation,
        governance,
        decision: buildDecision(
          input,
          definition.decision,
          definition.privacyProfile,
        ),
      },
      options,
    );
  }

  return withAgentToolCall(
    {
      action: definition.action,
      resource: definition.resource ?? definition.tool.name,
      category: definition.category,
      agent: definition.agent,
      delegation,
      governance,
      tool: {
        ...definition.tool,
        input,
      },
    },
    fn,
    options,
  );
}
