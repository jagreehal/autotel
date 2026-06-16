import type { RequestLogger } from 'autotel';
import type { OnMissingContext } from 'autotel-audit';
import type { ModelPricing, TokenUsage } from '../cost.js';
import type { GenAiProviderName } from '../semconv.js';
import type { AgentContext } from './context.js';

export type { OnMissingContext } from 'autotel-audit';
export type { ModelPricing, TokenUsage } from '../cost.js';

export type PolicyDecision =
  | 'permit'
  | 'deny'
  | 'challenge'
  | 'observe'
  | 'error';
export type ToolStatus = 'planned' | 'complete' | 'error' | 'blocked';
export type AgentOutcome = 'success' | 'failure';
export type AgentEventKind =
  | 'action'
  | 'tool_call'
  | 'policy_decision'
  | 'handoff';
export type AiLifecycleStage =
  | 'plan'
  | 'design'
  | 'develop'
  | 'deploy'
  | 'operate'
  | 'monitor'
  | 'decommission';
export type AgentIdentityStatus =
  | 'active'
  | 'rotated'
  | 'revoked'
  | 'expired';
export type AgentSessionStatus =
  | 'active'
  | 'completed'
  | 'failed'
  | 'revoked'
  | 'expired';
export type PrivacyProfileName = 'strict' | 'pci' | 'healthcare';

export interface AgentIdentity {
  id: string;
  version?: string;
  framework?: string;
  model?: string;
  role?: string;
  sessionId?: string;
  conversationId?: string;
}

export interface DelegationContext {
  parentIdentity: string;
  scope?: string | string[];
  tokenId?: string;
  delegationId?: string;
  authorityLineage?: string[];
  authorityLineageHash?: string;
  depth?: number;
  issuedAt?: string | Date;
  expiresAt?: string | Date;
}

export interface ToolCallMetadata {
  name: string;
  callId?: string;
  input?: unknown;
  inputHash?: string;
  output?: unknown;
  outputHash?: string;
  status?: ToolStatus;
  executionMs?: number;
}

/**
 * LLM call metadata for an agent action. When present on a tool call or action,
 * autotel-genai records canonical OpenTelemetry GenAI attributes on the span —
 * `gen_ai.request.model`, `gen_ai.usage.input_tokens` / `output_tokens`, and the
 * estimated `gen_ai.usage.cost.usd`. Token usage is usually known only after the
 * call; supply it via `usage` if known up front, or via the `extractUsage`
 * option to pull it from the handler's result.
 */
export interface AgentAiMetadata {
  /** Model id, e.g. `gpt-4o`, `claude-sonnet-4`, `@cf/meta/llama-3.1-8b-instruct-fp8`. */
  model: string;
  /**
   * `gen_ai.operation.name` — `chat` | `text_completion` | `embeddings` |
   * `invoke_agent` | `execute_tool` | custom.
   */
  operation?: string;
  /** `gen_ai.provider.name` — e.g. `openai`, `anthropic`, `gcp.gemini`. */
  provider?: GenAiProviderName;
  /** Model the provider actually served (`gen_ai.response.model`). */
  responseModel?: string;
  /** Provider response id (`gen_ai.response.id`). */
  responseId?: string;
  /** Token counts, if known up front (otherwise use `AgentActionOptions.extractUsage`). */
  usage?: TokenUsage;
  /** Provider finish reasons, e.g. `['stop']`. */
  finishReasons?: string[];
  /** Per-call pricing override/extension for cost estimation. */
  pricing?: Record<string, ModelPricing>;
}

export interface PolicyMetadata {
  decision: PolicyDecision;
  policyId?: string;
  riskScore?: number;
  reason?: string;
}

export interface GovernanceMetadata {
  reviewRequired?: boolean;
  reviewerId?: string;
  controlId?: string | string[];
  documentationUrl?: string;
  lifecycleStage?: AiLifecycleStage;
  framework?: string;
}

export interface AgentSessionMetadata {
  status?: AgentSessionStatus;
  startedAt?: string | Date;
  endedAt?: string | Date;
  delegatedBy?: string;
}

export interface AgentSessionActionMetadata extends AgentActionMetadata {
  session?: AgentSessionMetadata;
}

export interface AgentDecisionMetadata {
  summary: string;
  inputHash?: string;
  policyIds?: string[];
  justificationCodes?: string[];
  evidenceIds?: string[];
  reviewRequired?: boolean;
  confidence?: number;
}

export interface AgentActionMetadata {
  action: string;
  resource?: string;
  actorId?: string;
  category?: string;
  outcome?: AgentOutcome;
  schemaVersion?: string;
  eventKind?: AgentEventKind;
  agent: AgentIdentity;
  delegation?: DelegationContext;
  tool?: ToolCallMetadata;
  ai?: AgentAiMetadata;
  policy?: PolicyMetadata;
  governance?: GovernanceMetadata;
  session?: AgentSessionMetadata;
  decision?: AgentDecisionMetadata;
  reasoningSummary?: string;
}

