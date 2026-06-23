import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { toGenAiSpan } from './normalize'
import { isGenAiSpan } from './detect'
import { buildToolResultIndex, hydrateToolResults } from './stitch'
import type { SpanData } from '../types'

const here = dirname(fileURLToPath(import.meta.url))
const loadFixture = (name: string): SpanData =>
  JSON.parse(readFileSync(join(here, '__fixtures__', `${name}.json`), 'utf8')) as SpanData

describe('isGenAiSpan', () => {
  it('returns true for spans carrying gen_ai.* markers', () => {
    expect(isGenAiSpan(loadFixture('openai-v2-chat'))).toBe(true)
    expect(isGenAiSpan(loadFixture('anthropic-cache'))).toBe(true)
    expect(isGenAiSpan(loadFixture('openai-agents-handoff'))).toBe(true)
  })

  it('returns false for non-GenAI spans', () => {
    expect(
      isGenAiSpan({
        traceId: 't',
        spanId: 's',
        name: 'GET /api',
        kind: 'CLIENT',
        startTime: 0,
        endTime: 0,
        duration: 0,
        attributes: { 'http.method': 'GET' },
        status: { code: 'OK' },
      }),
    ).toBe(false)
  })
})

describe('toGenAiSpan — openai-v2 chat', () => {
  const span = toGenAiSpan(loadFixture('openai-v2-chat'))

  it('extracts provider, operation, model', () => {
    expect(span.provider).toBe('openai')
    expect(span.operation).toBe('chat')
    expect(span.requestModel).toBe('gpt-4o-mini')
    expect(span.responseModel).toBe('gpt-4o-mini-2024-07-18')
    expect(span.responseId).toBe('chatcmpl-9X8XYZabcdef')
    expect(span.finishReasons).toEqual(['stop'])
  })

  it('parses messages from gen_ai.input.messages / gen_ai.output.messages attributes', () => {
    expect(span.messages).toHaveLength(2)
    expect(span.messages[0]).toMatchObject({
      role: 'user',
      parts: [{ kind: 'text', text: 'Say this is a test' }],
    })
    expect(span.messages[1]).toMatchObject({
      role: 'assistant',
      parts: [{ kind: 'text', text: 'This is a test.' }],
      finishReason: 'stop',
    })
  })

  it('computes cost from token usage', () => {
    expect(span.usage).toMatchObject({ inputTokens: 12, outputTokens: 7 })
    expect(span.cost?.source).toBe('table')
    expect(span.cost?.total).toBeGreaterThan(0)
    // gpt-4o-mini: 12/1M * $0.15 + 7/1M * $0.60
    expect(span.cost?.total).toBeCloseTo(12e-6 * 0.15 + 7e-6 * 0.6, 9)
  })

  it('pulls openai-specific extras into structured slots', () => {
    expect(span.extras.openaiServiceTier?.response).toBe('default')
    expect(span.extras.openaiSystemFingerprint).toBe('fp_a1b2c3d4e5')
  })
})

