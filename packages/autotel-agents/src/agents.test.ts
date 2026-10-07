import { describe, expect, it } from 'vitest';
import {
  detectAdapterForEvent,
  detectAdapterForMetric,
  ingestEventRecord,
  ingestMetricRecord,
  parseToolName,
  summarizeSessions,
  accountingStatus,
  REPOSITORY_EVENT,
  usageReport,
} from './index';
import { CLAUDE_CODE_KNOWN_EVENT_NAMES } from './adapters/claude-code';
import type {
  AgentRawEvent,
  AgentSessionStore,
  Attributes,
  OtelMetricRecord,
} from './index';

const SESSION = 'sess-1';

function event(eventName: string, attributes: Attributes): AgentRawEvent {
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
  points: Array<{ value: number; attrs?: Attributes }>,
  temporality?: 'delta' | 'cumulative',
): OtelMetricRecord {
  return {
    name,
    temporality,
    dataPoints: points.map((p) => ({
      value: p.value,
      timestamp: 2000,
      attributes: { 'session.id': SESSION, ...p.attrs },
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
    expect(
      detectAdapterForMetric(metric('claude_code.token.usage', [{ value: 1 }]))
        ?.kind,
    ).toBe('claude-code');
    expect(
      detectAdapterForEvent(event('claude_code.api_request', {}))?.kind,
    ).toBe('claude-code');
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
    const m: OtelMetricRecord = {
      name: 'http.server.duration',
      dataPoints: [],
      resource: {},
      scope: {},
    };
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
    expect(s.rollup.byModel['claude-sonnet-4-6'].requests).toBe(1);
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
    ingestEventRecord(
      store,
      event('claude_code.tool_decision', {
        tool_name: 'mcp__github__create_issue',
        decision: 'accept',
      }),
    );
    ingestEventRecord(
      store,
      event('claude_code.tool_decision', {
        tool_name: 'Bash',
        decision: 'reject',
      }),
    );
    ingestEventRecord(
      store,
      event('claude_code.tool_result', {
        tool_name: 'Edit',
        success: 'true',
        duration_ms: 30,
      }),
    );
    const s = store.get(SESSION)!;
    expect(s.rollup.accepted).toBe(1);
    expect(s.rollup.rejected).toBe(1);
    expect(s.rollup.tools['mcp__github__create_issue']?.isMcp).toBe(true);
    expect(s.rollup.tools['mcp__github__create_issue']?.mcpServer).toBe(
      'github',
    );
    expect(s.rollup.tools['Edit']?.count).toBe(1);
  });

  it('does NOT double-count one decision across tool_decision + tool_result + code_edit metric', () => {
    // A single accepted code edit can arrive three ways. Only tool_decision counts.
    const store: AgentSessionStore = new Map();
    ingestEventRecord(
      store,
      event('claude_code.tool_decision', {
        tool_name: 'Edit',
        decision: 'accept',
      }),
    );
    ingestEventRecord(
      store,
      event('claude_code.tool_result', {
        tool_name: 'Edit',
        success: 'true',
        decision: 'accept',
      }),
    );
    ingestMetricRecord(
      store,
      metric('claude_code.code_edit_tool.decision', [
        { value: 1, attrs: { tool: 'Edit', decision: 'accept' } },
      ]),
    );
    const s = store.get(SESSION)!;
    expect(s.rollup.accepted).toBe(1);
    expect(s.rollup.rejected).toBe(0);
  });
});

describe('metric-only signals', () => {
  it('folds lines, commits, PRs by session', () => {
    const store: AgentSessionStore = new Map();
    ingestMetricRecord(
      store,
      metric('claude_code.lines_of_code.count', [
        { value: 40, attrs: { type: 'added' } },
        { value: 12, attrs: { type: 'removed' } },
      ]),
    );
    ingestMetricRecord(
      store,
      metric('claude_code.commit.count', [{ value: 2 }]),
    );
    const s = store.get(SESSION)!;
    expect(s.rollup.linesAdded).toBe(40);
    expect(s.rollup.linesRemoved).toBe(12);
    expect(s.rollup.commits).toBe(2);
  });

  it('sums delta counters but differences cumulative counters (no per-interval inflation)', () => {
    // Delta: each export carries the change → summed.
    const deltaStore: AgentSessionStore = new Map();
    ingestMetricRecord(
      deltaStore,
      metric('claude_code.commit.count', [{ value: 1 }], 'delta'),
    );
    ingestMetricRecord(
      deltaStore,
      metric('claude_code.commit.count', [{ value: 1 }], 'delta'),
    );
    expect(deltaStore.get(SESSION)!.rollup.commits).toBe(2);

    // Cumulative: re-exporting the same running total must NOT inflate.
    const cumStore: AgentSessionStore = new Map();
    ingestMetricRecord(
      cumStore,
      metric(
        'claude_code.lines_of_code.count',
        [{ value: 42, attrs: { type: 'added' } }],
        'cumulative',
      ),
    );
    ingestMetricRecord(
      cumStore,
      metric(
        'claude_code.lines_of_code.count',
        [{ value: 42, attrs: { type: 'added' } }],
        'cumulative',
      ),
    );
    expect(cumStore.get(SESSION)!.rollup.linesAdded).toBe(42);
    // A real increase advances the total by the difference only.
    ingestMetricRecord(
      cumStore,
      metric(
        'claude_code.lines_of_code.count',
        [{ value: 50, attrs: { type: 'added' } }],
        'cumulative',
      ),
    );
    expect(cumStore.get(SESSION)!.rollup.linesAdded).toBe(50);
  });

  it('does NOT double-count cost/token metrics that overlap api_request events', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(
      store,
      event('claude_code.api_request', { cost_usd: 0.5, input_tokens: 100 }),
    );
    // same fact also arrives as a metric — must be ignored for rollup totals
    ingestMetricRecord(
      store,
      metric('claude_code.cost.usage', [{ value: 0.5 }]),
    );
    ingestMetricRecord(
      store,
      metric('claude_code.token.usage', [
        { value: 100, attrs: { type: 'input' } },
      ]),
    );
    const s = store.get(SESSION)!;
    expect(s.rollup.costUsd).toBeCloseTo(0.5);
    expect(s.rollup.inputTokens).toBe(100);
  });
});

