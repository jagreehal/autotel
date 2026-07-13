import { describe, expect, it } from 'vitest';
import {
  detectAdapterForEvent,
  detectAdapterForMetric,
  ingestEventRecord,
  ingestMetricRecord,
  parseToolName,
  summarizeSessions,
} from './index';
import type { AgentRawEvent, AgentSessionStore, OtelMetricRecord } from './index';

const SESSION = 'sess-1';

function event(eventName: string, attributes: Record<string, unknown>): AgentRawEvent {
  return {
    eventName,
    timestamp: 1000,
    attributes: { 'session.id': SESSION, ...attributes },
    resource: { 'service.name': 'claude-code' },
    scope: { name: 'com.anthropic.claude_code' },
  };
}

function metric(
  name: string,
  points: Array<{ value: number; attrs?: Record<string, unknown> }>,
  temporality?: 'delta' | 'cumulative',
): OtelMetricRecord {
  return {
    name,
    temporality,
    dataPoints: points.map((p) => ({
      value: p.value,
      timestamp: 2000,
      attributes: { 'session.id': SESSION, ...(p.attrs ?? {}) },
    })),
    resource: {},
    scope: { name: 'com.anthropic.claude_code' },
  };
}

describe('parseToolName', () => {
  it('splits MCP tools into server + tool', () => {
    expect(parseToolName('mcp__github__create_issue')).toEqual({
      name: 'mcp__github__create_issue',
      isMcp: true,
      mcpServer: 'github',
      mcpTool: 'create_issue',
    });
  });

  it('treats built-in tools as non-MCP', () => {
    expect(parseToolName('Edit')).toEqual({ name: 'Edit', isMcp: false });
  });

  it('handles MCP tool names with underscores in the tool segment', () => {
    const ref = parseToolName('mcp__linear__list_my_issues');
    expect(ref.mcpServer).toBe('linear');
    expect(ref.mcpTool).toBe('list_my_issues');
  });
});

describe('detection', () => {
  it('claims claude_code metrics and events by prefix', () => {
    expect(detectAdapterForMetric(metric('claude_code.token.usage', [{ value: 1 }]))?.kind).toBe('claude-code');
    expect(detectAdapterForEvent(event('claude_code.api_request', {}))?.kind).toBe('claude-code');
  });

  it('claims opencode by prefix', () => {
    const m: OtelMetricRecord = {
      name: 'opencode.cost.usage',
      dataPoints: [],
      resource: {},
      scope: { name: 'com.opencode' },
    };
    expect(detectAdapterForMetric(m)?.kind).toBe('opencode');
  });

  it('ignores unrelated telemetry', () => {
    const m: OtelMetricRecord = { name: 'http.server.duration', dataPoints: [], resource: {}, scope: {} };
    expect(detectAdapterForMetric(m)).toBeUndefined();
  });

  it('does NOT claim an app log just because event.name looks like an agent event', () => {
    // A normal app log with no agent prefix/scope/service must not become a session.
    const appLog: AgentRawEvent = {
      eventName: 'api_request',
      timestamp: 1,
      attributes: { 'event.name': 'api_request', 'session.id': 'sess-x' },
      resource: { 'service.name': 'com.example.app' },
      scope: { name: 'com.example.app' },
    };
    expect(detectAdapterForEvent(appLog)).toBeUndefined();
  });

  it('claims an agent event by service.name even without scope or prefix', () => {
    const ccLog: AgentRawEvent = {
      eventName: 'api_request',
      timestamp: 1,
      attributes: { 'event.name': 'api_request', 'session.id': 'sess-x' },
      resource: { 'service.name': 'claude-code' },
    };
    expect(detectAdapterForEvent(ccLog)?.kind).toBe('claude-code');
  });
});

describe('api_request events', () => {
  it('uses reported cost and accumulates tokens', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(
      store,
      event('claude_code.api_request', {
        model: 'claude-sonnet-4-6',
        cost_usd: 0.012,
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_tokens: 200,
        duration_ms: 850,
      }),
    );
    const s = store.get(SESSION)!;
    expect(s.rollup.apiRequests).toBe(1);
    expect(s.rollup.costUsd).toBeCloseTo(0.012);
    expect(s.rollup.costReportedUsd).toBeCloseTo(0.012);
    expect(s.rollup.inputTokens).toBe(1000);
    expect(s.rollup.outputTokens).toBe(500);
    expect(s.rollup.cacheReadTokens).toBe(200);
    expect(s.rollup.models['claude-sonnet-4-6']).toBe(1);
    expect(s.timeline[0]?.costSource).toBe('reported');
  });

  it('estimates cost from tokens when none reported', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(
      store,
      event('claude_code.api_request', {
        model: 'claude-sonnet-4-6',
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      }),
    );
    const s = store.get(SESSION)!;
    // sonnet fallback: $3 in + $15 out per 1M
    expect(s.rollup.costUsd).toBeCloseTo(18);
    expect(s.rollup.costEstimatedUsd).toBeCloseTo(18);
    expect(s.timeline[0]?.costSource).toBe('estimated');
  });
});

