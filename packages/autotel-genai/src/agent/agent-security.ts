import { hashIdentifier } from 'autotel-audit';
import { resolveContext, resolveContextSafe, toAttributeValue, type AgentContext } from './context.js';

/** Canonical agent security attribute keys (Google SAIF / human-control aligned). */
export const AGENT_SECURITY_ATTR = {
  controllerId: 'agent.controller.id',
  inputProvenance: 'agent.input.provenance',
  actionRiskClass: 'agent.action.risk_class',
  consentRequired: 'agent.consent.required',
  consentOutcome: 'agent.consent.outcome',
  scopeActive: 'agent.scope.active',
  memoryOperation: 'agent.memory.operation',
  memoryIsolationKey: 'agent.memory.isolation_key',
  memoryContentHash: 'agent.memory.content_hash',
  planStepIndex: 'agent.plan.step_index',
  planToolIntents: 'agent.plan.tool_intents',
  planPolicyIds: 'agent.plan.policy_ids',
  outputFormat: 'agent.output.format',
  outputContainsUrl: 'agent.output.contains_url',
  outputUrlCount: 'agent.output.url_count',
} as const;

export type AgentInputProvenance =
  | 'user_direct'
  | 'user_voice'
  | 'rag'
  | 'memory'
  | 'tool_result'
  | 'external_untrusted';

export type AgentActionRiskClass =
  | 'read'
  | 'write'
  | 'destructive'
  | 'financial'
  | 'exfiltration_capable';

export type AgentConsentOutcome = 'approved' | 'denied' | 'timeout' | 'revoked';

export type AgentMemoryOperation = 'read' | 'write' | 'delete' | 'search';

export type AgentOutputFormat = 'text' | 'markdown' | 'html' | 'json' | 'mixed';

export interface AgentSecurityRecordOptions {
  ctx?: AgentContext;
}

export interface RecordControllerInput extends AgentSecurityRecordOptions {
  /** Controlling human user id — hashed before emission unless already a digest. */
  controllerId: string;
  /** Pass a stable per-deployment salt to `hashIdentifier`. */
  hashSalt?: string;
  /** When false, emit the id as given (must not be raw PII). Default true. */
  hash?: boolean;
}

export interface RecordInputProvenanceInput extends AgentSecurityRecordOptions {
  provenance: AgentInputProvenance;
}

export interface RecordHumanApprovalInput extends AgentSecurityRecordOptions {
  toolCallId: string;
  toolName?: string;
  approved: boolean;
  required?: boolean;
  controllerId?: string;
  hashSalt?: string;
}

export interface RecordActiveScopesInput extends AgentSecurityRecordOptions {
  scopes: string[];
}

export interface RecordMemoryAccessInput extends AgentSecurityRecordOptions {
  operation: AgentMemoryOperation;
  isolationKey: string;
  contentHash?: string;
}

export interface RecordPlanStepInput extends AgentSecurityRecordOptions {
  stepIndex: number;
  toolIntents?: string[];
  policyIds?: string[];
  summary?: string;
}

export interface RecordRenderOutputInput extends AgentSecurityRecordOptions {
  format?: AgentOutputFormat;
  containsUrl?: boolean;
  urlCount?: number;
}

export interface ActionRiskHints {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
  untrustedContentHint?: boolean;
  financial?: boolean;
  exfiltrationCapable?: boolean;
}

function setSecurityAttr(
  ctx: AgentContext | undefined,
  key: string,
  value: unknown,
): void {
  const attr = toAttributeValue(value);
  if (attr === undefined) return;
  const traceCtx = resolveContext(ctx);
  if (Array.isArray(attr)) {
    traceCtx.setAttributes({ [key]: attr });
    return;
  }
  traceCtx.setAttribute(key, attr);
}

function setSecurityAttrs(
  ctx: AgentContext | undefined,
  attrs: Record<string, unknown>,
): void {
  const traceCtx = resolveContext(ctx);
  const mapped: Record<string, string | number | boolean | string[] | number[] | boolean[]> =
    {};
  for (const [key, value] of Object.entries(attrs)) {
    const attr = toAttributeValue(value);
    if (attr !== undefined) {
      mapped[key] = attr;
    }
  }
  if (Object.keys(mapped).length > 0) {
    traceCtx.setAttributes(mapped);
  }
}