describe('timeline ring buffer', () => {
  it('caps the raw timeline while keeping rollup totals', () => {
    const store: AgentSessionStore = new Map();
    for (let i = 0; i < 10; i++) {
      ingestEventRecord(
        store,
        event('claude_code.api_request', { cost_usd: 1 }),
        { timelineLimit: 3 },
      );
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
    ingestEventRecord(
      store,
      event('claude_code.tool_result', {
        tool_name: 'Task',
        success: 'true',
        subagent_type: 'Explore',
      }),
    );
    ingestEventRecord(
      store,
      event('claude_code.tool_result', {
        tool_name: 'Skill',
        success: 'true',
        skill: 'tdd',
      }),
    );
    ingestEventRecord(
      store,
      event('claude_code.tool_result', { tool_name: 'Edit', success: 'true' }),
    );
    ingestEventRecord(
      store,
      event('claude_code.tool_result', { tool_name: 'Bash', success: 'true' }),
    );
    ingestEventRecord(
      store,
      event('claude_code.tool_result', {
        tool_name: 'mcp__github__create_issue',
        success: 'true',
      }),
    );
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
    ingestEventRecord(
      store,
      event('claude_code.tool_result', { tool_name: 'Task', success: 'true' }),
    );
    ingestEventRecord(
      store,
      event('claude_code.tool_result', { tool_name: 'Skill', success: 'true' }),
    );
    const s = store.get(SESSION)!;
    expect(s.rollup.subAgents['subagent']).toBe(1);
    expect(s.rollup.skills['skill']).toBe(1);
  });
});

describe('summarizeSessions', () => {
  it('aggregates cost, models and MCP servers across sessions', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(
      store,
      event('claude_code.api_request', { model: 'opus', cost_usd: 1 }),
    );
    ingestEventRecord(
      store,
      event('claude_code.tool_result', {
        tool_name: 'mcp__github__create_issue',
        success: 'true',
      }),
    );
    const agg = summarizeSessions(store.values());
    expect(agg.sessions).toBe(1);
    expect(agg.costUsd).toBeCloseTo(1);
    expect(agg.byModel['opus'].requests).toBe(1);
    expect(agg.mcpServers['github']).toBe(1);
  });
});

