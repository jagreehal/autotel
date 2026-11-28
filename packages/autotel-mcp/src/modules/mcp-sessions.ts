import type { SpanRecord, TagValue } from '../types';

/** How a session ended, read off its last tool call. */
export type SessionOutcome =
  'completed' | 'recovered' | 'failed' | 'paused' | 'missing_tool';

export interface SessionCall {
  tool: string;
  startTimeUnixMs: number;
  durationMs: number;
  ok: boolean;
  traceId: string;
  intent?: string;
  failureCategory?: string;
  /** The call asked the user for input and will be retried. */
  paused?: true;
  /** What the agent looked for, on a `get_more_tools` report. */
  missingTool?: string;
}

export interface McpSession {
  id: string;
  startTimeUnixMs: number;
  endTimeUnixMs: number;
  outcome: SessionOutcome;
  errors: number;
  /** Tools in call order, with back-to-back repeats collapsed. */
  path: string[];
  calls: SessionCall[];
  userId?: string;
  client?: string;
  agentModel?: string;
  service: string;
}

export interface SessionPattern {
  path: string[];
  sessions: number;
  completionRate: number;
  outcomes: OutcomeCounts;
  intents: string[];
  exampleSessionIds: string[];
}

export interface McpSessionReport {
  sessions: McpSession[];
  patterns: SessionPattern[];
  outcomes: OutcomeCounts;
  /** Where failed sessions stopped: the last tool and its failure category. */
  endedOn: { tool: string; failureCategory: string; sessions: number }[];
  missingTools: { description: string; reports: number }[];
  /** Tool calls carrying no session, so they belong to no session here. */
  unsessionedCalls: number;
}

const MISSING_TOOL = 'get_more_tools';

const text = (value: TagValue | undefined): string | undefined =>
  value === undefined || value === '' ? undefined : String(value);

const isToolCall = (span: SpanRecord): boolean =>
  span.tags['mcp.method.name'] === 'tools/call' &&
  text(span.tags['gen_ai.tool.name']) !== undefined;

/** The session a call belongs to: the agent's conversation, then the transport's. */
const sessionOf = (span: SpanRecord): string | undefined =>
  text(span.tags['gen_ai.conversation.id']) ??
  text(span.tags['mcp.session.id']);

/**
 * One call per server span. A traced client sends its own span for the same
 * call; it is used only when the server's half is missing from the sample.
 */
function toolCalls(spans: SpanRecord[]): SpanRecord[] {
  const calls = spans.filter(isToolCall);
  const served = new Set(
    calls
      .filter((span) => span.tags['span.kind'] === 'server')
      .map((span) => span.parentSpanId),
  );
  return calls.filter(
    (span) => span.tags['span.kind'] !== 'client' || !served.has(span.spanId),
  );
}

/** The call that finished last; calls can overlap, so not always the last to start. */
function lastFinished(calls: SessionCall[]): SessionCall {
  return calls.reduce((last, call) =>
    call.startTimeUnixMs + call.durationMs >=
    last.startTimeUnixMs + last.durationMs
      ? call
      : last,
  );
}

function outcomeOf(calls: SessionCall[]): SessionOutcome {
  const last = lastFinished(calls);
  if (calls.some((call) => call.tool === MISSING_TOOL)) return 'missing_tool';
  if (!last.ok) return 'failed';
  if (last.paused) return 'paused';
  return calls.some((call) => !call.ok) ? 'recovered' : 'completed';
}

function collapse(tools: string[]): string[] {
  return tools.filter((tool, index) => tool !== tools[index - 1]);
}

export interface OutcomeCounts {
  completed: number;
  recovered: number;
  failed: number;
  paused: number;
  missing_tool: number;
}

function countOutcomes(sessions: McpSession[]): OutcomeCounts {
  const counts: OutcomeCounts = {
    completed: 0,
    recovered: 0,
    failed: 0,
    paused: 0,
    missing_tool: 0,
  };
  for (const session of sessions) counts[session.outcome]++;
  return counts;
}

/**
 * Rebuild agent sessions from MCP tool-call spans (autotel-mcp-instrumentation
 * with `sessionHandles` or a transport session, and `captureIntent` for the
 * why), then group sessions that took the same path through the tools.
 */
