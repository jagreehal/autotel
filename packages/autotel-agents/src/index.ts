/**
 * autotel-agents — browser-safe domain layer for observing coding agents.
 *
 * The devtools server decodes OTLP (JSON/protobuf) into `OtelMetricRecord` /
 * `AgentRawEvent`, calls `ingestMetricRecord` / `ingestEventRecord` against a
 * `Map` it owns, and broadcasts the resulting `AgentSession`s to the widget.
 *
 * This package has no I/O and no `node:*` imports (enforced by
 * eslint-plugin-no-server-imports), so the widget can import it directly.
 */

export type {
  AttrValue,
  Attributes,
  OtelScope,
  OtelDataPoint,
  OtelMetricRecord,
  MetricTemporality,
  AgentRawEvent,
  AgentKind,
  AgentEventType,
  ToolDecision,
  ToolRef,
  CostSource,
  AgentEvent,
  ToolUsage,
  AgentSessionRollup,
  AgentSession,
  AgentSessionStore,
} from './types';

export type {
  AgentAdapter,
  AgentMetricSignal,
  AgentMetricKind,
  SessionIdentity,
} from './adapters/types';

export {
  adapters,
  detectAdapterForMetric,
  detectAdapterForEvent,
  isAgentMetric,
  isAgentEvent,
} from './adapters/registry';
export { createPrefixAdapter } from './adapters/prefix-adapter';
export { claudeCodeAdapter } from './adapters/claude-code';
export { opencodeAdapter } from './adapters/opencode';

export {
  DEFAULT_TIMELINE_LIMIT,
  foldEvent,
  foldMetricSignal,
  ingestEventRecord,
  ingestMetricRecord,
  ingestAgentEvents,
  ingestAgentMetrics,
  summarizeSessions,
} from './reduce';
export type { IngestOptions, AgentAggregate } from './reduce';

export { parseToolName, isMcpTool } from './mcp';
export type { ParsedToolName } from './mcp';
export {
  classifyTool,
  readSubAgentType,
  readSkillName,
  TOOL_CATEGORIES,
} from './tool-taxonomy';
export type { ToolCategory } from './tool-taxonomy';
export { estimateCostUsd } from './cost';
export { readIdentity, mergeAttrs } from './identity';