describe('runtime environment (mcp / plugin / hook events)', () => {
  it('tracks MCP server connect/disconnect lifecycle', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(
      store,
      event('claude_code.mcp_server_connection', {
        server_name: 'plugin:context7:context7',
        transport_type: 'stdio',
        status: 'connected',
        duration_ms: 1373,
      }),
    );
    ingestEventRecord(
      store,
      event('claude_code.mcp_server_connection', {
        server_name: 'plugin:context7:context7',
        transport_type: 'stdio',
        status: 'disconnected',
        duration_ms: 13_011,
      }),
    );
    const info =
      store.get(SESSION)!.rollup.mcpConnections['plugin:context7:context7'];
    expect(info?.transport).toBe('stdio');
    expect(info?.connects).toBe(1);
    expect(info?.disconnects).toBe(1);
    expect(info?.connected).toBe(false); // last event was a disconnect
  });

  it('records loaded plugins (deduped by name) and hook executions', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(
      store,
      event('claude_code.plugin_loaded', {
        'plugin.name': 'context7',
        'plugin.version': '1.2.0',
      }),
    );
    ingestEventRecord(
      store,
      event('claude_code.plugin_loaded', {
        'plugin.name': 'context7',
        'plugin.version': '1.2.0',
      }),
    );
    ingestEventRecord(
      store,
      event('claude_code.hook_execution_complete', {
        hook_event: 'PreToolUse',
        num_success: 2,
        num_blocking: 1,
        num_non_blocking_error: 0,
        num_cancelled: 0,
      }),
    );
    const r = store.get(SESSION)!.rollup;
    expect(Object.keys(r.plugins)).toEqual(['context7']);
    expect(r.plugins['context7']?.version).toBe('1.2.0');
    expect(r.hooks.runs).toBe(1);
    expect(r.hooks.blocked).toBe(1);
  });

  it('surfaces environment data in summarizeSessions', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(
      store,
      event('claude_code.mcp_server_connection', {
        server_name: 'ctx7',
        status: 'connected',
      }),
    );
    ingestEventRecord(
      store,
      event('claude_code.plugin_loaded', { 'plugin.name': 'ctx7' }),
    );
    ingestEventRecord(
      store,
      event('claude_code.hook_execution_complete', { num_cancelled: 1 }),
    );
    const agg = summarizeSessions(store.values());
    expect(agg.mcpConnections['ctx7']?.connected).toBe(true);
    expect(agg.plugins['ctx7']).toBeDefined();
    expect(agg.hooks.cancelled).toBe(1);
  });
});

// ── Per-prompt, per-skill, per-agent and per-effort attribution ─────────────
// Claude Code now stamps `prompt.id`, `agent.name`, `skill.name`, `effort` and
// `speed` on api_request (and the cost/token metrics). Without them a session
// is one undifferentiated bill; with them it splits by what actually drove the
// spend. See https://code.claude.com/docs/en/monitoring-usage.

function apiRequest(attrs: Attributes): AgentRawEvent {
  return event('claude_code.api_request', {
    model: 'claude-opus-5',
    input_tokens: 10,
    output_tokens: 5,
    cache_read_tokens: 100,
    cache_creation_tokens: 20,
    cost_usd: 0.25,
    ...attrs,
  });
}

function ingest(...records: AgentRawEvent[]): AgentSessionStore {
  const store: AgentSessionStore = new Map();
  for (const record of records) ingestEventRecord(store, record);
  return store;
}

function only(store: AgentSessionStore) {
  return [...store.values()][0];
}

describe('prompt correlation', () => {
  it('carries prompt.id onto every event, whatever its type', () => {
    const store = ingest(
      apiRequest({ 'prompt.id': 'p-1' }),
      event('claude_code.user_prompt', {
        'prompt.id': 'p-1',
        prompt_length: 12,
      }),
    );
    const ids = only(store).timeline.map((e) => e.promptId);
    expect(ids).toEqual(['p-1', 'p-1']);
  });

  it('leaves promptId undefined when the agent does not send one', () => {
    expect(only(ingest(apiRequest({}))).timeline[0].promptId).toBeUndefined();
  });
});