export function analyzeMcpSessions(
  spans: SpanRecord[],
  keep: (session: McpSession) => boolean = () => true,
): McpSessionReport {
  const calls = toolCalls(spans);
  const bySession = new Map<string, SpanRecord[]>();
  let unsessionedCalls = 0;
  for (const span of calls) {
    const id = sessionOf(span);
    if (id === undefined) unsessionedCalls++;
    else if (bySession.has(id)) bySession.get(id)!.push(span);
    else bySession.set(id, [span]);
  }

  const sessions = [...bySession]
    .map(([id, group]): McpSession => {
      const ordered = group.toSorted(
        (a, b) => a.startTimeUnixMs - b.startTimeUnixMs,
      );
      const calls = ordered.map((span): SessionCall => {
        const call: SessionCall = {
          tool: String(span.tags['gen_ai.tool.name']),
          startTimeUnixMs: span.startTimeUnixMs,
          durationMs: span.durationMs,
          ok: !span.hasError,
          traceId: span.traceId,
        };
        const intent = text(span.tags['mcp.tool.call.intent']);
        if (intent) call.intent = intent;
        const category = text(span.tags['mcp.failure.category']);
        if (category) call.failureCategory = category;
        if (span.tags['mcp.input_required'] === true) call.paused = true;
        const missingTool = text(span.tags['mcp.missing_tool.description']);
        if (missingTool) call.missingTool = missingTool;
        return call;
      });
      const first = ordered[0]!;
      const find = (key: string) =>
        ordered.map((span) => text(span.tags[key])).find(Boolean);
      const session: McpSession = {
        id,
        startTimeUnixMs: first.startTimeUnixMs,
        // Calls can overlap: the session ends when its last call finishes.
        endTimeUnixMs: Math.max(
          ...ordered.map((span) => span.startTimeUnixMs + span.durationMs),
        ),
        outcome: outcomeOf(calls),
        errors: calls.filter((call) => !call.ok).length,
        path: collapse(calls.map((call) => call.tool)),
        calls,
        service: first.serviceName,
      };
      const userId = find('user.id');
      const client = find('mcp.client.name');
      const agentModel = find('mcp.agent.model');
      if (userId) session.userId = userId;
      if (client) session.client = client;
      if (agentModel) session.agentModel = agentModel;
      return session;
    })
    .filter(keep);
  sessions.sort((a, b) => b.endTimeUnixMs - a.endTimeUnixMs);

  const byPath = new Map<string, McpSession[]>();
  for (const session of sessions) {
    const key = session.path.join(' > ');
    if (byPath.has(key)) byPath.get(key)!.push(session);
    else byPath.set(key, [session]);
  }
  const patterns = [...byPath.values()]
    .map((group): SessionPattern => {
      const done = group.filter(
        (s) => s.outcome === 'completed' || s.outcome === 'recovered',
      ).length;
      return {
        path: group[0]!.path,
        sessions: group.length,
        completionRate: done / group.length,
        outcomes: countOutcomes(group),
        intents: [
          ...new Set(group.flatMap((s) => s.calls[0]?.intent ?? [])),
        ].slice(0, 3),
        exampleSessionIds: group.slice(0, 3).map((s) => s.id),
      };
    })
    .toSorted((a, b) => b.sessions - a.sessions);

  const failedEnds = new Map<
    string,
    { tool: string; failureCategory: string; sessions: number }
  >();
  for (const session of sessions) {
    if (session.outcome !== 'failed') continue;
    const last = lastFinished(session.calls);
    const failureCategory = last.failureCategory ?? 'unknown';
    const key = `${last.tool}\u0000${failureCategory}`;
    const entry = failedEnds.get(key) ?? {
      tool: last.tool,
      failureCategory,
      sessions: 0,
    };
    entry.sessions++;
    failedEnds.set(key, entry);
  }

  const missing = new Map<string, number>();
  for (const { missingTool } of sessions.flatMap((s) => s.calls)) {
    if (missingTool)
      missing.set(missingTool, (missing.get(missingTool) ?? 0) + 1);
  }

  return {
    sessions,
    patterns,
    outcomes: countOutcomes(sessions),
    endedOn: [...failedEnds.values()].toSorted(
      (a, b) => b.sessions - a.sessions,
    ),
    missingTools: [...missing]
      .map(([description, reports]) => ({
        description,
        reports,
      }))
      .toSorted((a, b) => b.reports - a.reports),
    unsessionedCalls,
  };
}
