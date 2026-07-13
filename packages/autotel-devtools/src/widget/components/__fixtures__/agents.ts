/**
 * Sample agent sessions for stories + component tests, built through the real
 * `autotel-agents` reducers so the shapes (rollups, tool categories, MCP split,
 * sub-agents/skills) match production exactly. Imported only by stories/tests,
 * so it never ships in the widget bundle.
 */
import {
  ingestAgentEvents,
  ingestAgentMetrics,
  type AgentRawEvent,
  type AgentSession,
  type AgentSessionStore,
  type OtelMetricRecord,
} from 'autotel-agents';

const SCOPE = { name: 'com.anthropic.claude_code' };
const RESOURCE = { 'service.name': 'claude-code' };

function event(
  sessionId: string,
  eventName: string,
  timestamp: number,
  attributes: Record<string, unknown>,
): AgentRawEvent {
  return {
    eventName,
    timestamp,
    attributes: { 'session.id': sessionId, 'terminal.type': 'vscode', 'app.version': '1.2.3', ...attributes },
    resource: RESOURCE,
    scope: SCOPE,
  };
}

function linesMetric(sessionId: string, added: number, removed: number): OtelMetricRecord {
  return {
    name: 'claude_code.lines_of_code.count',
    unit: 'count',
    dataPoints: [
      { value: added, timestamp: 1000, attributes: { 'session.id': sessionId, type: 'added' } },
      { value: removed, timestamp: 1000, attributes: { 'session.id': sessionId, type: 'removed' } },
    ],
    resource: RESOURCE,
    scope: SCOPE,
  };
}

export function sampleAgentSessions(): AgentSession[] {
  const store: AgentSessionStore = new Map();
  let t = 1_700_000_000_000;
  const tick = () => (t += 1500);

  // ── Light session first, so the rich session below is the most recently
  //    active and therefore selected by default in the UI. ──
  const b = 'sess-quick-fix';
  ingestAgentEvents(store, [
    event(b, 'user_prompt', tick(), { prompt_length: 60 }),
    event(b, 'api_request', tick(), {
      model: 'claude-haiku-4',
      cost_usd: 0.0008,
      input_tokens: 1200,
      output_tokens: 300,
      duration_ms: 600,
    }),
    event(b, 'tool_result', tick(), { tool_name: 'Grep', success: 'true', duration_ms: 25 }),
  ]);

  // ── Rich session: prompts, model calls, sub-agent, skill, MCP, reject, error ──
  const a = 'sess-feature-build';
  ingestAgentEvents(store, [
    event(a, 'user_prompt', tick(), { prompt_length: 240 }),
    event(a, 'api_request', tick(), {
      model: 'claude-sonnet-4-6',
      cost_usd: 0.0123,
      input_tokens: 12000,
      output_tokens: 3400,
      cache_read_tokens: 800,
      duration_ms: 2200,
    }),
    event(a, 'tool_result', tick(), { tool_name: 'Read', success: 'true', duration_ms: 40 }),
    event(a, 'tool_result', tick(), { tool_name: 'Edit', success: 'true', decision: 'accept', duration_ms: 60 }),
    event(a, 'tool_result', tick(), { tool_name: 'Task', success: 'true', subagent_type: 'Explore', duration_ms: 8000 }),
    event(a, 'tool_result', tick(), { tool_name: 'Skill', success: 'true', skill: 'tdd', duration_ms: 120 }),
    event(a, 'tool_result', tick(), { tool_name: 'mcp__github__create_issue', success: 'true', duration_ms: 350 }),
    event(a, 'tool_decision', tick(), { tool_name: 'Bash', decision: 'reject' }),
    event(a, 'api_request', tick(), {
      model: 'claude-opus-4',
      cost_usd: 0.21,
      input_tokens: 28000,
      output_tokens: 5200,
      duration_ms: 4100,
    }),
    event(a, 'api_error', tick(), { model: 'claude-opus-4', status_code: 529, error: 'overloaded', duration_ms: 800 }),
    // Runtime environment: an MCP server connecting, a plugin loading, hooks firing.
    event(a, 'mcp_server_connection', tick(), {
      server_name: 'plugin:context7:context7',
      transport_type: 'stdio',
      status: 'connected',
      duration_ms: 1373,
    }),
    event(a, 'plugin_loaded', tick(), { 'plugin.name': 'context7', 'plugin.version': '1.2.0' }),
    event(a, 'hook_execution_complete', tick(), { hook_event: 'PreToolUse', num_success: 3, num_blocking: 1 }),
  ]);
  ingestAgentMetrics(store, [linesMetric(a, 86, 14)]);

  return [...store.values()];
}