describe('usage breakdowns', () => {
  it('splits cost and tokens by model', () => {
    const store = ingest(
      apiRequest({ model: 'claude-opus-5' }),
      apiRequest({ model: 'claude-opus-5' }),
      apiRequest({ model: 'claude-haiku-4-5', cost_usd: 0.01 }),
    );
    const { byModel } = only(store).rollup;
    expect(byModel['claude-opus-5']).toEqual({
      requests: 2,
      costUsd: 0.5,
      inputTokens: 20,
      outputTokens: 10,
      cacheReadTokens: 200,
      cacheCreationTokens: 40,
      unpriced: 0,
      untokened: 0,
    });
    expect(byModel['claude-haiku-4-5'].costUsd).toBeCloseTo(0.01);
  });

  it('splits by effort, skill and sub-agent name', () => {
    const store = ingest(
      apiRequest({ effort: 'high', 'skill.name': 'tdd' }),
      apiRequest({ effort: 'medium', 'agent.name': 'Explore' }),
    );
    const { byEffort, bySkill, byAgent } = only(store).rollup;
    expect(byEffort['high'].costUsd).toBeCloseTo(0.25);
    expect(byEffort['medium'].requests).toBe(1);
    expect(bySkill['tdd'].costUsd).toBeCloseTo(0.25);
    expect(byAgent['Explore'].requests).toBe(1);
    // A request naming no skill is not filed under one.
    expect(Object.keys(bySkill)).toEqual(['tdd']);
  });

  it('reads effort and speed onto the event', () => {
    const e = only(ingest(apiRequest({ effort: 'high', speed: 'fast' })))
      .timeline[0];
    expect(e.effort).toBe('high');
    expect(e.speed).toBe('fast');
  });

  it('sums per-model usage across sessions', () => {
    const store = ingest(apiRequest({}));
    ingestEventRecord(store, {
      ...apiRequest({}),
      attributes: { ...apiRequest({}).attributes, 'session.id': 'sess-2' },
    });
    const agg = summarizeSessions(store.values());
    expect(agg.byModel['claude-opus-5'].requests).toBe(2);
    expect(agg.byModel['claude-opus-5'].costUsd).toBeCloseTo(0.5);
  });
});

describe('api_refusal', () => {
  it('counts a refusal without charging it as an error', () => {
    const store = ingest(
      event('claude_code.api_refusal', { model: 'claude-opus-5' }),
    );
    const { rollup } = only(store);
    expect(rollup.apiRefusals).toBe(1);
    expect(rollup.apiErrors).toBe(0);
    expect(only(store).timeline[0].type).toBe('api_refusal');
  });
});

describe('event-name contract', () => {
  it('knows the events Claude Code emits that this package does not model', () => {
    // Documented but deliberately unmodelled: listing them is what keeps the
    // drift guard meaningful — an event in neither list is one to triage.
    for (const name of ['api_refusal', 'permission_mode_changed', 'auth']) {
      expect(CLAUDE_CODE_KNOWN_EVENT_NAMES.has(name)).toBe(true);
    }
  });
});

// ── Untrusted keys ─────────────────────────────────────────────────────────
// Every breakdown is keyed by a value that arrived over the wire. A key like
// `__proto__` or `constructor` names a property every object already has, so a
// bucket that inherits from Object.prototype reads one back instead of missing,
// then writes the tally onto the prototype — corrupting every object in the
// process and recording nothing.

