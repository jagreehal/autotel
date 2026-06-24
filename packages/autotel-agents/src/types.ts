/**
 * Domain types for coding-agent observability.
 *
 * Two layers:
 *  1. **Decoded OTLP input** (`OtelMetricRecord`, `AgentRawEvent`) — plain JSON
 *     the devtools *server* produces after decoding OTLP/JSON or OTLP/protobuf.
 *     This package never sees protobuf or `node:*`; it only normalizes objects.
 *  2. **Normalized model** (`AgentEvent`, `AgentSession`) — agent-agnostic shapes
 *     the widget renders. Claude Code, opencode and Codex all collapse to these.
 */

import type { ToolCategory } from './tool-taxonomy';

export type { ToolCategory } from './tool-taxonomy';

export type AttrValue =
  | string
  | number
  | boolean
  | null
  | AttrValue[]
  | { [key: string]: AttrValue };

export type Attributes = Record<string, AttrValue>;

export interface OtelScope {
  name?: string;
  version?: string;
}

// ── Decoded OTLP input ─────────────────────────────────────────────────────

/** One numeric data point of an OTLP metric (sum / gauge / histogram count). */
export interface OtelDataPoint {
  value: number;
  attributes: Attributes;
  /** Epoch milliseconds (server converts from OTLP's `timeUnixNano`). */
  timestamp: number;
}

/**
 * Aggregation temporality of a counter. `delta` points carry the change since
 * the last export (safe to sum); `cumulative` points carry a running total
 * (must be differenced per series, or you over-count on every export). Claude
 * Code defaults to `delta`; most other SDKs default to `cumulative`.
 */
export type MetricTemporality = 'delta' | 'cumulative';

/** A decoded OTLP metric — the server fills `dataPoints` from any instrument type. */
export interface OtelMetricRecord {
  name: string;
  unit?: string;
  description?: string;
  /** Counter temporality. Absent ⇒ treated as `delta` (Claude Code's default). */
  temporality?: MetricTemporality;
  dataPoints: OtelDataPoint[];
  resource: Attributes;
  scope?: OtelScope;
}

/** A decoded OTLP log record (Claude Code / opencode emit their events as logs). */
export interface AgentRawEvent {
  /** Best-effort event name: OTLP `EventName`, else the `event.name` attribute. */
  eventName: string;
  /** Epoch milliseconds. */
  timestamp: number;
  body?: unknown;
  attributes: Attributes;
  resource: Attributes;
  scope?: OtelScope;
}

// ── Normalized model ───────────────────────────────────────────────────────

export type AgentKind = 'claude-code' | 'opencode' | 'codex' | 'unknown';

export type AgentEventType =
  | 'user_prompt'
  | 'api_request'
  | 'api_error'
  | 'tool_result'
  | 'tool_decision'
  | 'other';

export type ToolDecision = 'accept' | 'reject';

/**
 * A tool the agent invoked. MCP tools follow Claude Code's `mcp__<server>__<tool>`
 * naming, so we can split server/tool out of the name — that's what powers the
 * "which MCP servers is the agent using" breakdown.
 */
export interface ToolRef {
  /** Raw tool name, e.g. `"Edit"`, `"Task"`, `"Skill"` or `"mcp__github__create_issue"`. */
  name: string;
  /** What kind of work this tool represents (file/shell/subagent/skill/mcp/…). */
  category: ToolCategory;
  isMcp: boolean;
  /** MCP server id, e.g. `"github"` (only when `isMcp`). */
  mcpServer?: string;
  /** MCP tool name, e.g. `"create_issue"` (only when `isMcp`). */
  mcpTool?: string;
  /** Sub-agent type for `Task` calls, when the agent emits it. */
  subAgentType?: string;
  /** Skill name for `Skill` calls, when the agent emits it. */
  skillName?: string;
}

export type CostSource = 'reported' | 'estimated';

/** A single normalized agent interaction (a row on the session timeline). */
export interface AgentEvent {
  id: string;
  sessionId: string;
  agent: AgentKind;
  type: AgentEventType;
  /** The agent's own event name, e.g. `"api_request"`. */
  rawEventName: string;
  timestamp: number;
  model?: string;

  // api_request
  costUsd?: number;
  costSource?: CostSource;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  durationMs?: number;

  // tool_result / tool_decision
  tool?: ToolRef;
  decision?: ToolDecision;
  success?: boolean;

  // user_prompt
  promptLength?: number;
  /** Only present when prompt capture is explicitly enabled. */
  promptText?: string;

  // api_error
  errorMessage?: string;
  statusCode?: number;

  attributes: Attributes;
}

/** Per-tool usage tally within a session. */
export interface ToolUsage {
  name: string;
  category: ToolCategory;
  isMcp: boolean;
  mcpServer?: string;
  count: number;
  accepted: number;
  rejected: number;
  failures: number;
  totalDurationMs: number;
}

/**
 * Running totals for a session. Kept indefinitely even as the raw `timeline`
 * is ring-buffered, so headline numbers never drift. Per the source-of-truth
 * rule, cost/token totals come from `api_request` *events* only — the
 * `token.usage`/`cost.usage` *metrics* are intentionally NOT summed in here.
 */
export interface AgentSessionRollup {
  costUsd: number;
  costReportedUsd: number;
  costEstimatedUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  apiRequests: number;
  apiErrors: number;
  prompts: number;
  toolCalls: number;
  accepted: number;
  rejected: number;
  // metric-only signals folded in by session.id
  linesAdded: number;
  linesRemoved: number;
  commits: number;
  pullRequests: number;
  activeTimeSeconds: number;
  /** model id → api_request count. */
  models: Record<string, number>;
  /** tool name → usage. */
  tools: Record<string, ToolUsage>;
  /** tool category → call count (file/shell/subagent/skill/mcp/…). */
  toolCategories: Record<ToolCategory, number>;
  /** sub-agent type (or `"subagent"` when type unknown) → invocation count. */
  subAgents: Record<string, number>;
  /** skill name (or `"skill"` when name unknown) → invocation count. */
  skills: Record<string, number>;
}

export interface AgentSession {
  id: string;
  agent: AgentKind;
  user?: string;
  organization?: string;
  terminal?: string;
  appVersion?: string;
  firstSeen: number;
  lastSeen: number;
  /** Total events ever seen (drives stable event ids; survives timeline eviction). */
  eventCount: number;
  /**
   * Internal reducer state (not for UI): last-seen value per cumulative metric
   * series, so re-exported cumulative counters are differenced instead of summed.
   * Keyed by metric kind + datapoint attributes.
   */
  metricState: Record<string, number>;
  rollup: AgentSessionRollup;
  /** Ring-buffered raw interactions (newest last), bounded by the reducer caller. */
  timeline: AgentEvent[];
}

export type AgentSessionStore = Map<string, AgentSession>;