describe('toGenAiSpan — anthropic with cache', () => {
  const span = toGenAiSpan(loadFixture('anthropic-cache'))

  it('keeps cache token breakdown', () => {
    expect(span.usage.inputTokens).toBe(700)
    expect(span.usage.cacheReadInputTokens).toBe(500)
    expect(span.usage.outputTokens).toBe(142)
  })

  it('prices the call applying cache_read at the discounted rate', () => {
    // claude-sonnet-4: $3/MTok input, $15/MTok output, cache_read default 0.1x = $0.30/MTok
    // billable input = 700 - 500 - 0 = 200 tokens
    const expected =
      (200 / 1_000_000) * 3 + (142 / 1_000_000) * 15 + (500 / 1_000_000) * 0.3
    expect(span.cost?.source).toBe('table')
    expect(span.cost?.total).toBeCloseTo(expected, 9)
    expect(span.cost?.cacheRead).toBeCloseTo((500 / 1_000_000) * 0.3, 9)
  })

  it('captures all sampling params', () => {
    expect(span.params).toMatchObject({
      temperature: 0.7,
      topP: 0.9,
      topK: 40,
      maxTokens: 1024,
    })
  })

  it('parses a 2-message conversation across input and output', () => {
    expect(span.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant'])
  })
})

describe('toGenAiSpan — openai-agents handoff', () => {
  const span = toGenAiSpan(loadFixture('openai-agents-handoff'))

  it('identifies the handoff with from/to agents', () => {
    expect(span.operation).toBe('execute_handoff')
    expect(span.handoff).toEqual({
      fromAgent: 'Triage Agent',
      toAgent: 'Refunds Specialist',
    })
  })

  it('captures agent identity and conversation id', () => {
    expect(span.agent?.name).toBe('Triage Agent')
    expect(span.agent?.id).toBe('agent_triage_001')
    expect(span.conversationId).toBe('conv_2026_05_19_42')
  })

  it('does not invent cost when there are no tokens', () => {
    expect(span.usage.inputTokens).toBeUndefined()
    expect(span.cost?.total).toBe(0)
  })

  it('surfaces unknown attributes via extras.raw', () => {
    expect(span.extras.raw['gen_ai.output.type']).toBe('text')
  })
})

describe('toGenAiSpan — event-style legacy payload', () => {
  // Vertex/older Google emit messages as span events, not attributes.
  it('reconstructs messages from gen_ai.{role}.message events', () => {
    const span: SpanData = {
      traceId: 't',
      spanId: 's',
      name: 'chat gemini-1.5-pro',
      kind: 'CLIENT',
      startTime: 0,
      endTime: 0,
      duration: 0,
      attributes: {
        'gen_ai.system': 'vertex_ai',
        'gen_ai.operation.name': 'chat',
        'gen_ai.request.model': 'gemini-1.5-pro',
        'gen_ai.usage.input_tokens': 5,
        'gen_ai.usage.output_tokens': 3,
      },
      status: { code: 'OK' },
      events: [
        { name: 'gen_ai.user.message', timestamp: 1, attributes: { content: 'Hi' } },
        {
          name: 'gen_ai.choice',
          timestamp: 2,
          attributes: {
            finish_reason: 'stop',
            message: JSON.stringify({ role: 'assistant', content: 'Hello!' }),
          },
        },
      ],
    }
    const out = toGenAiSpan(span)
    expect(out.provider).toBe('google')
    expect(out.messages).toEqual([
      { role: 'user', parts: [{ kind: 'text', text: 'Hi' }] },
      { role: 'assistant', parts: [{ kind: 'text', text: 'Hello!' }], finishReason: 'stop' },
    ])
  })
})

describe('toGenAiSpan — ref-style payloads (externalized content)', () => {
  it('surfaces gen_ai.{input,output}.messages.ref as placeholder messages', () => {
    const span: SpanData = {
      traceId: 't',
      spanId: 's',
      name: 'chat gpt-4o',
      kind: 'CLIENT',
      startTime: 0,
      endTime: 0,
      duration: 0,
      attributes: {
        'gen_ai.provider.name': 'openai',
        'gen_ai.operation.name': 'chat',
        'gen_ai.request.model': 'gpt-4o',
        'gen_ai.input.messages.ref': 's3://prompts/abc.json',
        'gen_ai.output.messages.ref': 's3://completions/abc.json',
      },
      status: { code: 'OK' },
    }
    const out = toGenAiSpan(span)
    expect(out.messages).toHaveLength(2)
    expect(out.messages[0]).toMatchObject({
      role: 'user',
      parts: [{ kind: 'ref', ref: 's3://prompts/abc.json', direction: 'input' }],
    })
    expect(out.messages[1]).toMatchObject({
      role: 'assistant',
      parts: [{ kind: 'ref', ref: 's3://completions/abc.json', direction: 'output' }],
    })
  })

  it('does not duplicate when event-style messages coexist with a ref', () => {
    // During semconv migration an instrumentation may emit both span events
    // (legacy) and a `.ref` (newer). The transcript must not show both real
    // content and a placeholder for the same direction.
    const span: SpanData = {
      traceId: 't',
      spanId: 's',
      name: 'chat gemini-1.5-pro',
      kind: 'CLIENT',
      startTime: 0,
      endTime: 0,
      duration: 0,
      attributes: {
        'gen_ai.system': 'vertex_ai',
        'gen_ai.operation.name': 'chat',
        'gen_ai.request.model': 'gemini-1.5-pro',
        'gen_ai.input.messages.ref': 's3://prompts/migration.json',
        'gen_ai.output.messages.ref': 's3://completions/migration.json',
      },
      status: { code: 'OK' },
      events: [
        { name: 'gen_ai.user.message', timestamp: 1, attributes: { content: 'Hi' } },
        {
          name: 'gen_ai.choice',
          timestamp: 2,
          attributes: {
            finish_reason: 'stop',
            message: JSON.stringify({ role: 'assistant', content: 'Hello!' }),
          },
        },
      ],
    }
    const out = toGenAiSpan(span)
    expect(out.messages).toHaveLength(2)
    expect(out.messages.map((m) => m.parts[0].kind)).toEqual(['text', 'text'])
    expect(out.messages.some((m) => m.parts.some((p) => p.kind === 'ref'))).toBe(false)
  })

  it('prefers inline messages and skips redundant ref placeholders', () => {
    const span: SpanData = {
      traceId: 't',
      spanId: 's',
      name: 'chat gpt-4o',
      kind: 'CLIENT',
      startTime: 0,
      endTime: 0,
      duration: 0,
      attributes: {
        'gen_ai.provider.name': 'openai',
        'gen_ai.operation.name': 'chat',
        'gen_ai.request.model': 'gpt-4o',
        'gen_ai.input.messages':
          '[{"role":"user","parts":[{"type":"text","content":"Hi"}]}]',
        // Output is externalized — only that direction should get a ref placeholder.
        'gen_ai.output.messages.ref': 's3://completions/xyz.json',
      },
      status: { code: 'OK' },
    }
    const out = toGenAiSpan(span)
    expect(out.messages).toHaveLength(2)
    expect(out.messages[0].parts[0]).toMatchObject({ kind: 'text', text: 'Hi' })
    expect(out.messages[1].parts[0]).toMatchObject({
      kind: 'ref',
      direction: 'output',
    })
  })
})

describe('toGenAiSpan — tool-call result hydration', () => {
  it('back-fills GenAiToolCall.result from matching tool-role messages', () => {
    const inputMessages = [
      { role: 'user', parts: [{ type: 'text', content: 'What is the weather in Seattle?' }] },
    ]
    const outputMessages = [
      {
        role: 'assistant',
        parts: [],
        tool_calls: [
          {
            id: 'call_abc123',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"Seattle"}' },
          },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'call_abc123',
        parts: [{ type: 'text', content: '{"temp_f":62,"summary":"cloudy"}' }],
      },
    ]
    const span: SpanData = {
      traceId: 't',
      spanId: 's',
      name: 'chat gpt-4o',
      kind: 'CLIENT',
      startTime: 0,
      endTime: 0,
      duration: 0,
      attributes: {
        'gen_ai.provider.name': 'openai',
        'gen_ai.operation.name': 'chat',
        'gen_ai.request.model': 'gpt-4o',
        'gen_ai.input.messages': JSON.stringify(inputMessages),
        'gen_ai.output.messages': JSON.stringify(outputMessages),
      },
      status: { code: 'OK' },
    }
    const out = toGenAiSpan(span)
    expect(out.toolCalls).toHaveLength(1)
    expect(out.toolCalls[0]).toMatchObject({
      id: 'call_abc123',
      name: 'get_weather',
      arguments: { city: 'Seattle' },
      result: { temp_f: 62, summary: 'cloudy' },
    })
  })

  it('leaves result undefined when no matching tool message exists', () => {
    const span: SpanData = {
      traceId: 't',
      spanId: 's',
      name: 'chat gpt-4o',
      kind: 'CLIENT',
      startTime: 0,
      endTime: 0,
      duration: 0,
      attributes: {
        'gen_ai.provider.name': 'openai',
        'gen_ai.operation.name': 'chat',
        'gen_ai.request.model': 'gpt-4o',
        'gen_ai.output.messages':
          '[{"role":"assistant","parts":[],"tool_calls":[{"id":"call_x","function":{"name":"f","arguments":"{}"}}]}]',
      },
      status: { code: 'OK' },
    }
    const out = toGenAiSpan(span)
    expect(out.toolCalls).toHaveLength(1)
    expect(out.toolCalls[0].result).toBeUndefined()
  })
})

describe('toGenAiSpan — canonical gen_ai tool parts (autotel-genai)', () => {
  // autotel-genai encodes the tool loop in parts[] with `type: 'tool_call'` /
  // `type: 'tool_call_response'` (no `content` field) — these used to render as
  // empty transcript bubbles. They must hydrate into structured tool fields.
  const span: SpanData = {
    traceId: 't',
    spanId: 's',
    name: 'chat granite4',
    kind: 'CLIENT',
    startTime: 0,
    endTime: 0,
    duration: 0,
    attributes: {
      'gen_ai.provider.name': 'ollama',
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': 'granite4',
      'gen_ai.input.messages': JSON.stringify([
        { role: 'user', parts: [{ type: 'text', content: 'What is 23 * 19?' }] },
        {
          role: 'assistant',
          parts: [
            { type: 'tool_call', id: 'tc1', name: 'multiply', arguments: { a: 23, b: 19 } },
          ],
        },
        {
          role: 'tool',
          parts: [
            { type: 'tool_call_response', id: 'tc1', response: { type: 'json', value: 437 } },
          ],
        },
      ]),
      'gen_ai.output.messages': JSON.stringify([
        { role: 'assistant', parts: [{ type: 'text', content: 'It is 437.' }], finish_reason: 'stop' },
      ]),
    },
    status: { code: 'OK' },
  }

  it('hydrates the assistant tool_call into a tool chip, not an empty bubble', () => {
    const out = toGenAiSpan(span)
    const assistantCall = out.messages.find((m) => m.toolCalls && m.toolCalls.length > 0)
    expect(assistantCall).toBeDefined()
    expect(assistantCall!.toolCalls![0]).toMatchObject({
      id: 'tc1',
      name: 'multiply',
      arguments: { a: 23, b: 19 },
    })
    // No empty text bubble left behind for the tool-call turn.
    expect(assistantCall!.parts).toHaveLength(0)
  })

  it('renders the tool_call_response value instead of an empty bubble', () => {
    const out = toGenAiSpan(span)
    const toolMsg = out.messages.find((m) => m.role === 'tool')
    expect(toolMsg).toBeDefined()
    expect(toolMsg!.parts).toEqual([{ kind: 'json', value: 437 }])
  })
})

describe('toGenAiSpan — real Vercel AI SDK v6 + Ollama capture', () => {
  // Captured from /Users/jreehal/dev/ai/ai-workshop/vercel-ai-sdk via
  // generateText({ experimental_telemetry: { isEnabled: true, ... } }).
  // The AI SDK emits gen_ai.* for model/usage but keeps conversation
  // payload in its own ai.* namespace (`ai.prompt.messages`, `ai.response.text`).
  const all = JSON.parse(
    readFileSync(join(here, '__fixtures__', 'aisdk-ollama-real.json'), 'utf8'),
  ) as SpanData[]
  const doGenerate = all.find((s) => s.name === 'ai.generateText.doGenerate')

  it('detects the provider-level span as GenAI', () => {
    expect(doGenerate).toBeDefined()
    expect(isGenAiSpan(doGenerate!)).toBe(true)
  })

  it('extracts provider, model, and usage from gen_ai.* attributes', () => {
    const span = toGenAiSpan(doGenerate!)
    expect(span.provider).toBe('ollama')
    expect(span.requestModel).toBe('granite4.1:3b')
    expect(span.responseModel).toBe('granite4.1:3b')
    expect(span.usage.inputTokens).toBe(14)
    expect(span.usage.outputTokens).toBe(3)
    expect(span.finishReasons).toEqual(['stop'])
  })

  it('reconstructs the transcript from ai.prompt.messages + ai.response.text', () => {
    const span = toGenAiSpan(doGenerate!)
    expect(span.messages).toHaveLength(2)
    expect(span.messages[0]).toMatchObject({
      role: 'user',
      parts: [{ kind: 'text', text: 'Reply with one short greeting.' }],
    })
    expect(span.messages[1]).toMatchObject({
      role: 'assistant',
      parts: [{ kind: 'text', text: 'Hello!' }],
      finishReason: 'stop',
    })
  })
})

describe('toGenAiSpan — bundled tool-results split into one message per call', () => {
  it('expands a single tool-role message with N tool-result parts into N messages', () => {
    const outputMessages = [
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'a', toolName: 'lookup', input: { x: 1 } },
          { type: 'tool-call', toolCallId: 'b', toolName: 'weather', input: { city: 'X' } },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'a', output: { type: 'json', value: { ok: 1 } } },
          { type: 'tool-result', toolCallId: 'b', output: { type: 'json', value: { temp: 20 } } },
        ],
      },
    ]
    const span: SpanData = {
      traceId: 't', spanId: 's', name: 'chat',
      kind: 'CLIENT', startTime: 0, endTime: 0, duration: 0,
      attributes: {
        'gen_ai.provider.name': 'openai',
        'gen_ai.operation.name': 'chat',
        'gen_ai.request.model': 'gpt-4o',
        'gen_ai.input.messages': '[{"role":"user","parts":[{"type":"text","content":"hi"}]}]',
        'gen_ai.output.messages': JSON.stringify(outputMessages),
      },
      status: { code: 'OK' },
    }
    const out = toGenAiSpan(span)
    const toolMessages = out.messages.filter((m) => m.role === 'tool')
    expect(toolMessages).toHaveLength(2)
    expect(toolMessages.map((m) => m.toolCallId)).toEqual(['a', 'b'])
  })
})