export interface AgentActionOptions {
  ctx?: AgentContext;
  emitNow?: boolean;
  forceKeep?: boolean;
  logger?: RequestLogger;
  /**
   * Behaviour when no trace context can be resolved. Defaults to `warn`
   * (best-effort: run the action un-audited, warn once). Agent audit is
   * observability — a missing context must never crash the wrapped tool call.
   * See {@link OnMissingContext}.
   */
  onMissingContext?: OnMissingContext;
  /**
   * Pull token usage from the handler's result, for actions carrying
   * {@link AgentAiMetadata}. Called once after the handler resolves; the
   * returned usage drives the recorded GenAI token + cost attributes. Most LLM
   * SDKs expose this on the response (e.g. `res.usage`).
   */
  extractUsage?: (result: unknown) => TokenUsage | undefined;
}

export interface AgentToolCallOptions extends AgentActionOptions {
  hashResult?: boolean;
}

export type AgentHandler<T> = (
  ctx: AgentContext,
  logger: RequestLogger,
) => T | Promise<T>;

/** Action metadata that always carries tool details (for tool-call wrappers). */
export type AgentToolCallActionMetadata = AgentActionMetadata & {
  tool: ToolCallMetadata;
};

/**
 * Factory used by `defineAgentAction` / `defineAgentToolCall`. Mirrors the
 * `trace()` factory shape: receive the audit context, return the handler that
 * runs per call. `logger` may be ignored.
 */
export type AgentActionFactory<TArgs extends unknown[], TResult> = (
  ctx: AgentContext,
  logger: RequestLogger,
) => (...args: TArgs) => TResult | Promise<TResult>;

/**
 * Metadata for a defined wrapper: either a static object or a function of the
 * call arguments (so call-specific fields like `tool.input` can be hashed).
 */
export type AgentMetadataInput<TArgs extends unknown[], TMetadata> =
  | TMetadata
  | ((...args: TArgs) => TMetadata);

export interface PrivacyProfile {
  name: string;
  hashKeys?: RegExp[];
  dropKeys?: RegExp[];
  maskKeys?: RegExp[];
  maxStringLength?: number;
}

export interface AgentIdentityRecord {
  agent: AgentIdentity;
  scopes: string[];
  status: AgentIdentityStatus;
  tokenId?: string;
  tokenHash?: string;
  delegatedBy?: string;
  provisionedAt: string;
  rotatedAt?: string;
  revokedAt?: string;
  revocationReason?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentIdentityRegistry {
  provisionIdentity(input: {
    agent: AgentIdentity;
    scopes?: string[];
    tokenId?: string;
    delegatedBy?: string;
    provisionedAt?: string | Date;
    expiresAt?: string | Date;
    metadata?: Record<string, unknown>;
  }): AgentIdentityRecord;
  rotateIdentity(
    agentId: string,
    input?: {
      scopes?: string[];
      tokenId?: string;
      delegatedBy?: string;
      rotatedAt?: string | Date;
      expiresAt?: string | Date;
      metadata?: Record<string, unknown>;
    },
  ): AgentIdentityRecord;
  revokeIdentity(
    agentId: string,
    input: { reason: string; revokedAt?: string | Date },
  ): AgentIdentityRecord;
  getIdentity(agentId: string): AgentIdentityRecord | undefined;
  getIdentityStatus(
    agentId: string,
    at?: string,
  ): AgentIdentityStatus | undefined;
  assertUsable(agentId: string, at?: string): AgentIdentityRecord;
  assertScopes(agentId: string, requiredScopes: string[]): AgentIdentityRecord;
  issueDelegation(
    agentId: string,
    input: {
      parentIdentity: string;
      scope?: string | string[];
      tokenId?: string;
      delegationId?: string;
      authorityLineage?: string[];
      issuedAt?: string | Date;
      expiresAt?: string | Date;
    },
  ): DelegationContext;
  list(): AgentIdentityRecord[];
}

export interface ScopedToolDefinition<TInput> {
  action: string;
  resource?: string;
  category?: string;
  agent: AgentIdentity;
  delegation?: DelegationContext;
  tool: Pick<ToolCallMetadata, 'name' | 'callId'>;
  requiredScopes?: string[];
  policyId?: string;
  riskScore?: number;
  reviewRequired?: boolean;
  governance?: GovernanceMetadata;
  decision?: AgentDecisionMetadata;
  privacyProfile?: PrivacyProfileName | PrivacyProfile;
  identityRegistry?: AgentIdentityRegistry;
}

export interface AgentAuditEventEnvelope {
  schemaVersion: string;
  emittedAt: string;
  eventHash: string;
  previousEventHash?: string;
  signature?: string;
  metadata: AgentActionMetadata;
  evidence?: unknown;
}