/**
 * Derive a coarse action risk class from MCP tool hints or explicit overrides.
 */
export function deriveActionRiskClass(
  hints: ActionRiskHints,
  override?: AgentActionRiskClass,
): AgentActionRiskClass {
  if (override) return override;
  if (hints.financial) return 'financial';
  if (hints.exfiltrationCapable || hints.openWorldHint) {
    return 'exfiltration_capable';
  }
  if (hints.destructiveHint) return 'destructive';
  if (hints.readOnlyHint) return 'read';
  if (hints.untrustedContentHint) return 'read';
  return 'write';
}

export function recordControllerId(input: RecordControllerInput): void {
  const id =
    input.hash === false
      ? input.controllerId
      : hashIdentifier(input.controllerId, { salt: input.hashSalt });
  setSecurityAttr(input.ctx, AGENT_SECURITY_ATTR.controllerId, id);
}

export function recordInputProvenance(input: RecordInputProvenanceInput): void {
  setSecurityAttr(input.ctx, AGENT_SECURITY_ATTR.inputProvenance, input.provenance);
}

export function recordHumanApproval(input: RecordHumanApprovalInput): void {
  const attrs: Record<string, unknown> = {
    [AGENT_SECURITY_ATTR.consentRequired]: input.required ?? true,
    [AGENT_SECURITY_ATTR.consentOutcome]: input.approved ? 'approved' : 'denied',
    'tool.call.id': input.toolCallId,
  };
  if (input.toolName) {
    attrs['tool.name'] = input.toolName;
  }
  if (input.controllerId) {
    attrs[AGENT_SECURITY_ATTR.controllerId] = hashIdentifier(input.controllerId, {
      salt: input.hashSalt,
    });
  }
  setSecurityAttrs(input.ctx, attrs);
}

export function recordActiveScopes(input: RecordActiveScopesInput): void {
  setSecurityAttr(input.ctx, AGENT_SECURITY_ATTR.scopeActive, input.scopes);
}

export function recordActionRiskClass(
  riskClass: AgentActionRiskClass,
  options: AgentSecurityRecordOptions = {},
): void {
  setSecurityAttr(options.ctx, AGENT_SECURITY_ATTR.actionRiskClass, riskClass);
}

export function recordMemoryAccess(input: RecordMemoryAccessInput): void {
  setSecurityAttrs(input.ctx, {
    [AGENT_SECURITY_ATTR.memoryOperation]: input.operation,
    [AGENT_SECURITY_ATTR.memoryIsolationKey]: input.isolationKey,
    ...(input.contentHash !== undefined && {
      [AGENT_SECURITY_ATTR.memoryContentHash]: input.contentHash,
    }),
  });
}

export function recordPlanStep(input: RecordPlanStepInput): void {
  setSecurityAttrs(input.ctx, {
    [AGENT_SECURITY_ATTR.planStepIndex]: input.stepIndex,
    ...(input.toolIntents !== undefined && {
      [AGENT_SECURITY_ATTR.planToolIntents]: input.toolIntents,
    }),
    ...(input.policyIds !== undefined && {
      [AGENT_SECURITY_ATTR.planPolicyIds]: input.policyIds,
    }),
    ...(input.summary !== undefined && { 'decision.summary': input.summary }),
  });
}

export function recordRenderOutput(input: RecordRenderOutputInput): void {
  setSecurityAttrs(input.ctx, {
    ...(input.format !== undefined && {
      [AGENT_SECURITY_ATTR.outputFormat]: input.format,
    }),
    ...(input.containsUrl !== undefined && {
      [AGENT_SECURITY_ATTR.outputContainsUrl]: input.containsUrl,
    }),
    ...(input.urlCount !== undefined && {
      [AGENT_SECURITY_ATTR.outputUrlCount]: input.urlCount,
    }),
  });
}

/** Best-effort variant — no throw when trace context is missing. */
export function tryRecordHumanApproval(input: RecordHumanApprovalInput): boolean {
  const ctx = resolveContextSafe(input.ctx);
  if (!ctx) return false;
  recordHumanApproval({ ...input, ctx });
  return true;
}