describe('toGenAiSpan — Vercel AI SDK wrapper span detection', () => {
  // The outer `ai.generateText` wrapper carries no gen_ai.* attributes but
  // is the canonical user-visible call. Detection must still trip on
  // `ai.model.provider` and the normalizer must hydrate from ai.* fallbacks.
  const wrapper: SpanData = {
    traceId: 't', spanId: 'w', name: 'ai.generateText',
    kind: 'INTERNAL', startTime: 0, endTime: 0, duration: 0,
    attributes: {
      'ai.model.provider': 'ollama',
      'ai.model.id': 'qwen2:latest',
      'ai.prompt': '{"system":"You are TripMate.","prompt":"Plan a weekend in Lisbon."}',
      'ai.response.text': 'Have a great trip!',
      'ai.response.finishReason': 'stop',
      'ai.usage.inputTokens': 100,
      'ai.usage.outputTokens': 50,
    },
    status: { code: 'OK' },
  }

  it('detects the wrapper span as GenAI via ai.model.provider', () => {
    expect(isGenAiSpan(wrapper)).toBe(true)
  })

  it('hydrates provider, model, usage, and synthesizes a transcript', () => {
    const span = toGenAiSpan(wrapper)
    expect(span.provider).toBe('ollama')
    expect(span.requestModel).toBe('qwen2:latest')
    expect(span.usage.inputTokens).toBe(100)
    expect(span.usage.outputTokens).toBe(50)
    expect(span.messages).toHaveLength(3)
    expect(span.messages[0]).toMatchObject({ role: 'system', parts: [{ kind: 'text', text: 'You are TripMate.' }] })
    expect(span.messages[1]).toMatchObject({ role: 'user', parts: [{ kind: 'text', text: 'Plan a weekend in Lisbon.' }] })
    expect(span.messages[2]).toMatchObject({
      role: 'assistant',
      parts: [{ kind: 'text', text: 'Have a great trip!' }],
      finishReason: 'stop',
    })
  })
})

