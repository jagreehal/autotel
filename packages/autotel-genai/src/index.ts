/**
 * autotel-genai — gold-standard OpenTelemetry GenAI instrumentation.
 *
 * Canonical `gen_ai.*` semantic conventions (semconv v1.42.0) for LLM calls,
 * tools, and agents: cost estimation, token usage, metric buckets, content +
 * evaluation events, a `traceGenAI` wrapper, a Vercel AI SDK bridge, and the
 * agent identity / delegation / policy / audit governance layer.
 *
 * Subpath entry points are available for tree-shaking:
 * `autotel-genai/semconv`, `/cost`, `/metrics`, `/events`, `/trace`,
 * `/guard`, `/ai-sdk`, `/agent`.
 */

// --- Semantic conventions (source of truth) --------------------------------
export {
  GEN_AI,
  GEN_AI_EVENT,
  GEN_AI_EXT_EVENT,
  GEN_AI_GUARD_EVENT,
  GEN_AI_OPERATION,
  GEN_AI_PROVIDER,
  GEN_AI_TOKEN_TYPE,
  GEN_AI_OUTPUT_TYPE,
  GEN_AI_TOOL_TYPE,
  GEN_AI_METRIC,
  genAiSpanName,
} from './semconv.js';
export type {
  GenAiAttributeKey,
  GenAiOperationName,
  GenAiProviderName,
  GenAiTokenType,
  GenAiOutputType,
  GenAiToolType,
} from './semconv.js';

// --- Cost ------------------------------------------------------------------
export {
  GEN_AI_COST_ATTRIBUTE,
  MODEL_PRICING,
  estimateLLMCost,
  recordLLMCost,
} from './cost.js';
export type { ModelPricing, TokenUsage, EstimateCostOptions } from './cost.js';

// --- Metrics ---------------------------------------------------------------
export {
  GEN_AI_DURATION_BUCKETS_SECONDS,
  GEN_AI_TOKEN_USAGE_BUCKETS,
  GEN_AI_COST_USD_BUCKETS,
  llmHistogramAdvice,
  genAiMetricViews,
} from './metrics.js';
export type { GenAiHistogramKind } from './metrics.js';

// --- Attribute builders ----------------------------------------------------
export {
  genAiRequestAttributes,
  genAiResponseAttributes,
  genAiUsageAttributes,
  genAiAgentAttributes,
  genAiToolAttributes,
  genAiRetrievalAttributes,
  genAiMemoryAttributes,
  genAiWorkflowAttributes,
} from './attributes.js';
export type {
  GenAiAttributeMap,
  GenAiRequestInput,
  GenAiResponseInput,
  GenAiUsageInput,
  GenAiAgentInput,
  GenAiToolInput,
  GenAiRetrievalInput,
  GenAiMemoryInput,
  GenAiWorkflowInput,
} from './attributes.js';

// --- Content + events ------------------------------------------------------
export {
  setGenAiContent,
  recordInferenceDetails,
  recordEvaluationResult,
  recordOperationException,
  recordModelWarnings,
} from './events.js';
export type {
  GenAiContentSink,
  ContentCaptureSettings,
  GenAiMessage,
  GenAiMessagePart,
  GenAiWarning,
  InferenceDetailsEvent,
  EvaluationResultEvent,
  GenAiOperationExceptionEvent,
} from './events.js';

// --- Streaming performance -------------------------------------------------
export {
  computeStreamTiming,
  chunkIntervalStats,
  recordStreamTiming,
  createStreamTimer,
} from './streaming.js';
export type {
  StreamTiming,
  ChunkIntervalStats,
  ComputeStreamTimingInput,
  StreamTimer,
} from './streaming.js';

// --- Trace wrapper ---------------------------------------------------------
export {
  traceGenAI,
  traceLLM,
  recordGenAiResponse,
  recordGenAiUsage,
} from './trace.js';
export type { TraceGenAIConfig } from './trace.js';

// --- Guard / budget runtime ------------------------------------------------
export {
  createGenAiGuard,
  createGenAiBudget,
  parseGuardRules,
  costCeiling,
  tokenCeiling,
  maxToolCalls,
  maxSteps,
  maxDuration,
  spinLoop,
  errorLoop,
  contextBudget,
  CONTEXT_LIMITS,
} from './guard.js';
export type {
  GuardAction,
  GuardUsage,
  GenAiGuardStep,
  GuardState,
  GuardViolation,
  GenAiGuardRule,
  GuardSink,
  GuardStopBehavior,
  GenAiGuardOptions,
  GenAiGuard,
  GenAiBudgetOptions,
} from './guard.js';

// --- Vercel AI SDK bridge --------------------------------------------------
export {
  AI_SDK_ATTR,
  normalizeAiSdkProvider,
  extractAiSdkUsage,
  extractAiSdkModel,
  mapAiSdkAttributes,
  estimateAiSdkCost,
  recordAiSdkCost,
} from './ai-sdk-bridge.js';

// --- Agent governance ------------------------------------------------------
// (Re-exported from the `./agent` subpath. `ModelPricing` / `TokenUsage` are
// already exported above from `./cost`, so they are omitted here.)
export {
  AGENT_AUDIT_SCHEMA_VERSION,
  canonicalizeForHash,
  hashPayload,
  createAgentAuditMetadata,
  flattenAgentAttributes,
  setAgentAttributes,
  delegateToAgent,
  recordAgentHandoff,
  defineAgentAction,
  defineAgentToolCall,
  recordDecisionBasis,
  recordPolicyDecision,
  withAgentAction,
  withAgentToolCall,
  withAgentSession,
  createAgentIdentityRegistry,
  resolvePrivacyProfile,
  sanitizeAuditPayload,
  createSignedEventEnvelope,
  verifyEventEnvelopeHash,
  withScopedTool,
} from './agent/index.js';
export type {
  HashPayloadOptions,
  DelegateToAgentInput,
  RecordAgentHandoffMetadata,
  ProvisionAgentIdentityInput,
  RevokeAgentIdentityInput,
  RotateAgentIdentityInput,
  PrivacyProfileInput,
  CreateSignedEventEnvelopeOptions,
  AgentContext,
  AgentActionFactory,
  AgentActionMetadata,
  AgentActionOptions,
  AgentAiMetadata,
  AgentAuditEventEnvelope,
  AgentMetadataInput,
  AgentToolCallActionMetadata,
  AgentDecisionMetadata,
  AgentEventKind,
  AgentHandler,
  AgentIdentity,
  AgentIdentityRecord,
  AgentIdentityRegistry,
  AgentIdentityStatus,
  AgentOutcome,
  AgentSessionActionMetadata,
  AgentSessionMetadata,
  AgentSessionStatus,
  AgentToolCallOptions,
  AiLifecycleStage,
  DelegationContext,
  GovernanceMetadata,
  PolicyDecision,
  PolicyMetadata,
  PrivacyProfile,
  PrivacyProfileName,
  ScopedToolDefinition,
  ToolCallMetadata,
  ToolStatus,
} from './agent/index.js';
