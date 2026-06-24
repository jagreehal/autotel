import { describe, it, expect } from 'vitest'
import { createServer } from 'node:http'
import { parseOtlpMetrics, parseOtlpAgentEvents } from '../otlp'
import { DevtoolsServer } from '../server'

// OTLP/JSON helpers
function kv(key: string, value: string) {
  return { key, value: { stringValue: value } }
}

const metricsPayload = {
  resourceMetrics: [
    {
      resource: { attributes: [kv('service.name', 'claude-code')] },
      scopeMetrics: [
        {
          scope: { name: 'com.anthropic.claude_code' },
          metrics: [
            {
              name: 'claude_code.lines_of_code.count',
              unit: 'count',
              sum: {
                isMonotonic: true,
                aggregationTemporality: 2, // CUMULATIVE
                dataPoints: [
                  { asInt: '42', timeUnixNano: '1700000000000000000', attributes: [kv('session.id', 'sess-x'), kv('type', 'added')] },
                  { asInt: '8', timeUnixNano: '1700000000000000000', attributes: [kv('session.id', 'sess-x'), kv('type', 'removed')] },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
}

const logsPayload = {
  resourceLogs: [
    {
      resource: { attributes: [kv('service.name', 'claude-code')] },
      scopeLogs: [
        {
          scope: { name: 'com.anthropic.claude_code' },
          logRecords: [
            {
              timeUnixNano: '1700000000000000000',
              attributes: [
                kv('event.name', 'api_request'),
                kv('session.id', 'sess-x'),
                kv('model', 'claude-sonnet-4-6'),
                kv('cost_usd', '0.012'),
                kv('input_tokens', '1000'),
                kv('output_tokens', '500'),
              ],
            },
            {
              timeUnixNano: '1700000000000000000',
              attributes: [
                kv('event.name', 'tool_result'),
                kv('session.id', 'sess-x'),
                kv('tool_name', 'mcp__github__create_issue'),
                kv('success', 'true'),
              ],
            },
          ],
        },
      ],
    },
  ],
}

describe('parseOtlpMetrics', () => {
  it('extracts data points with attributes from a Sum metric', () => {
    const records = parseOtlpMetrics(metricsPayload)
    expect(records).toHaveLength(1)
    expect(records[0].name).toBe('claude_code.lines_of_code.count')
    expect(records[0].scope?.name).toBe('com.anthropic.claude_code')
    expect(records[0].temporality).toBe('cumulative')
    expect(records[0].dataPoints).toHaveLength(2)
    expect(records[0].dataPoints[0].value).toBe(42)
    expect(records[0].dataPoints[0].attributes['type']).toBe('added')
    expect(records[0].dataPoints[0].attributes['session.id']).toBe('sess-x')
  })
})

describe('parseOtlpAgentEvents', () => {
  it('extracts event name + attributes + scope from log records', () => {
    const events = parseOtlpAgentEvents(logsPayload)
    expect(events).toHaveLength(2)
    expect(events[0].eventName).toBe('api_request')
    expect(events[0].scope?.name).toBe('com.anthropic.claude_code')
    expect(events[0].attributes['cost_usd']).toBe('0.012')
  })
})

describe('DevtoolsServer agent ingestion', () => {
  it('reconstructs a session from metrics + events and exposes it', () => {
    const server = new DevtoolsServer({ server: createServer() })
    server.ingestAgentMetrics(parseOtlpMetrics(metricsPayload))
    server.ingestAgentEvents(parseOtlpAgentEvents(logsPayload))

    const agents = server.getCurrentData().agents ?? []
    expect(agents).toHaveLength(1)
    const session = agents[0]
    expect(session.id).toBe('sess-x')
    expect(session.rollup.linesAdded).toBe(42)
    expect(session.rollup.linesRemoved).toBe(8)
    expect(session.rollup.apiRequests).toBe(1)
    expect(session.rollup.costUsd).toBeCloseTo(0.012)
    expect(session.rollup.tools['mcp__github__create_issue']?.mcpServer).toBe('github')
    expect(session.rollup.toolCategories.mcp).toBe(1)
  })
})