describe('toGenAiSpan + stitching — real Vercel AI SDK tools capture', () => {
  // Captured from vercel-ai-sdk c03_agentic with qwen2:latest. The trace
  // contains: 2× ai.generateText.doGenerate (one with tool calls, one final),
  // 2× ai.toolCall (lookupTraveler + getWeather executions), 1× ai.generateText.
  const all = JSON.parse(
    readFileSync(join(here, '__fixtures__', 'aisdk-ollama-tools-real.json'), 'utf8'),
  ) as SpanData[]
  const firstDoGenerate = all.find(
    (s) =>
      s.name === 'ai.generateText.doGenerate' &&
      typeof s.attributes?.['ai.response.toolCalls'] === 'string',
  )

  it('promotes ai.response.toolCalls onto the assistant message', () => {
    const span = toGenAiSpan(firstDoGenerate!)
    expect(span.messages.length).toBeGreaterThan(0)
    const assistant = span.messages.find((m) => m.role === 'assistant')
    expect(assistant?.toolCalls?.length).toBeGreaterThan(0)
    expect(assistant?.toolCalls?.[0]).toMatchObject({
      name: expect.any(String),
      arguments: expect.any(Object),
    })
    // Top-level toolCalls aggregates them.
    expect(span.toolCalls.length).toBe(assistant!.toolCalls!.length)
  })

  it('does not detect bare ai.toolCall spans as GenAI', () => {
    const toolSpans = all.filter((s) => s.name === 'ai.toolCall')
    expect(toolSpans.length).toBeGreaterThan(0)
    for (const s of toolSpans) {
      expect(isGenAiSpan(s)).toBe(false)
    }
  })
})

