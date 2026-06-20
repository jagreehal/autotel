export { AGENT_AUDIT_SCHEMA_VERSION } from './constants.js';
export { canonicalizeForHash, hashPayload, type HashPayloadOptions } from './hash.js';
export { createAgentAuditMetadata } from './metadata.js';
export { flattenAgentAttributes, setAgentAttributes } from './attributes.js';
export { delegateToAgent, recordAgentHandoff, type DelegateToAgentInput, type RecordAgentHandoffMetadata } from './delegation.js';
export { defineAgentAction, defineAgentToolCall, recordDecisionBasis, recordPolicyDecision, withAgentAction, withAgentToolCall } from './runtime.js';
export { withAgentSession } from './session.js';
export { createAgentIdentityRegistry, type ProvisionAgentIdentityInput, type RevokeAgentIdentityInput, type RotateAgentIdentityInput } from './identity-registry.js';
export { resolvePrivacyProfile, sanitizeAuditPayload, type PrivacyProfileInput } from './privacy.js';
export { createSignedEventEnvelope, verifyEventEnvelopeHash, type CreateSignedEventEnvelopeOptions } from './non-repudiation.js';
export { withScopedTool } from './scoped-tool.js';
import {
  AGENT_SECURITY_ATTR,
  deriveActionRiskClass,
  recordActionRiskClass,
  recordActiveScopes,
  recordControllerId,
  recordHumanApproval,
  recordInputProvenance,
  recordMemoryAccess,
  recordPlanStep,
  recordRenderOutput,
  tryRecordHumanApproval,
} from './agent-security.js';
import {
  AGENT_PLAN_RISK_ATTR,
  heuristicPlanRiskClassifier,
  recordPlanRiskAssessment,
  runAgentPlanClassifier,
} from './agent-plan-classifier.js';

export {
  AGENT_SECURITY_ATTR,
  deriveActionRiskClass,
  recordActionRiskClass,
  recordActiveScopes,
  recordControllerId,
  recordHumanApproval,
  recordInputProvenance,
  recordMemoryAccess,
  recordPlanStep,
  recordRenderOutput,
  tryRecordHumanApproval,
};

export {
  AGENT_PLAN_RISK_ATTR,
  heuristicPlanRiskClassifier,
  recordPlanRiskAssessment,
  runAgentPlanClassifier,
};

export type {
  ActionRiskHints,
  AgentActionRiskClass,
  AgentConsentOutcome,
  AgentInputProvenance,
  AgentMemoryOperation,
  AgentOutputFormat,
  AgentSecurityRecordOptions,
  RecordActiveScopesInput,
  RecordControllerInput,
  RecordHumanApprovalInput,
  RecordInputProvenanceInput,
  RecordMemoryAccessInput,
  RecordPlanStepInput,
  RecordRenderOutputInput,
} from './agent-security.js';
export type {
  AgentPlanClassifier,
  AgentPlanClassifierInput,
  AgentPlanClassifierResult,
  AgentPlanRiskVerdict,
  RecordPlanRiskAssessmentOptions,
} from './agent-plan-classifier.js';
export type { AgentContext } from './context.js';
export { agentContextFromSpan } from './context.js';
export type {
  AgentActionFactory,
  AgentActionMetadata,
  AgentActionOptions,
  AgentAiMetadata,
  AgentAuditEventEnvelope,
  AgentMetadataInput,
  ModelPricing,
  TokenUsage,
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
} from './types.js';