describe('buckets keyed by wire values', () => {
  const HOSTILE = ['__proto__', 'constructor', 'toString'];

  it('files a hostile model name as an ordinary key', () => {
    for (const name of HOSTILE) {
      const store = ingest(apiRequest({ model: name }));
      const { byModel } = only(store).rollup;
      expect(Object.keys(byModel)).toEqual([name]);
      expect(byModel[name].requests).toBe(1);
      expect(byModel[name].costUsd).toBeCloseTo(0.25);
    }
  });

  it('leaves Object.prototype alone', () => {
    ingest(
      apiRequest({
        model: '__proto__',
        effort: '__proto__',
        'skill.name': '__proto__',
        'agent.name': '__proto__',
        'prompt.id': '__proto__',
      }),
      event('claude_code.tool_result', {
        tool_name: '__proto__',
        success: true,
      }),
      event('claude_code.mcp_server_connection', {
        server_name: '__proto__',
        status: 'connected',
      }),
      event('claude_code.plugin_loaded', { 'plugin.name': '__proto__' }),
    );
    // `in` walks the prototype chain, which is the thing under test: a
    // polluted Object.prototype makes every plain object answer to these.
    for (const field of ['requests', 'costUsd', 'count', 'connects', 'name']) {
      expect(field in {}).toBe(false);
    }
  });

  it('survives a hostile key in the cross-session aggregate', () => {
    const store = ingest(apiRequest({ model: '__proto__' }));
    const agg = summarizeSessions(store.values());
    expect(agg.byModel['__proto__'].requests).toBe(1);
    expect('requests' in {}).toBe(false);
  });
});

describe('per-prompt spend', () => {
  it('keeps a prompt total that outlives the timeline', () => {
    const store = ingest(
      apiRequest({ 'prompt.id': 'p-1' }),
      apiRequest({ 'prompt.id': 'p-1' }),
      apiRequest({ 'prompt.id': 'p-2' }),
    );
    const { byPrompt } = only(store).rollup;
    expect(byPrompt['p-1'].requests).toBe(2);
    expect(byPrompt['p-1'].costUsd).toBeCloseTo(0.5);
    expect(byPrompt['p-2'].requests).toBe(1);
  });

  it('does not invent a prompt for a request that names none', () => {
    expect(Object.keys(only(ingest(apiRequest({}))).rollup.byPrompt)).toEqual(
      [],
    );
  });
});

describe('aggregate breakdowns', () => {
  it('sums effort, skill and agent across sessions, like model', () => {
    const store = ingest(
      apiRequest({
        effort: 'high',
        'skill.name': 'tdd',
        'agent.name': 'Explore',
      }),
    );
    const agg = summarizeSessions(store.values());
    expect(agg.byEffort['high'].requests).toBe(1);
    expect(agg.bySkill['tdd'].costUsd).toBeCloseTo(0.25);
    expect(agg.byAgent['Explore'].requests).toBe(1);
  });
});

describe('codex adapter', () => {
  const CONV = 'conv-1';
  function codex(eventName: string, attributes: Attributes): AgentRawEvent {
    return {
      eventName,
      timestamp: 1000,
      attributes: { 'conversation.id': CONV, ...attributes },
      resource: { 'service.name': 'codex_cli_rs' },
    };
  }

  it('reads tokens off response.completed, with cached input split out', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(
      store,
      codex('codex.sse_event', {
        'event.kind': 'response.completed',
        model: 'gpt-5-codex',
        'turn.id': 'turn-1',
        input_token_count: 1000,
        cached_token_count: 800,
        output_token_count: 50,
        reasoning_token_count: 20,
      }),
    );
    const session = store.get(CONV)!;
    expect(session.agent).toBe('codex');
    expect(session.rollup).toMatchObject({
      apiRequests: 1,
      inputTokens: 200,
      cacheReadTokens: 800,
      outputTokens: 50,
    });
    expect(session.rollup.byPrompt['turn-1']?.requests).toBe(1);
  });

  it('drops stream deltas and successful transport attempts', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(
      store,
      codex('codex.sse_event', { 'event.kind': 'response.output_text.delta' }),
    );
    ingestEventRecord(
      store,
      codex('codex.api_request', { 'http.response.status_code': 200 }),
    );
    expect(store.size).toBe(0);
  });

  it('counts a failed attempt as an error, not a request', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(
      store,
      codex('codex.api_request', {
        'http.response.status_code': 429,
        'error.message': 'rate limited',
      }),
    );
    expect(store.get(CONV)!.rollup).toMatchObject({
      apiRequests: 0,
      apiErrors: 1,
    });
  });

  it('maps approval outcomes and tool results', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(
      store,
      codex('codex.tool_decision', {
        tool_name: 'shell',
        decision: 'approved_for_session',
      }),
    );
    ingestEventRecord(
      store,
      codex('codex.tool_decision', { tool_name: 'shell', decision: 'denied' }),
    );
    ingestEventRecord(
      store,
      codex('codex.tool_result', {
        tool_name: 'shell',
        success: 'false',
        duration_ms: 12,
      }),
    );
    const { rollup } = store.get(CONV)!;
    expect(rollup).toMatchObject({ accepted: 1, rejected: 1, toolCalls: 1 });
    expect(rollup.tools['shell']).toMatchObject({ count: 1, failures: 1 });
  });

  it('leaves redacted prompt text out', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(
      store,
      codex('codex.user_prompt', { prompt_length: 12, prompt: '[REDACTED]' }),
    );
    const [prompt] = store.get(CONV)!.timeline;
    expect(prompt).toMatchObject({ type: 'user_prompt', promptLength: 12 });
    expect(prompt?.promptText).toBeUndefined();
  });

  it('does not open sessions from metrics it cannot attribute', () => {
    const store: AgentSessionStore = new Map();
    ingestMetricRecord(store, {
      name: 'codex.turn.token_usage',
      dataPoints: [{ value: 5, timestamp: 1, attributes: {} }],
      resource: { 'service.name': 'codex_cli_rs' },
    });
    expect(store.size).toBe(0);
  });
});