describe('stitch — back-fill tool results from sibling ai.toolCall spans', () => {
  const all = JSON.parse(
    readFileSync(join(here, '__fixtures__', 'aisdk-ollama-tools-real.json'), 'utf8'),
  ) as SpanData[]

  it('builds a {toolCallId → result} index from ai.toolCall spans', () => {
    const index = buildToolResultIndex(all)
    const toolSpans = all.filter((s) => s.name === 'ai.toolCall')
    expect(index.size).toBe(toolSpans.length)
    expect(index.size).toBeGreaterThan(0)
    for (const [id, result] of index) {
      expect(typeof id).toBe('string')
      expect(result).toBeDefined()
    }
  })

  it('hydrates results onto the GenAiSpan that only had args', () => {
    const firstDoGenerate = all.find(
      (s) =>
        s.name === 'ai.generateText.doGenerate' &&
        typeof s.attributes?.['ai.response.toolCalls'] === 'string',
    )!
    const span = toGenAiSpan(firstDoGenerate)
    const before = span.toolCalls.map((c) => c.result)
    expect(before.every((r) => r === undefined)).toBe(true)

    const index = buildToolResultIndex(all)
    hydrateToolResults(span, index)

    const after = span.toolCalls.map((c) => c.result)
    expect(after.every((r) => r !== undefined)).toBe(true)
    // Sanity: the lookupTraveler result really came from the sibling span.
    const lookup = span.toolCalls.find((c) => c.name === 'lookupTraveler')
    expect(lookup?.result).toMatchObject({ name: expect.any(String) })
  })
})

