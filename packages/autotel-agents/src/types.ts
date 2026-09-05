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

import type { ContextReset } from './compaction';
import type { ToolCategory } from './tool-taxonomy';

export type { ToolCategory } from './tool-taxonomy';

export type AttrValue =
  string | number | boolean | null | AttrValue[] | { [key: string]: AttrValue };

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
  | 'api_refusal'
  | 'tool_result'
  | 'tool_decision'
  | 'mcp_connection'
  | 'plugin_loaded'
  | 'hook_execution'
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
  /**
   * The prompt this event belongs to (`prompt.id`). Every event a single user
   * prompt produces carries the same one, which is what makes a long session
   * splittable by the thing that caused the work rather than by session alone.
   */
  promptId?: string;

  // api_request
  costUsd?: number;
  costSource?: CostSource;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  /**
   * Whether the token counts came from the provider or were worked out. Absent
   * means the adapter read them off the wire. Compaction detection skips
   * `estimated` events entirely — see {@link ./compaction}.
   */
  tokenSource?: CostSource;
  /**
   * Independent conversation this request belongs to, when the agent
   * distinguishes them (Claude Code's `query_source`). A sub-agent runs its own
   * context, so prompt sizes are only comparable within one lineage.
   */
  contextLineageId?: string;
  durationMs?: number;
  /** Reasoning effort the request ran at (`low` / `medium` / `high`). */
  effort?: string;
  /** Serving speed tier the request ran at. */
  speed?: string;
  /**
   * Sub-agent that issued the request (`agent.name`). Distinct from the `Task`
   * tool call that spawned it: this is on the sub-agent's own requests, so cost
   * and tokens attribute to the delegate that spent them.
   */
  agentName?: string;
  /** Skill that drove the request (`skill.name`). */
  skillName?: string;

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

  // mcp_connection (mcp_server_connection)
  mcpServerName?: string;
  mcpTransport?: string;
  /** `"connected"` | `"disconnected"` — the connection state this event reports. */
  mcpStatus?: string;

  // plugin_loaded
  pluginName?: string;
  pluginVersion?: string;

  // hook_execution (hook_execution_complete)
  hookName?: string;
  hookSuccess?: number;
  hookBlocked?: number;
  hookErrored?: number;
  hookCancelled?: number;

  attributes: Attributes;
}

/** MCP server the agent connected to (from `mcp_server_connection` events). */
export interface McpConnectionInfo {
  name: string;
  /** Transport, e.g. `"stdio"` or `"sse"`. */
  transport?: string;
  /** Whether the last event left it connected. */
  connected: boolean;
  connects: number;
  disconnects: number;
}

/** A plugin the agent loaded (from `plugin_loaded` events). */
export interface PluginInfo {
  name: string;
  version?: string;
}

/** Hook-execution tallies (from `hook_execution_complete` events). */
export interface HookStats {
  runs: number;
  blocked: number;
  errored: number;
  cancelled: number;
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
 * Cost and tokens for one slice of a session — one model, one effort level, one
 * skill, one sub-agent. The same shape for every dimension, so a breakdown is
 * read the same way whatever it is keyed by.
 */
export interface UsageBreakdown {
  requests: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
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
  /** Requests the model declined. Billed like any other call, but no output. */
  apiRefusals: number;
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
  /** model id → what that model cost and consumed. */
  byModel: Record<string, UsageBreakdown>;
  /** effort level → what running at it cost and consumed. */
  byEffort: Record<string, UsageBreakdown>;
  /** skill name → what the work it drove cost and consumed. */
  bySkill: Record<string, UsageBreakdown>;
  /** sub-agent name → what the delegate it names cost and consumed. */
  byAgent: Record<string, UsageBreakdown>;
  /**
   * `prompt.id` → what answering that one prompt cost and consumed. Kept in the
   * rollup rather than derived from `timeline`, which is ring-buffered: the
   * spend of a prompt has to outlive the events that made it up.
   */
  byPrompt: Record<string, UsageBreakdown>;
  /** tool name → usage. */
  tools: Record<string, ToolUsage>;
  /** tool category → call count (file/shell/subagent/skill/mcp/…). */
  toolCategories: Record<ToolCategory, number>;
  /** sub-agent type (or `"subagent"` when type unknown) → invocation count. */
  subAgents: Record<string, number>;
  /** skill name (or `"skill"` when name unknown) → invocation count. */
  skills: Record<string, number>;
  // ── Runtime environment (from mcp_server_connection / plugin_loaded / hook events) ──
  /** MCP server name → connection info (distinct from tool-call-derived `tools`). */
  mcpConnections: Record<string, McpConnectionInfo>;
  /** plugin name → info. */
  plugins: Record<string, PluginInfo>;
  /** Hook-execution tallies. */
  hooks: HookStats;
  // ── Context (from api_request token counts) ──
  /**
   * Largest prompt seen since the last context reset, in tokens — the biggest
   * across lineages, so it reads as "how large did this session get".
   */
  contextHighWaterTokens: number;
  /**
   * Internal reducer state (not for UI): per-lineage context high-water, so a
   * sub-agent's small prompts are never compared against the parent's large
   * ones. Same role as {@link AgentSession.metricState}.
   */
  contextState: Record<string, number>;
  /**
   * Points where the agent's context was replaced — see
   * {@link ./compaction}. Inferred from token-count discontinuities, so each
   * one carries a confidence. Everything on the timeline before a reset had
   * left the agent's context by the time it continued.
   */
  compactions: ContextReset[];
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
