// Golden contract test: a REAL, sanitized Claude Code OTLP export (recorded via
// `scripts/record-claude-otel.mjs`) run through the actual decode → reduce
// pipeline. Unlike the hand-authored unit tests, this pins the live wire format
// of the version of Claude Code that produced the fixture, so an attribute
// rename or a new/removed signal fails here instead of silently zeroing the UI.
//
// Re-record after a Claude Code upgrade, then eyeball the diff. Assertions favour
// structure + stable facts over volatile counts.
import { describe, expect, it } from 'vitest'
import {
  ingestAgentEvents,
  ingestAgentMetrics,
  summarizeSessions,
  CLAUDE_CODE_KNOWN_EVENT_NAMES,
  type AgentSessionStore,
} from 'autotel-agents'
import { parseOtlpAgentEvents, parseOtlpMetrics } from '../otlp'
import logsFixture from './__fixtures__/claude-code-logs.otlp.json'
import metricsFixture from './__fixtures__/claude-code-metrics.otlp.json'

function ingestFixture() {
  const events = parseOtlpAgentEvents(logsFixture)
  const metrics = parseOtlpMetrics(metricsFixture)
  const store: AgentSessionStore = new Map()
  ingestAgentEvents(store, events)
  ingestAgentMetrics(store, metrics)
  return { store, events, metrics }
}

describe('Claude Code OTLP contract (recorded fixture)', () => {
  it('decodes into exactly one claude-code session', () => {
    const { store } = ingestFixture()
    expect(store.size).toBe(1)
    const session = [...store.values()][0]
    expect(session.agent).toBe('claude-code')
  })

  it('rolls up cost, tokens and model from api_request events', () => {
    const { store } = ingestFixture()
    const { rollup } = [...store.values()][0]
    expect(rollup.apiRequests).toBeGreaterThanOrEqual(1)
    expect(rollup.outputTokens).toBeGreaterThan(0)
    expect(rollup.costUsd).toBeGreaterThan(0)
    // The fixture was recorded on Opus 4.8.
    expect(Object.keys(rollup.models)).toContain('claude-opus-4-8')
    expect(rollup.prompts).toBe(1) // one user_prompt
  })

  it('classifies the Bash tool call', () => {
    const { store } = ingestFixture()
    const { rollup } = [...store.values()][0]
    expect(rollup.tools['Bash']?.count).toBe(1)
    expect(rollup.tools['Bash']?.category).toBe('shell')
    expect(rollup.toolCategories.shell).toBeGreaterThanOrEqual(1)
  })

  it('models the runtime environment: MCP connections, plugins, hooks', () => {
    const { store } = ingestFixture()
    const { rollup } = [...store.values()][0]
    // MCP server lifecycle (context7 connected then disconnected).
    const mcp = rollup.mcpConnections['plugin:context7:context7']
    expect(mcp).toBeDefined()
    expect(mcp?.transport).toBe('stdio')
    expect(mcp?.connects).toBe(1)
    expect(mcp?.disconnects).toBe(1)
    // Plugins loaded + hook executions.
    expect(Object.keys(rollup.plugins).length).toBeGreaterThan(0)
    expect(rollup.hooks.runs).toBeGreaterThanOrEqual(1)
  })

  it('metrics attach to the same session without double-counting cost', () => {
    const { store } = ingestFixture()
    const session = [...store.values()][0]
    // active_time metric folds in; token.usage / cost.usage metrics must NOT be
    // summed on top of the api_request event totals (events are authoritative).
    expect(session.rollup.activeTimeSeconds).toBeGreaterThanOrEqual(0)
    const agg = summarizeSessions(store.values())
    expect(agg.sessions).toBe(1)
    expect(agg.costUsd).toBeCloseTo(session.rollup.costUsd)
  })

  // ── Drift guard ───────────────────────────────────────────────────────────
  it('every emitted event.name is either handled or knowingly ignored', () => {
    const { events } = ingestFixture()
    const emitted = new Set(events.map((e) => e.eventName).filter(Boolean))
    const unknown = [...emitted].filter((name) => !CLAUDE_CODE_KNOWN_EVENT_NAMES.has(name))
    // If this fails, Claude Code emitted a new event. Decide: model it in the
    // prefix adapter/reducer, or add it to CLAUDE_CODE_EVENT_CONTRACT.ignored.
    expect(unknown, `unhandled Claude Code events: ${unknown.join(', ')}`).toEqual([])
  })

  it('the fixture still exercises the newly-modeled signals', () => {
    // Guards against a future re-record silently dropping the very signals this
    // work added — the contract would otherwise "pass" while covering nothing.
    const { events } = ingestFixture()
    const emitted = new Set(events.map((e) => e.eventName))
    for (const name of ['mcp_server_connection', 'plugin_loaded', 'hook_execution_complete']) {
      expect(emitted, `fixture missing ${name} — re-record with an MCP/plugin/hook-active session`).toContain(name)
    }
  })
})