describe('tool decisions and MCP', () => {
  it('counts accept/reject from tool_decision and tracks per-tool usage', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(store, event('claude_code.tool_decision', { tool_name: 'mcp__github__create_issue', decision: 'accept' }));
    ingestEventRecord(store, event('claude_code.tool_decision', { tool_name: 'Bash', decision: 'reject' }));
    ingestEventRecord(store, event('claude_code.tool_result', { tool_name: 'Edit', success: 'true', duration_ms: 30 }));
    const s = store.get(SESSION)!;
    expect(s.rollup.accepted).toBe(1);
    expect(s.rollup.rejected).toBe(1);
    expect(s.rollup.tools['mcp__github__create_issue']?.isMcp).toBe(true);
    expect(s.rollup.tools['mcp__github__create_issue']?.mcpServer).toBe('github');
    expect(s.rollup.tools['Edit']?.count).toBe(1);
  });

  it('does NOT double-count one decision across tool_decision + tool_result + code_edit metric', () => {
    // A single accepted code edit can arrive three ways. Only tool_decision counts.
    const store: AgentSessionStore = new Map();
    ingestEventRecord(store, event('claude_code.tool_decision', { tool_name: 'Edit', decision: 'accept' }));
    ingestEventRecord(store, event('claude_code.tool_result', { tool_name: 'Edit', success: 'true', decision: 'accept' }));
    ingestMetricRecord(store, metric('claude_code.code_edit_tool.decision', [{ value: 1, attrs: { tool: 'Edit', decision: 'accept' } }]));
    const s = store.get(SESSION)!;
    expect(s.rollup.accepted).toBe(1);
    expect(s.rollup.rejected).toBe(0);
  });
});

describe('metric-only signals', () => {
  it('folds lines, commits, PRs by session', () => {
    const store: AgentSessionStore = new Map();
    ingestMetricRecord(store, metric('claude_code.lines_of_code.count', [
      { value: 40, attrs: { type: 'added' } },
      { value: 12, attrs: { type: 'removed' } },
    ]));
    ingestMetricRecord(store, metric('claude_code.commit.count', [{ value: 2 }]));
    const s = store.get(SESSION)!;
    expect(s.rollup.linesAdded).toBe(40);
    expect(s.rollup.linesRemoved).toBe(12);
    expect(s.rollup.commits).toBe(2);
  });

  it('sums delta counters but differences cumulative counters (no per-interval inflation)', () => {
    // Delta: each export carries the change → summed.
    const deltaStore: AgentSessionStore = new Map();
    ingestMetricRecord(deltaStore, metric('claude_code.commit.count', [{ value: 1 }], 'delta'));
    ingestMetricRecord(deltaStore, metric('claude_code.commit.count', [{ value: 1 }], 'delta'));
    expect(deltaStore.get(SESSION)!.rollup.commits).toBe(2);

    // Cumulative: re-exporting the same running total must NOT inflate.
    const cumStore: AgentSessionStore = new Map();
    ingestMetricRecord(cumStore, metric('claude_code.lines_of_code.count', [{ value: 42, attrs: { type: 'added' } }], 'cumulative'));
    ingestMetricRecord(cumStore, metric('claude_code.lines_of_code.count', [{ value: 42, attrs: { type: 'added' } }], 'cumulative'));
    expect(cumStore.get(SESSION)!.rollup.linesAdded).toBe(42);
    // A real increase advances the total by the difference only.
    ingestMetricRecord(cumStore, metric('claude_code.lines_of_code.count', [{ value: 50, attrs: { type: 'added' } }], 'cumulative'));
    expect(cumStore.get(SESSION)!.rollup.linesAdded).toBe(50);
  });

  it('does NOT double-count cost/token metrics that overlap api_request events', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(store, event('claude_code.api_request', { cost_usd: 0.5, input_tokens: 100 }));
    // same fact also arrives as a metric — must be ignored for rollup totals
    ingestMetricRecord(store, metric('claude_code.cost.usage', [{ value: 0.5 }]));
    ingestMetricRecord(store, metric('claude_code.token.usage', [{ value: 100, attrs: { type: 'input' } }]));
    const s = store.get(SESSION)!;
    expect(s.rollup.costUsd).toBeCloseTo(0.5);
    expect(s.rollup.inputTokens).toBe(100);
  });
});

describe('timeline ring buffer', () => {
  it('caps the raw timeline while keeping rollup totals', () => {
    const store: AgentSessionStore = new Map();
    for (let i = 0; i < 10; i++) {
      ingestEventRecord(store, event('claude_code.api_request', { cost_usd: 1 }), { timelineLimit: 3 });
    }
    const s = store.get(SESSION)!;
    expect(s.timeline.length).toBe(3);
    expect(s.rollup.apiRequests).toBe(10);
    expect(s.rollup.costUsd).toBeCloseTo(10);
    expect(s.eventCount).toBe(10);
  });
});