describe('accounting status', () => {
  it('marks spend unknown when no request was priced, partial when some were', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(
      store,
      event('claude_code.api_request', {
        model: 'some-unpriced-model',
        input_tokens: 10,
      }),
    );
    let { rollup } = store.get(SESSION)!;
    expect(rollup.unpricedRequests).toBe(1);
    expect(accountingStatus(rollup.apiRequests, rollup.unpricedRequests)).toBe(
      'unknown',
    );
    expect(rollup.byModel['some-unpriced-model']?.unpriced).toBe(1);

    ingestEventRecord(
      store,
      event('claude_code.api_request', { model: 'x', cost_usd: 0.5 }),
    );
    ({ rollup } = store.get(SESSION)!);
    expect(rollup.untokenedRequests).toBe(1);
    expect(accountingStatus(rollup.apiRequests, rollup.unpricedRequests)).toBe(
      'partial',
    );
    expect(summarizeSessions(store.values()).unpricedRequests).toBe(1);
  });

  it('calls no requests unknown, not complete', () => {
    expect(accountingStatus(0, 0)).toBe('unknown');
    expect(accountingStatus(3, 0)).toBe('complete');
  });
});

describe('repository correlation', () => {
  it('stamps the session with the repository the hook reports', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(store, {
      eventName: REPOSITORY_EVENT,
      timestamp: 1,
      attributes: {
        'session.id': SESSION,
        'agent.kind': 'claude-code',
        'repository.name': 'autotel',
        'repository.path': '/src/autotel',
      },
      resource: {},
    });
    ingestEventRecord(
      store,
      event('claude_code.user_prompt', { prompt_length: 3 }),
    );
    const session = store.get(SESSION)!;
    expect(session.agent).toBe('claude-code');
    expect(session.repository).toEqual({
      name: 'autotel',
      path: '/src/autotel',
    });
    expect(session.rollup.prompts).toBe(1);
  });
});

describe('codex websocket transport', () => {
  const ws = (eventName: string, attributes: Attributes): AgentRawEvent => ({
    eventName,
    timestamp: 1,
    attributes: { 'conversation.id': 'conv-ws', ...attributes },
    resource: {},
  });

  it('counts a completed websocket response as the request and a failure as an error', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(
      store,
      ws('codex.websocket_event', {
        'event.kind': 'response.completed',
        input_token_count: 10,
        output_token_count: 2,
      }),
    );
    ingestEventRecord(
      store,
      ws('codex.websocket_event', {
        'event.kind': 'response.output_text.delta',
      }),
    );
    ingestEventRecord(
      store,
      ws('codex.websocket_request', {
        success: false,
        'error.message': 'closed',
      }),
    );
    ingestEventRecord(store, ws('codex.websocket_request', { success: true }));
    const session = store.get('conv-ws')!;
    expect(session.rollup).toMatchObject({ apiRequests: 1, apiErrors: 1 });
    expect(session.timeline).toHaveLength(2);
  });
});