describe('toGenAiSpan — real LangChain + opentelemetry-instrumentation-langchain capture', () => {
  // Captured via `scripts/capture_langchain_fixture.py` using ChatOllama.
  // The contrib instrumentation emits textbook gen_ai semconv with canonical
  // parts-based input/output messages.
  const spans = JSON.parse(
    readFileSync(join(here, '__fixtures__', 'langchain-ollama-real.json'), 'utf8'),
  ) as SpanData[]
  const chat = spans[0]

  it('detects, normalizes, and hydrates a LangChain chat span', () => {
    expect(isGenAiSpan(chat)).toBe(true)
    const span = toGenAiSpan(chat)
    expect(span.provider).toBe('ollama')
    expect(span.operation).toBe('chat')
    // LangChain instrumentation emits gen_ai.system_instructions separately
    // from input messages, so the normalized order is [system, user, assistant].
    expect(span.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant'])
    expect(span.messages[1]).toMatchObject({
      role: 'user',
      parts: [{ kind: 'text', text: 'Say hello.' }],
    })
    expect(span.messages[2].role).toBe('assistant')
    expect(span.usage.inputTokens).toBeGreaterThan(0)
    expect(span.usage.outputTokens).toBeGreaterThan(0)
  })
})

describe('toGenAiSpan — real Pydantic AI + Logfire + Gemini capture', () => {
  // Captured via `scripts/capture_gemini_fixture.py` against gemini-2.5-flash.
  // Logfire emits the provider as `google-gla` (Google GenAI library); the
  // normalizer must alias this back to `google` so it joins the price table.
  const all = JSON.parse(
    readFileSync(join(here, '__fixtures__', 'gemini-pydantic-real.json'), 'utf8'),
  ) as SpanData[]
  const chat = all.find((s) => s.name.startsWith('chat gemini-'))

  it('detects, normalizes provider alias, and hydrates transcript', () => {
    expect(chat).toBeDefined()
    const span = toGenAiSpan(chat!)
    expect(span.provider).toBe('google')
    expect(span.requestModel).toMatch(/^gemini-/)
    expect(span.messages.length).toBeGreaterThanOrEqual(1)
    expect(span.usage.inputTokens).toBeGreaterThan(0)
    expect(span.usage.outputTokens).toBeGreaterThan(0)
    expect(span.cost?.source).toBe('table')
  })
})

describe('toGenAiSpan — real Pydantic AI + Logfire + Ollama capture', () => {
  // Captured from /Users/jreehal/dev/ai/ai-workshop/pydantic-ai via
  // logfire.instrument_pydantic_ai() + agent.run_sync(...). Logfire emits
  // textbook gen_ai semconv: attribute-based input/output messages plus the
  // agent metadata (gen_ai.agent.name, gen_ai.conversation.id, etc.).
  const all = JSON.parse(
    readFileSync(join(here, '__fixtures__', 'pydantic-ai-ollama-real.json'), 'utf8'),
  ) as SpanData[]
  const chat = all.find((s) => s.name.startsWith('chat '))

  it('detects the chat span as GenAI', () => {
    expect(chat).toBeDefined()
    expect(isGenAiSpan(chat!)).toBe(true)
  })

  it('extracts provider, operation, model, agent identity', () => {
    const span = toGenAiSpan(chat!)
    expect(span.provider).toBe('ollama')
    expect(span.operation).toBe('chat')
    expect(span.requestModel).toBe('granite4:latest')
    expect(span.responseModel).toBe('granite4:latest')
    expect(span.agent?.name).toBe('agent')
    expect(span.conversationId).toBeDefined()
  })

  it('parses the full transcript from gen_ai.input/output.messages', () => {
    const span = toGenAiSpan(chat!)
    expect(span.messages).toHaveLength(2)
    expect(span.messages[0]).toMatchObject({
      role: 'user',
      parts: [{ kind: 'text', text: 'Reply with one short greeting.' }],
    })
    expect(span.messages[1]).toMatchObject({
      role: 'assistant',
      parts: [{ kind: 'text', text: 'Hello!' }],
      finishReason: 'stop',
    })
  })

  it('surfaces token usage and finish reason', () => {
    const span = toGenAiSpan(chat!)
    expect(span.usage.inputTokens).toBe(14)
    expect(span.usage.outputTokens).toBe(3)
    expect(span.finishReasons).toEqual(['stop'])
  })

  // The parent `agent run` span lacks `gen_ai.system` and `gen_ai.request.model`
  // but carries identity (gen_ai.agent.name), a `model_name` Pydantic-specific
  // attribute, and the full transcript on `pydantic_ai.all_messages`. The
  // normalizer must promote those so the row doesn't render as unknown/unknown
  // with an empty conversation.
  const agentRun = all.find((s) => s.name === 'agent run')

  it('hydrates the parent agent-run span from Pydantic-specific attributes', () => {
    expect(agentRun).toBeDefined()
    const span = toGenAiSpan(agentRun!)
    expect(span.agent?.name).toBe('agent')
    expect(span.requestModel).toBe('granite4:latest') // from model_name fallback
    expect(span.operation).toBe('invoke_agent')
    expect(span.conversationId).toBeDefined()
    // Full transcript from pydantic_ai.all_messages fallback.
    expect(span.messages).toHaveLength(2)
    expect(span.messages[0]).toMatchObject({
      role: 'user',
      parts: [{ kind: 'text', text: 'Reply with one short greeting.' }],
    })
    expect(span.messages[1]).toMatchObject({
      role: 'assistant',
      parts: [{ kind: 'text', text: 'Hello!' }],
      finishReason: 'stop',
    })
  })
})

describe('toGenAiSpan — OpenLLMetry legacy llm.* keys', () => {
  it('falls back to indexed prompt/completion attributes', () => {
    const span: SpanData = {
      traceId: 't',
      spanId: 's',
      name: 'openai.chat',
      kind: 'CLIENT',
      startTime: 0,
      endTime: 0,
      duration: 0,
      attributes: {
        'gen_ai.system': 'openai',
        'gen_ai.operation.name': 'chat',
        'gen_ai.request.model': 'gpt-4o',
        'llm.usage.prompt_tokens': 10,
        'llm.usage.completion_tokens': 20,
        'gen_ai.prompt.0.role': 'user',
        'gen_ai.prompt.0.content': 'Hello',
        'gen_ai.completion.0.role': 'assistant',
        'gen_ai.completion.0.content': 'Hi there',
        'gen_ai.completion.0.finish_reason': 'stop',
      },
      status: { code: 'OK' },
    }
    const out = toGenAiSpan(span)
    expect(out.usage).toMatchObject({ inputTokens: 10, outputTokens: 20 })
    expect(out.messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(out.messages[1].finishReason).toBe('stop')
  })
})

describe('toGenAiSpan — autotel-genai guard / streaming / cost', () => {
  const span = toGenAiSpan(loadFixture('autotel-genai-guard'))

  it('is detected as a GenAI span', () => {
    expect(isGenAiSpan(loadFixture('autotel-genai-guard'))).toBe(true)
  })

  it('prefers the reported gen_ai.usage.cost.usd over the table estimate', () => {
    expect(span.cost?.source).toBe('reported')
    expect(span.cost?.total).toBe(0.0075)
  })

  it('reads streaming performance attributes (seconds)', () => {
    expect(span.streaming).toEqual({
      timeToFirstChunkS: 0.2,
      timeToFinishS: 2,
      outputTokensPerSecond: 250,
      timePerOutputChunkS: 0.0036,
    })
  })

  it('reads the session accumulators', () => {
    expect(span.session).toEqual({
      costUsd: 12.5,
      inputTokens: 200000,
      outputTokens: 50000,
      stepCount: 8,
      toolCallCount: 5,
      errorCount: 1,
    })
  })

  it('reads guard stop from the attribute flag and the event details', () => {
    expect(span.guard?.stopped).toBe(true)
    expect(span.guard?.action).toBe('stop')
    expect(span.guard?.rule).toBe('cost-ceiling:$10')
    expect(span.guard?.observed).toBe(12.5)
    expect(span.guard?.limit).toBe(10)
  })

  it('reads provider warnings from the gen_ai.client.warnings event', () => {
    expect(span.warnings).toHaveLength(1)
    expect(span.warnings?.[0]).toMatchObject({
      type: 'unsupported-setting',
      setting: 'topK',
    })
  })

  it('does not leak recognized keys into extras.raw', () => {
    expect(span.extras.raw).not.toHaveProperty('gen_ai.usage.cost.usd')
    expect(span.extras.raw).not.toHaveProperty('gen_ai.guard.stopped')
    expect(span.extras.raw).not.toHaveProperty('gen_ai.session.cost.usd')
    expect(span.extras.raw).not.toHaveProperty('gen_ai.response.time_to_finish')
  })
})

describe('summarizeRun — reported cost counts as priced', () => {
  it('includes reported-source cost in the run total and marks it complete', async () => {
    const { summarizeRun } = await import('./summary')
    const summary = summarizeRun([toGenAiSpan(loadFixture('autotel-genai-guard'))])
    expect(summary.totalCostUsd).toBeCloseTo(0.0075, 9)
    expect(summary.costKnown).toBe(true)
    expect(summary.costComplete).toBe(true)
  })
})
