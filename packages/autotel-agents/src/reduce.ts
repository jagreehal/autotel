/**
 * Session reducers. These are PURE (no I/O, no node:*) but stateful over a
 * caller-owned `Map`, so the devtools server can keep one canonical store and
 * broadcast finished `AgentSession` objects to the widget.
 *
 * Invariants:
 *  - Rollups are kept forever; the raw `timeline` is ring-buffered (`timelineLimit`).
 *  - Cost/token totals come from `api_request` EVENTS only. `token.usage` and
 *    `cost.usage` METRICS are recognized but deliberately not summed, so the two
 *    representations of the same fact never double-count.
 */

import { foldContextReset } from './compaction';
import { mergeAttrs, readIdentity } from './identity';
import { TOOL_CATEGORIES } from './tool-taxonomy';
import {
  detectAdapterForEvent,
  detectAdapterForMetric,
} from './adapters/registry';
import type { AgentMetricSignal, SessionIdentity } from './adapters/types';
import type {
  AgentEvent,
  AgentKind,
  AgentRawEvent,
  AgentSession,
  AgentSessionRollup,
  AgentSessionStore,
  HookStats,
  McpConnectionInfo,
  OtelMetricRecord,
  PluginInfo,
  ToolCategory,
  ToolUsage,
  UsageBreakdown,
} from './types';

export const DEFAULT_TIMELINE_LIMIT = 500;

export interface IngestOptions {
  timelineLimit?: number;
}

function emptyToolCategories(): Record<ToolCategory, number> {
  // SAFETY: Object.fromEntries widens its key type to string. TOOL_CATEGORIES is
  // the full ToolCategory list, so every key of the result is one of them.
  return Object.fromEntries(
    TOOL_CATEGORIES.map((category) => [category, 0]),
  ) as Record<ToolCategory, number>;
}

/**
 * A record whose keys come from telemetry. Every key here arrived over the
 * wire — a model id, a tool name, a skill — and `__proto__`, `constructor` and
 * `toString` are all legal strings. On an ordinary `{}` they name inherited
 * properties, so a lookup finds one instead of `undefined`, the `??=` never
 * fires, and the tally lands on `Object.prototype`: every object in the process
 * is corrupted and the value is recorded nowhere. A null prototype has nothing
 * to inherit, so such a key is just a key.
 */
function wireKeyed<T>(): Record<string, T> {
  // SAFETY: Object.create(null) is typed `any`. The object it returns has no
  // prototype and no own properties, so every key it will ever answer to is one
  // this module puts there, of type T — which is what the Record says.
  return Object.create(null) as Record<string, T>;
}