describe('tool taxonomy: sub-agents, skills, categories', () => {
  it('classifies Task as sub-agent, Skill as skill, and counts categories', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(store, event('claude_code.tool_result', { tool_name: 'Task', success: 'true', subagent_type: 'Explore' }));
    ingestEventRecord(store, event('claude_code.tool_result', { tool_name: 'Skill', success: 'true', skill: 'tdd' }));
    ingestEventRecord(store, event('claude_code.tool_result', { tool_name: 'Edit', success: 'true' }));
    ingestEventRecord(store, event('claude_code.tool_result', { tool_name: 'Bash', success: 'true' }));
    ingestEventRecord(store, event('claude_code.tool_result', { tool_name: 'mcp__github__create_issue', success: 'true' }));
    const s = store.get(SESSION)!;
    expect(s.rollup.toolCategories.subagent).toBe(1);
    expect(s.rollup.toolCategories.skill).toBe(1);
    expect(s.rollup.toolCategories.file).toBe(1);
    expect(s.rollup.toolCategories.shell).toBe(1);
    expect(s.rollup.toolCategories.mcp).toBe(1);
    expect(s.rollup.subAgents['Explore']).toBe(1);
    expect(s.rollup.skills['tdd']).toBe(1);
    expect(s.timeline[0]?.tool?.subAgentType).toBe('Explore');
    expect(s.timeline[0]?.tool?.category).toBe('subagent');
  });

  it('falls back to generic buckets when sub-agent type / skill name absent', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(store, event('claude_code.tool_result', { tool_name: 'Task', success: 'true' }));
    ingestEventRecord(store, event('claude_code.tool_result', { tool_name: 'Skill', success: 'true' }));
    const s = store.get(SESSION)!;
    expect(s.rollup.subAgents['subagent']).toBe(1);
    expect(s.rollup.skills['skill']).toBe(1);
  });
});

describe('summarizeSessions', () => {
  it('aggregates cost, models and MCP servers across sessions', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(store, event('claude_code.api_request', { model: 'opus', cost_usd: 1 }));
    ingestEventRecord(store, event('claude_code.tool_result', { tool_name: 'mcp__github__create_issue', success: 'true' }));
    const agg = summarizeSessions(store.values());
    expect(agg.sessions).toBe(1);
    expect(agg.costUsd).toBeCloseTo(1);
    expect(agg.models['opus']).toBe(1);
    expect(agg.mcpServers['github']).toBe(1);
  });
});

describe('runtime environment (mcp / plugin / hook events)', () => {
  it('tracks MCP server connect/disconnect lifecycle', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(store, event('claude_code.mcp_server_connection', {
      server_name: 'plugin:context7:context7',
      transport_type: 'stdio',
      status: 'connected',
      duration_ms: 1373,
    }));
    ingestEventRecord(store, event('claude_code.mcp_server_connection', {
      server_name: 'plugin:context7:context7',
      transport_type: 'stdio',
      status: 'disconnected',
      duration_ms: 13011,
    }));
    const info = store.get(SESSION)!.rollup.mcpConnections['plugin:context7:context7'];
    expect(info?.transport).toBe('stdio');
    expect(info?.connects).toBe(1);
    expect(info?.disconnects).toBe(1);
    expect(info?.connected).toBe(false); // last event was a disconnect
  });

  it('records loaded plugins (deduped by name) and hook executions', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(store, event('claude_code.plugin_loaded', { 'plugin.name': 'context7', 'plugin.version': '1.2.0' }));
    ingestEventRecord(store, event('claude_code.plugin_loaded', { 'plugin.name': 'context7', 'plugin.version': '1.2.0' }));
    ingestEventRecord(store, event('claude_code.hook_execution_complete', {
      hook_event: 'PreToolUse',
      num_success: 2,
      num_blocking: 1,
      num_non_blocking_error: 0,
      num_cancelled: 0,
    }));
    const r = store.get(SESSION)!.rollup;
    expect(Object.keys(r.plugins)).toEqual(['context7']);
    expect(r.plugins['context7']?.version).toBe('1.2.0');
    expect(r.hooks.runs).toBe(1);
    expect(r.hooks.blocked).toBe(1);
  });

  it('surfaces environment data in summarizeSessions', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(store, event('claude_code.mcp_server_connection', { server_name: 'ctx7', status: 'connected' }));
    ingestEventRecord(store, event('claude_code.plugin_loaded', { 'plugin.name': 'ctx7' }));
    ingestEventRecord(store, event('claude_code.hook_execution_complete', { num_cancelled: 1 }));
    const agg = summarizeSessions(store.values());
    expect(agg.mcpConnections['ctx7']?.connected).toBe(true);
    expect(agg.plugins['ctx7']).toBeDefined();
    expect(agg.hooks.cancelled).toBe(1);
  });
});
