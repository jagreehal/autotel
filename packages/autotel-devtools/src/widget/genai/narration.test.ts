import { describe, it, expect } from 'vitest'
import { explainSpan, buildTour } from './narration'
import type { GenAiSpan } from './types'

function span(overrides: Partial<GenAiSpan> = {}): GenAiSpan {
  return {
    traceId: 't',
    spanId: 's',
    name: 'chat',
    startMs: 0,
    endMs: 1_000_000,
    status: 'ok',
    provider: 'openai',
    operation: 'chat',
    requestModel: 'gpt-4o',
    params: {},
    messages: [],
    toolCalls: [],
    usage: {},
    ...overrides,
  }
}

describe('explainSpan', () => {
  it('describes an agent invocation', () => {
    const e = explainSpan(span({ operation: 'invoke_agent', agent: { name: 'planner' } }))
    expect(e.role).toBe('Agent')
    expect(e.title).toBe('Agent: planner')
    expect(e.explain).toMatch(/orchestrates/i)
  })

  it('describes a handoff with from/to', () => {
    const e = explainSpan(
      span({ operation: 'execute_handoff', handoff: { fromAgent: 'triage', toAgent: 'billing' } }),
    )
    expect(e.role).toBe('Handoff')
    expect(e.title).toBe('Handoff: triage → billing')
    expect(e.explain).toContain('triage')
    expect(e.explain).toContain('billing')
  })

  it('describes a tool execution, preferring gen_ai.tool.name', () => {
    // `agent.name` is often "agent" on execute_tool spans; the real tool name
    // lives on `tool.name` and must win.
    const e = explainSpan(
      span({
        operation: 'execute_tool',
        name: 'running tool',
        agent: { name: 'agent' },
        tool: { name: 'get_user_time' },
      }),
    )
    expect(e.role).toBe('Tool')
    expect(e.title).toBe('Tool: get_user_time')
    expect(e.explain).toMatch(/real code/i)
  })

  it('distinguishes a planning model call (decides tools)', () => {
    const planning = explainSpan(
      span({ toolCalls: [{ name: 'search', arguments: {} }] }),
    )
    expect(planning.role).toBe('Model · planning')
    expect(planning.title).toMatch(/decides/i)
  })

  it('detects tool decisions from assistant messages too', () => {
    const planning = explainSpan(
      span({
        messages: [
          { role: 'assistant', parts: [], toolCalls: [{ name: 'x', arguments: {} }] },
        ],
      }),
    )
    expect(planning.role).toBe('Model · planning')
  })

  it('detects tool decisions from span finish reasons (Ollama/Logfire)', () => {
    // Some providers signal the tool decision only via finish_reasons, with no
    // structured toolCalls array on the normalized span.
    const planning = explainSpan(span({ finishReasons: ['tool_call'] }))
    expect(planning.role).toBe('Model · planning')

    expect(explainSpan(span({ finishReasons: ['tool_calls'] })).role).toBe(
      'Model · planning',
    )
    expect(explainSpan(span({ finishReasons: ['tool_use'] })).role).toBe(
      'Model · planning',
    )
  })

  it('detects tool decisions from a per-message finish reason', () => {
    const planning = explainSpan(
      span({ messages: [{ role: 'assistant', parts: [], finishReason: 'function_call' }] }),
    )
    expect(planning.role).toBe('Model · planning')
  })

  it('treats a plain stop finish as responding', () => {
    expect(explainSpan(span({ finishReasons: ['stop'] })).role).toBe(
      'Model · responding',
    )
  })

  it('describes a responding model call (no tools)', () => {
    const responding = explainSpan(span())
    expect(responding.role).toBe('Model · responding')
    expect(responding.title).toMatch(/writes the answer/i)
  })

  it('describes embeddings', () => {
    const e = explainSpan(span({ operation: 'embeddings', responseModel: 'text-embedding-3' }))
    expect(e.role).toBe('Embeddings')
    expect(e.title).toContain('text-embedding-3')
  })

  it('describes speech and transcription', () => {
    expect(explainSpan(span({ operation: 'speech' })).role).toBe('Speech')
    expect(explainSpan(span({ operation: 'transcription' })).role).toBe('Transcription')
  })

  it('falls back gracefully for unknown operations', () => {
    const e = explainSpan(span({ operation: 'mystery', name: 'weird.span' }))
    expect(e.role).toBe('mystery')
    expect(e.title).toBe('weird.span')
    expect(e.explain).toBeTruthy()
  })
})

describe('buildTour', () => {
  it('orders steps chronologically and attaches narration', () => {
    const steps = buildTour([
      span({ spanId: 'b', startMs: 200, operation: 'execute_tool', name: 'tool' }),
      span({ spanId: 'a', startMs: 100, operation: 'invoke_agent', agent: { name: 'root' } }),
      span({ spanId: 'c', startMs: 300 }),
    ])
    expect(steps.map((s) => s.span.spanId)).toEqual(['a', 'b', 'c'])
    expect(steps[0].role).toBe('Agent')
    expect(steps[1].role).toBe('Tool')
    expect(steps[2].role).toBe('Model · responding')
  })

  it('does not mutate the input array', () => {
    const input = [span({ spanId: 'b', startMs: 2 }), span({ spanId: 'a', startMs: 1 })]
    buildTour(input)
    expect(input.map((s) => s.spanId)).toEqual(['b', 'a'])
  })
})