function emptyUsage(): UsageBreakdown {
  return {
    requests: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
}

function emptyRollup(): AgentSessionRollup {
  return {
    costUsd: 0,
    costReportedUsd: 0,
    costEstimatedUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    apiRequests: 0,
    apiErrors: 0,
    apiRefusals: 0,
    prompts: 0,
    toolCalls: 0,
    accepted: 0,
    rejected: 0,
    linesAdded: 0,
    linesRemoved: 0,
    commits: 0,
    pullRequests: 0,
    activeTimeSeconds: 0,
    byModel: wireKeyed(),
    byEffort: wireKeyed(),
    bySkill: wireKeyed(),
    byAgent: wireKeyed(),
    byPrompt: wireKeyed(),
    tools: wireKeyed(),
    toolCategories: emptyToolCategories(),
    subAgents: wireKeyed(),
    skills: wireKeyed(),
    mcpConnections: wireKeyed(),
    plugins: wireKeyed(),
    hooks: { runs: 0, blocked: 0, errored: 0, cancelled: 0 },
    contextHighWaterTokens: 0,
    contextState: wireKeyed(),
    compactions: [],
  };
}

function createSession(
  id: string,
  agent: AgentKind,
  timestamp: number,
): AgentSession {
  return {
    id,
    agent,
    firstSeen: timestamp,
    lastSeen: timestamp,
    eventCount: 0,
    metricState: wireKeyed(),
    rollup: emptyRollup(),
    timeline: [],
  };
}

function getOrCreate(
  store: AgentSessionStore,
  id: string,
  agent: AgentKind,
  timestamp: number,
): AgentSession {
  let session = store.get(id);
  if (!session) {
    session = createSession(id, agent, timestamp);
    store.set(id, session);
  }
  return session;
}

function applyIdentity(session: AgentSession, identity: SessionIdentity): void {
  if (!session.user && identity.user) session.user = identity.user;
  if (!session.organization && identity.organization)
    session.organization = identity.organization;
  if (!session.terminal && identity.terminal)
    session.terminal = identity.terminal;
  if (!session.appVersion && identity.appVersion)
    session.appVersion = identity.appVersion;
}

function touch(session: AgentSession, timestamp: number): void {
  if (timestamp < session.firstSeen) session.firstSeen = timestamp;
  if (timestamp > session.lastSeen) session.lastSeen = timestamp;
}

function bumpTool(rollup: AgentSessionRollup, event: AgentEvent): ToolUsage {
  const ref = event.tool!;
  const existing = rollup.tools[ref.name] ?? {
    name: ref.name,
    category: ref.category,
    isMcp: ref.isMcp,
    mcpServer: ref.mcpServer,
    count: 0,
    accepted: 0,
    rejected: 0,
    failures: 0,
    totalDurationMs: 0,
  };
  rollup.tools[ref.name] = existing;
  return existing;
}

/**
 * Add one request's cost and tokens to the slice `key` names. A dimension the
 * request does not carry files nothing: an absent `skill.name` means the work
 * had no skill behind it, which is not the same as a skill called "unknown".
 */
function bumpUsage(
  bucket: Record<string, UsageBreakdown>,
  key: string | undefined,
  event: AgentEvent,
): void {
  if (!key) return;
  const usage = (bucket[key] ??= emptyUsage());
  usage.requests += 1;
  usage.costUsd += event.costUsd ?? 0;
  usage.inputTokens += event.inputTokens ?? 0;
  usage.outputTokens += event.outputTokens ?? 0;
  usage.cacheReadTokens += event.cacheReadTokens ?? 0;
  usage.cacheCreationTokens += event.cacheCreationTokens ?? 0;
}

/** Count a tool against its category and (for sub-agents/skills) its named bucket. */
function tallyToolKind(rollup: AgentSessionRollup, event: AgentEvent): void {
  const ref = event.tool;
  if (!ref) return;
  rollup.toolCategories[ref.category] += 1;
  if (ref.category === 'subagent') {
    const key = ref.subAgentType ?? 'subagent';
    rollup.subAgents[key] = (rollup.subAgents[key] ?? 0) + 1;
  } else if (ref.category === 'skill') {
    const key = ref.skillName ?? 'skill';
    rollup.skills[key] = (rollup.skills[key] ?? 0) + 1;
  }
}

/** Fold a normalized event into a session rollup + timeline. Returns the session. */
export function foldEvent(
  session: AgentSession,
  event: AgentEvent,
  timelineLimit: number = DEFAULT_TIMELINE_LIMIT,
): AgentSession {
  session.eventCount += 1;
  event.id = `${session.id}:${session.eventCount}`;
  touch(session, event.timestamp);

  const { rollup } = session;
  switch (event.type) {
    case 'api_request': {
      rollup.apiRequests += 1;
      rollup.inputTokens += event.inputTokens ?? 0;
      rollup.outputTokens += event.outputTokens ?? 0;
      rollup.cacheReadTokens += event.cacheReadTokens ?? 0;
      rollup.cacheCreationTokens += event.cacheCreationTokens ?? 0;
      if (event.costUsd !== undefined) {
        rollup.costUsd += event.costUsd;
        if (event.costSource === 'estimated')
          rollup.costEstimatedUsd += event.costUsd;
        else rollup.costReportedUsd += event.costUsd;
      }
      bumpUsage(rollup.byModel, event.model, event);
      bumpUsage(rollup.byEffort, event.effort, event);
      bumpUsage(rollup.bySkill, event.skillName, event);
      bumpUsage(rollup.byAgent, event.agentName, event);
      bumpUsage(rollup.byPrompt, event.promptId, event);
      foldContextReset(rollup, event);
      break;
    }
    case 'api_error':
      rollup.apiErrors += 1;
      break;
    case 'api_refusal':
      // A refusal is a completed call that produced no answer. Counting it as
      // an error would put a working model in the failure column.
      rollup.apiRefusals += 1;
      break;
    case 'user_prompt':
      rollup.prompts += 1;
      break;
    case 'tool_result': {
      // tool_result is the actual execution: it owns the call count, duration,
      // failures and tool taxonomy. Accept/reject is NOT counted here — that's
      // owned solely by tool_decision (see below), so a single decision can't be
      // double-counted across the event + the code_edit_tool.decision metric.
      rollup.toolCalls += 1;
      if (event.tool) {
        const usage = bumpTool(rollup, event);
        usage.count += 1;
        usage.totalDurationMs += event.durationMs ?? 0;
        if (event.success === false) usage.failures += 1;
        tallyToolKind(rollup, event);
      }
      break;
    }
    case 'tool_decision': {
      // The single source of truth for accept/reject (matches the
      // events-authoritative rule used for cost/tokens).
      if (event.decision === 'accept') rollup.accepted += 1;
      if (event.decision === 'reject') rollup.rejected += 1;
      if (event.tool) {
        const usage = bumpTool(rollup, event);
        if (event.decision === 'accept') usage.accepted += 1;
        if (event.decision === 'reject') usage.rejected += 1;
      }
      break;
    }
    case 'mcp_connection': {
      const name = event.mcpServerName;
      if (name) {
        const info = rollup.mcpConnections[name] ?? {
          name,
          connected: false,
          connects: 0,
          disconnects: 0,
        };
        if (event.mcpTransport) info.transport = event.mcpTransport;
        if (event.mcpStatus === 'connected') {
          info.connects += 1;
          info.connected = true;
        } else if (event.mcpStatus === 'disconnected') {
          info.disconnects += 1;
          info.connected = false;
        }
        rollup.mcpConnections[name] = info;
      }
      break;
    }
    case 'plugin_loaded': {
      const name = event.pluginName;
      if (name) rollup.plugins[name] = { name, version: event.pluginVersion };
      break;
    }
    case 'hook_execution': {
      rollup.hooks.runs += 1;
      rollup.hooks.blocked += event.hookBlocked ?? 0;
      rollup.hooks.errored += event.hookErrored ?? 0;
      rollup.hooks.cancelled += event.hookCancelled ?? 0;
      break;
    }
    default:
      break;
  }

  session.timeline.push(event);
  if (session.timeline.length > timelineLimit) {
    session.timeline.splice(0, session.timeline.length - timelineLimit);
  }
  return session;
}

/**
 * The amount to add to a running total for one metric data point.
 *
 * `delta` points already carry the per-interval change, so they're added as-is.
 * `cumulative` points carry an absolute running total per series, so we add the
 * difference from the last value we saw for that series — otherwise re-exporting
 * `lines_of_code.count = 42` every interval would inflate the total without end.
 * A drop (counter reset / new process) is treated as a fresh delta.
 */
function counterDelta(
  session: AgentSession,
  seriesKey: string,
  signal: AgentMetricSignal,
): number {
  if (signal.temporality !== 'cumulative') return signal.value;
  const last = session.metricState[seriesKey] ?? 0;
  session.metricState[seriesKey] = signal.value;
  return signal.value >= last ? signal.value - last : signal.value;
}

/** Stable per-series key: a cumulative counter is one series per attribute set. */
function seriesKey(signal: AgentMetricSignal): string {
  const attrs = Object.entries(signal.attributes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(',');
  return `${signal.kind}|${attrs}`;
}

/** Fold a metric-only signal (lines, commits, PRs, active time) into the rollup. */
export function foldMetricSignal(
  session: AgentSession,
  signal: AgentMetricSignal,
): void {
  touch(session, signal.timestamp);
  applyIdentity(session, signal.identity);
  const { rollup } = session;
  const value = counterDelta(session, seriesKey(signal), signal);
  switch (signal.kind) {
    case 'lines_of_code': {
      const type = String(signal.attributes['type'] ?? '').toLowerCase();
      if (type.includes('remov') || type.includes('delet'))
        rollup.linesRemoved += value;
      else rollup.linesAdded += value;
      break;
    }
    case 'commit':
      rollup.commits += value;
      break;
    case 'pull_request':
      rollup.pullRequests += value;
      break;
    case 'active_time':
      rollup.activeTimeSeconds += value;
      break;
    // Everything else ('other') is a metric that overlaps an event — token.usage,
    // cost.usage, code_edit_tool.decision, session.count — and is deliberately
    // NOT folded here: events are authoritative (see source-of-truth invariant).
    default:
      break;
  }
}

/**
 * Ingest a decoded OTLP log record. No-op (returns null) if no adapter claims it
 * or the record lacks a session id.
 */
export function ingestEventRecord(
  store: AgentSessionStore,
  record: AgentRawEvent,
  options: IngestOptions = {},
): AgentSession | null {
  const adapter = detectAdapterForEvent(record);
  if (!adapter) return null;
  const event = adapter.normalizeEvent(record);
  if (!event) return null;

  const session = getOrCreate(
    store,
    event.sessionId,
    adapter.kind,
    event.timestamp,
  );
  applyIdentity(
    session,
    readIdentity(mergeAttrs(record.resource, record.attributes)),
  );
  return foldEvent(
    session,
    event,
    options.timelineLimit ?? DEFAULT_TIMELINE_LIMIT,
  );
}

/** Ingest a decoded OTLP metric. Returns sessions touched (may be several). */
export function ingestMetricRecord(
  store: AgentSessionStore,
  record: OtelMetricRecord,
): AgentSession[] {
  const adapter = detectAdapterForMetric(record);
  if (!adapter) return [];
  const touched = new Map<string, AgentSession>();
  for (const signal of adapter.normalizeMetric(record)) {
    if (!signal.sessionId) continue;
    const session = getOrCreate(
      store,
      signal.sessionId,
      adapter.kind,
      signal.timestamp,
    );
    foldMetricSignal(session, signal);
    touched.set(session.id, session);
  }
  return [...touched.values()];
}

/** Batch-ingest decoded OTLP log records. */
export function ingestAgentEvents(
  store: AgentSessionStore,
  records: AgentRawEvent[],
  options: IngestOptions = {},
): void {
  for (const record of records) ingestEventRecord(store, record, options);
}

/** Batch-ingest decoded OTLP metric records. */
export function ingestAgentMetrics(
  store: AgentSessionStore,
  records: OtelMetricRecord[],
): void {
  for (const record of records) ingestMetricRecord(store, record);
}

// ── Aggregate strip (v1: across visible sessions) ──────────────────────────

export interface AgentAggregate {
  sessions: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  apiRequests: number;
  apiErrors: number;
  accepted: number;
  rejected: number;
  byModel: Record<string, UsageBreakdown>;
  byEffort: Record<string, UsageBreakdown>;
  bySkill: Record<string, UsageBreakdown>;
  byAgent: Record<string, UsageBreakdown>;
  /** tool name → call count, MCP and built-in together. */
  tools: Record<string, number>;
  /** tool category → call count. */
  toolCategories: Record<ToolCategory, number>;
  /** MCP server id → call count. */
  mcpServers: Record<string, number>;
  /** sub-agent type (or `"subagent"`) → invocation count. */
  subAgents: Record<string, number>;
  /** skill name (or `"skill"`) → invocation count. */
  skills: Record<string, number>;
  /** MCP server name → connection info, merged across sessions. */
  mcpConnections: Record<string, McpConnectionInfo>;
  /** plugin name → info, merged across sessions. */
  plugins: Record<string, PluginInfo>;
  /** Hook-execution tallies, summed across sessions. */
  hooks: HookStats;
}

/** Add one session's slices of a dimension into the cross-session totals. */
function mergeUsage(
  into: Record<string, UsageBreakdown>,
  from: Record<string, UsageBreakdown>,
): void {
  for (const [key, usage] of Object.entries(from)) {
    const total = (into[key] ??= emptyUsage());
    total.requests += usage.requests;
    total.costUsd += usage.costUsd;
    total.inputTokens += usage.inputTokens;
    total.outputTokens += usage.outputTokens;
    total.cacheReadTokens += usage.cacheReadTokens;
    total.cacheCreationTokens += usage.cacheCreationTokens;
  }
}

export function summarizeSessions(
  sessions: Iterable<AgentSession>,
): AgentAggregate {
  const agg: AgentAggregate = {
    sessions: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    apiRequests: 0,
    apiErrors: 0,
    accepted: 0,
    rejected: 0,
    byModel: wireKeyed(),
    byEffort: wireKeyed(),
    bySkill: wireKeyed(),
    byAgent: wireKeyed(),
    tools: wireKeyed(),
    toolCategories: emptyToolCategories(),
    mcpServers: wireKeyed(),
    subAgents: wireKeyed(),
    skills: wireKeyed(),
    mcpConnections: wireKeyed(),
    plugins: wireKeyed(),
    hooks: { runs: 0, blocked: 0, errored: 0, cancelled: 0 },
  };
  for (const session of sessions) {
    agg.sessions += 1;
    const { rollup } = session;
    agg.costUsd += rollup.costUsd;
    agg.inputTokens += rollup.inputTokens;
    agg.outputTokens += rollup.outputTokens;
    agg.apiRequests += rollup.apiRequests;
    agg.apiErrors += rollup.apiErrors;
    agg.accepted += rollup.accepted;
    agg.rejected += rollup.rejected;
    mergeUsage(agg.byModel, rollup.byModel);
    mergeUsage(agg.byEffort, rollup.byEffort);
    mergeUsage(agg.bySkill, rollup.bySkill);
    mergeUsage(agg.byAgent, rollup.byAgent);
    for (const usage of Object.values(rollup.tools)) {
      agg.tools[usage.name] = (agg.tools[usage.name] ?? 0) + usage.count;
      if (usage.isMcp && usage.mcpServer) {
        agg.mcpServers[usage.mcpServer] =
          (agg.mcpServers[usage.mcpServer] ?? 0) + usage.count;
      }
    }
    for (const category of TOOL_CATEGORIES) {
      agg.toolCategories[category] += rollup.toolCategories[category];
    }
    for (const [type, count] of Object.entries(rollup.subAgents)) {
      agg.subAgents[type] = (agg.subAgents[type] ?? 0) + count;
    }
    for (const [name, count] of Object.entries(rollup.skills)) {
      agg.skills[name] = (agg.skills[name] ?? 0) + count;
    }
    for (const info of Object.values(rollup.mcpConnections)) {
      const merged = agg.mcpConnections[info.name] ?? {
        name: info.name,
        transport: info.transport,
        connected: false,
        connects: 0,
        disconnects: 0,
      };
      merged.connects += info.connects;
      merged.disconnects += info.disconnects;
      merged.connected = merged.connected || info.connected;
      if (info.transport) merged.transport = info.transport;
      agg.mcpConnections[info.name] = merged;
    }
    for (const info of Object.values(rollup.plugins)) {
      agg.plugins[info.name] = info;
    }
    agg.hooks.runs += rollup.hooks.runs;
    agg.hooks.blocked += rollup.hooks.blocked;
    agg.hooks.errored += rollup.hooks.errored;
    agg.hooks.cancelled += rollup.hooks.cancelled;
  }
  return agg;
}