describe('usageReport', () => {
  function seed(): AgentSessionStore {
    const store: AgentSessionStore = new Map();
    const at = (ts: number, raw: AgentRawEvent) => ({ ...raw, timestamp: ts });
    for (const [id, repo, ts] of [
      ['s-old', 'autotel', 1],
      ['s-new', 'autotel', 5],
      ['s-other', 'other', 3],
    ] as const) {
      ingestEventRecord(
        store,
        at(ts, {
          eventName: REPOSITORY_EVENT,
          timestamp: ts,
          attributes: { 'session.id': id, 'repository.name': repo },
          resource: {},
        }),
      );
      for (const prompt of ['p1', 'p2'])
        ingestEventRecord(
          store,
          at(ts, {
            ...event('claude_code.api_request', {
              'prompt.id': `${id}-${prompt}`,
              model: 'claude-sonnet-4-6',
              input_tokens: 10,
              output_tokens: 5,
              cost_usd: 0.1,
            }),
            attributes: {
              'session.id': id,
              'prompt.id': `${id}-${prompt}`,
              model: 'claude-sonnet-4-6',
              input_tokens: 10,
              output_tokens: 5,
              cost_usd: 0.1,
            },
          }),
        );
    }
    ingestEventRecord(store, event('claude_code.user_prompt', {}));
    return store;
  }

  it('totals a repository and counts sessions it could not attribute', () => {
    const report = usageReport(seed().values(), { repository: 'autotel' });
    expect(report.sessions.map((s) => s.id)).toEqual(['s-new', 's-old']);
    expect(report.total).toMatchObject({ requests: 4, inputTokens: 40 });
    expect(report.cost).toBe('complete');
    expect(report.uncorrelatedSessions).toBe(1);
  });

  it('answers "the last prompt" from the most recent session', () => {
    const report = usageReport(seed().values(), {
      repository: 'autotel',
      latest: 'prompt',
    });
    expect(report.sessions).toHaveLength(1);
    expect(report.sessions[0]).toMatchObject({
      id: 's-new',
      latestPromptId: 's-new-p2',
    });
    expect(report.total.requests).toBe(1);
  });

  it('reports nothing measured as unknown, not zero', () => {
    const report = usageReport(seed().values(), { sessionId: SESSION });
    expect(report.total.requests).toBe(0);
    expect(report.cost).toBe('unknown');
  });

  it('keeps "latest prompt" right after the timeline has evicted it', () => {
    const store: AgentSessionStore = new Map();
    for (const [prompt, cost] of [
      ['p1', 1],
      ['p2', 2],
    ] as const)
      ingestEventRecord(
        store,
        event('claude_code.api_request', {
          'prompt.id': prompt,
          model: 'x',
          cost_usd: cost,
        }),
        { timelineLimit: 1 },
      );
    // Unprompted events push p2's request out of the one-slot timeline.
    ingestEventRecord(store, event('claude_code.tool_result', {}), {
      timelineLimit: 1,
    });
    const report = usageReport(store.values(), { latest: 'prompt' });
    expect(report.sessions[0]?.latestPromptId).toBe('p2');
    expect(report.total.costUsd).toBe(2);
  });

  it('returns nothing, not the session total, when no prompt is known', () => {
    const store: AgentSessionStore = new Map();
    ingestEventRecord(
      store,
      event('claude_code.api_request', { model: 'x', cost_usd: 3 }),
    );
    const report = usageReport(store.values(), { latest: 'prompt' });
    expect(report.sessions).toEqual([]);
    expect(report.cost).toBe('unknown');
  });

  it('keeps the newest prompt when an older one arrives late', () => {
    const store: AgentSessionStore = new Map();
    const request = (prompt: string, timestamp: number, cost: number) => ({
      ...event('claude_code.api_request', {
        'prompt.id': prompt,
        model: 'x',
        cost_usd: cost,
      }),
      timestamp,
    });
    ingestEventRecord(store, request('p2', 2000, 2));
    ingestEventRecord(store, request('p1', 1000, 1)); // delayed export
    const report = usageReport(store.values(), { latest: 'prompt' });
    expect(report.sessions[0]?.latestPromptId).toBe('p2');
    expect(report.total.costUsd).toBe(2);
  });
});
