import type { SpanData } from '../types'
import type {
  GenAiMessage,
  GenAiMessagePart,
  GenAiSpan,
  GenAiToolCall,
  GenAiToolDef,
  GenAiUsage,
} from './types'
import { priceCall } from './prices'

type Attrs = Record<string, unknown>

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

function strArray(v: unknown): string[] | undefined {
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[]
  if (typeof v === 'string') return [v]
  return undefined
}

function bool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return undefined
}

// Safe JSON parse — many instrumentations stringify their structured attrs.
function parseJson<T = unknown>(v: unknown): T | undefined {
  if (v == null) return undefined
  if (typeof v === 'object') return v as T
  if (typeof v !== 'string') return undefined
  try {
    return JSON.parse(v) as T
  } catch {
    return undefined
  }
}

interface RawMessage {
  role: string
  content?: unknown
  parts?: Array<{ type?: string; content?: unknown }>
  tool_calls?: Array<{
    id?: string
    function?: { name?: string; arguments?: unknown }
    type?: string
  }>
  tool_call_id?: string
  finish_reason?: string
}

interface VercelContentPart {
  type?: string
  text?: string
  // image/file parts may carry a URL or data ref
  image?: string
  data?: string
  mimeType?: string
}

function normalizeMessageParts(raw: RawMessage): GenAiMessagePart[] {
  // Newer semconv: parts[].type/content.
  if (Array.isArray(raw.parts)) {
    return raw.parts.map((p): GenAiMessagePart => {
      const type = p.type ?? 'text'
      if (type === 'text') return { kind: 'text', text: String(p.content ?? '') }
      if (type === 'image') return { kind: 'image', mediaType: 'image/*', dataRef: String(p.content ?? '') }
      if (type === 'audio') return { kind: 'audio', mediaType: 'audio/*', dataRef: String(p.content ?? '') }
      return { kind: 'json', value: p.content }
    })
  }
  // Vercel AI SDK shape: content is an array of `{type, text|image|...}`.
  if (Array.isArray(raw.content)) {
    return (raw.content as VercelContentPart[]).map((p): GenAiMessagePart => {
      if (p.type === 'text' || p.text !== undefined) {
        return { kind: 'text', text: String(p.text ?? '') }
      }
      if (p.type === 'image') {
        return { kind: 'image', mediaType: p.mimeType ?? 'image/*', dataRef: String(p.image ?? p.data ?? '') }
      }
      if (p.type === 'audio') {
        return { kind: 'audio', mediaType: p.mimeType ?? 'audio/*', dataRef: String(p.data ?? '') }
      }
      return { kind: 'json', value: p }
    })
  }
  // Legacy: content as plain string.
  if (typeof raw.content === 'string') return [{ kind: 'text', text: raw.content }]
  if (raw.content != null) return [{ kind: 'json', value: raw.content }]
  return []
}

interface AiSdkContentPart {
  type?: string
  text?: string
  toolCallId?: string
  toolName?: string
  input?: unknown
  output?: { type?: string; value?: unknown } | unknown
}

function normalizeMessage(raw: RawMessage): GenAiMessage {
  const role = (raw.role as GenAiMessage['role']) ?? 'user'

  // Vercel AI SDK encodes tool calls and results as content parts with
  // `type: 'tool-call'` / `type: 'tool-result'`. Pull those out into the
  // structured GenAiMessage fields so they render in the dedicated UI
  // instead of dumping raw JSON into the message body.
  //
  // When a single tool-role message bundles MULTIPLE tool-results, we expand
  // into one synthetic tool message per result so each lines up with its
  // matching assistant call (and each shows its own tool_call_id chip).
  // Callers must check `_expanded` and splice the array of returned messages
  // — see `expandMessage` below.
  if (Array.isArray(raw.content)) {
    const content = raw.content as AiSdkContentPart[]
    const hasToolPart = content.some(
      (p) => p.type === 'tool-call' || p.type === 'tool-result',
    )
    if (hasToolPart) {
      const toolCalls: GenAiToolCall[] = []
      const parts: GenAiMessagePart[] = []
      const toolResults: Array<{ id?: string; value: unknown }> = []
      for (const part of content) {
        if (part.type === 'tool-call') {
          toolCalls.push({
            id: part.toolCallId,
            name: part.toolName ?? '',
            arguments: parseJson(part.input) ?? part.input ?? {},
          })
        } else if (part.type === 'tool-result') {
          const out = part.output
          const value =
            out && typeof out === 'object' && 'value' in (out as object)
              ? (out as { value: unknown }).value
              : out
          toolResults.push({ id: part.toolCallId, value })
        } else if (part.type === 'text' || part.text !== undefined) {
          parts.push({ kind: 'text', text: String(part.text ?? '') })
        }
      }
      if (toolResults.length > 1) {
        // Encode multiple tool results as an expansion sentinel — the caller
        // (expandMessage) will produce one GenAiMessage per result.
        const msg: GenAiMessage = { role, parts: [] }
        ;(msg as GenAiMessage & { _toolResults?: typeof toolResults })._toolResults = toolResults
        return msg
      }
      const msg: GenAiMessage = { role, parts }
      if (toolCalls.length > 0) msg.toolCalls = toolCalls
      if (toolResults.length === 1) {
        msg.toolCallId = toolResults[0].id
        msg.parts = [{ kind: 'json', value: toolResults[0].value }]
      }
      if (raw.finish_reason) msg.finishReason = raw.finish_reason
      return msg
    }
  }

  const msg: GenAiMessage = { role, parts: normalizeMessageParts(raw) }
  if (Array.isArray(raw.tool_calls) && raw.tool_calls.length > 0) {
    msg.toolCalls = raw.tool_calls.map((tc): GenAiToolCall => ({
      id: tc.id,
      name: tc.function?.name ?? '',
      arguments: parseJson(tc.function?.arguments) ?? tc.function?.arguments ?? {},
      type: tc.type,
    }))
  }
  if (raw.tool_call_id) msg.toolCallId = raw.tool_call_id
  if (raw.finish_reason) msg.finishReason = raw.finish_reason
  return msg
}

function readMessagesAttribute(attrs: Attrs, key: string): GenAiMessage[] | undefined {
  const value = parseJson<RawMessage[]>(attrs[key])
  if (!Array.isArray(value)) return undefined
  return value.map(normalizeMessage)
}

interface SpanEvent {
  name: string
  timestamp: number
  attributes?: Record<string, unknown>
}

function messagesFromEvents(events: SpanEvent[] | undefined): GenAiMessage[] {
  if (!events || events.length === 0) return []
  const out: GenAiMessage[] = []
  for (const ev of events) {
    const attrs = ev.attributes ?? {}
    // `gen_ai.choice` carries the assistant output; older legacy shape.
    if (ev.name === 'gen_ai.choice') {
      const message = parseJson<RawMessage>(attrs.message) ?? (attrs.message as RawMessage | undefined)
      const finishReason = str(attrs.finish_reason)
      if (message) {
        const normalized = normalizeMessage(message)
        if (finishReason) normalized.finishReason = finishReason
        out.push(normalized)
      }
      continue
    }
    // gen_ai.{system,user,assistant,tool}.message
    const m = ev.name.match(/^gen_ai\.(system|user|assistant|tool)\.message$/)
    if (!m) continue
    const role = m[1] as GenAiMessage['role']
    const content = attrs.content
    const parsed = typeof content === 'string' ? parseJson(content) ?? content : content
    out.push(normalizeMessage({
      role,
      content: parsed,
      tool_calls: parseJson(attrs.tool_calls),
      tool_call_id: str(attrs.id) ?? str(attrs.tool_call_id),
    }))
  }
  return out
}

function readToolDefinitions(attrs: Attrs): GenAiToolDef[] | undefined {
  const raw = parseJson<Array<{ name?: string; description?: string; type?: string; schema?: unknown; parameters?: unknown }>>(
    attrs['gen_ai.tool.definitions'] ?? attrs['gen_ai.orchestrator.agent.definitions'],
  )
  if (!Array.isArray(raw)) return undefined
  return raw
    .filter((d) => typeof d.name === 'string')
    .map((d) => ({
      name: d.name as string,
      description: d.description,
      type: d.type,
      schema: d.schema ?? d.parameters,
    }))
}

function readUsage(attrs: Attrs): GenAiUsage {
  const inputTokens =
    num(attrs['gen_ai.usage.input_tokens']) ??
    num(attrs['gen_ai.usage.prompt_tokens']) ??
    num(attrs['llm.usage.prompt_tokens']) ??
    num(attrs['ai.usage.inputTokens'])
  const outputTokens =
    num(attrs['gen_ai.usage.output_tokens']) ??
    num(attrs['gen_ai.usage.completion_tokens']) ??
    num(attrs['llm.usage.completion_tokens']) ??
    num(attrs['ai.usage.outputTokens'])
  return {
    inputTokens,
    outputTokens,
    reasoningOutputTokens: num(attrs['gen_ai.usage.reasoning.output_tokens']),
    cacheReadInputTokens: num(attrs['gen_ai.usage.cache_read.input_tokens']),
    cacheCreationInputTokens: num(attrs['gen_ai.usage.cache_creation.input_tokens']),
  }
}

function normalizeProviderName(raw: string): string {
  const p = raw.toLowerCase()
  if (p === 'az.ai.openai' || p === 'azure_openai') return 'openai'
  if (
    p === 'gcp.vertex_ai' ||
    p === 'vertex_ai' ||
    p === 'gcp.gemini' ||
    p === 'google-gla' || // Logfire / Pydantic AI naming for Google GenAI library
    p === 'google_genai' ||
    p === 'gemini'
  ) {
    return 'google'
  }
  return p
}

const KNOWN_TOP_LEVEL_KEYS = new Set([
  'gen_ai.system',
  'gen_ai.provider.name',
  'gen_ai.operation.name',
  'gen_ai.request.model',
  'gen_ai.response.model',
  'gen_ai.response.id',
  'gen_ai.response.finish_reasons',
  'gen_ai.request.temperature',
  'gen_ai.request.top_p',
  'gen_ai.request.top_k',
  'gen_ai.request.max_tokens',
  'gen_ai.request.stop_sequences',
  'gen_ai.request.seed',
  'gen_ai.request.frequency_penalty',
  'gen_ai.request.presence_penalty',
  'gen_ai.request.choice.count',
  'gen_ai.usage.input_tokens',
  'gen_ai.usage.output_tokens',
  'gen_ai.usage.prompt_tokens',
  'gen_ai.usage.completion_tokens',
  'gen_ai.usage.reasoning.output_tokens',
  'gen_ai.usage.cache_read.input_tokens',
  'gen_ai.usage.cache_creation.input_tokens',
  'gen_ai.input.messages',
  'gen_ai.output.messages',
  'gen_ai.input.messages.ref',
  'gen_ai.output.messages.ref',
  'gen_ai.system_instructions',
  'gen_ai.tool.definitions',
  'gen_ai.orchestrator.agent.definitions',
  'gen_ai.agent.id',
  'gen_ai.agent.name',
  'gen_ai.agent.description',
  'gen_ai.tool.name',
  'gen_ai.tool.call.id',
  'gen_ai.handoff.from_agent',
  'gen_ai.handoff.to_agent',
  'gen_ai.guardrail.name',
  'gen_ai.guardrail.triggered',
  'gen_ai.conversation.id',
  'gen_ai.evaluation.name',
  'gen_ai.evaluation.score.value',
  'gen_ai.evaluation.score.label',
  'gen_ai.evaluation.explanation',
  'gen_ai.audio.input.format',
  'gen_ai.audio.output.format',
  'gen_ai.speech.voice',
  'gen_ai.speech.input_text',
  'gen_ai.transcription.text',
  'gen_ai.embeddings.dimension.count',
  'gen_ai.openai.request.service_tier',
  'gen_ai.openai.response.service_tier',
  'gen_ai.openai.response.system_fingerprint',
  'gen_ai.openai.request.response_format',
  'openai.request.service_tier',
  'openai.response.service_tier',
  'openai.response.system_fingerprint',
  'openai.request.response_format',
])

export function toGenAiSpan(span: SpanData): GenAiSpan {
  const attrs = (span.attributes ?? {}) as Attrs

  const rawProvider =
    str(attrs['gen_ai.provider.name']) ??
    str(attrs['gen_ai.system']) ??
    // Vercel AI SDK wrapper spans expose only `ai.model.provider`.
    str(attrs['ai.model.provider']) ??
    'unknown'
  const provider = normalizeProviderName(rawProvider)
  const operation = str(attrs['gen_ai.operation.name']) ?? 'chat'
  const requestModel =
    str(attrs['gen_ai.request.model']) ??
    str(attrs['llm.request.model']) ??
    // Pydantic AI's `agent run` parent span carries `model_name` but not
    // `gen_ai.request.model`. Same pattern for any host-language convention
    // that mirrors gen_ai.* loosely.
    str(attrs['model_name']) ??
    str(attrs['ai.model.id']) ??
    'unknown'
  const responseModel =
    str(attrs['gen_ai.response.model']) ??
    str(attrs['llm.response.model']) ??
    str(attrs['ai.response.model'])

  // Messages: prefer attribute payloads (newer), fall back to span events (older).
  const inputMessages = readMessagesAttribute(attrs, 'gen_ai.input.messages') ?? []
  const outputMessages = readMessagesAttribute(attrs, 'gen_ai.output.messages') ?? []
  // `gen_ai.system_instructions` carries an array of parts (not messages with
  // roles) — wrap into a single synthetic system message. Some instrumentations
  // emit it as full messages; readMessagesAttribute handles that shape already,
  // so detect-and-wrap only if the parsed value is part-shaped.
  let systemInstructions: GenAiMessage[] = []
  const rawSystem = parseJson<unknown>(attrs['gen_ai.system_instructions'])
  if (Array.isArray(rawSystem) && rawSystem.length > 0) {
    const first = rawSystem[0] as { role?: string; type?: string }
    if (first && typeof first === 'object' && 'role' in first) {
      systemInstructions = rawSystem.map((m) => normalizeMessage(m as RawMessage))
    } else {
      // Parts-shaped: wrap as one system message.
      const parts: GenAiMessagePart[] = (rawSystem as Array<{ type?: string; content?: unknown }>).map((p) =>
        p.type === 'text' || p.content !== undefined
          ? { kind: 'text', text: String(p.content ?? '') }
          : { kind: 'json', value: p },
      )
      systemInstructions = [{ role: 'system', parts }]
    }
  }
  let messages: GenAiMessage[] =
    inputMessages.length || outputMessages.length || systemInstructions.length
      ? [...systemInstructions, ...inputMessages, ...outputMessages]
      : messagesFromEvents(span.events)

  // If a provider externalized payloads via `.ref`, surface a clear placeholder
  // — but only for a direction with no real content from ANY source (attribute
  // payload, span events, or legacy indexed keys). Otherwise during semconv
  // migration we'd render duplicate transcript turns.
  const inputRef = str(attrs['gen_ai.input.messages.ref'])
  const outputRef = str(attrs['gen_ai.output.messages.ref'])
  const hasInputContent = messages.some((m) => m.role === 'system' || m.role === 'user')
  const hasOutputContent = messages.some((m) => m.role === 'assistant')
  if (inputRef && !hasInputContent) {
    messages.push({ role: 'user', parts: [{ kind: 'ref', ref: inputRef, direction: 'input' }] })
  }
  if (outputRef && !hasOutputContent) {
    messages.push({ role: 'assistant', parts: [{ kind: 'ref', ref: outputRef, direction: 'output' }] })
  }

  // Vercel AI SDK shape: `ai.prompt.messages` JSON array + `ai.response.text`
  // bare string. The AI SDK emits a subset of gen_ai.* attributes but keeps
  // the conversation payload in its own `ai.*` namespace.
  if (messages.length === 0) {
    const aiPrompt = parseJson<RawMessage[]>(attrs['ai.prompt.messages'])
    if (Array.isArray(aiPrompt)) {
      messages.push(...aiPrompt.map(normalizeMessage))
    } else {
      // Wrapper span (`ai.generateText`) carries `ai.prompt` as `{system, prompt}`.
      const aiPromptBlob = parseJson<{ system?: string; prompt?: string; messages?: RawMessage[] }>(attrs['ai.prompt'])
      if (aiPromptBlob) {
        if (Array.isArray(aiPromptBlob.messages)) {
          messages.push(...aiPromptBlob.messages.map(normalizeMessage))
        } else {
          if (aiPromptBlob.system) {
            messages.push({ role: 'system', parts: [{ kind: 'text', text: aiPromptBlob.system }] })
          }
          if (aiPromptBlob.prompt) {
            messages.push({ role: 'user', parts: [{ kind: 'text', text: aiPromptBlob.prompt }] })
          }
        }
      }
    }
    // Tool calls live on `ai.response.toolCalls` (args only) — promote them
    // onto the assistant message so they render inline with the transcript.
    const aiResponseToolCalls = parseJson<Array<{ toolCallId?: string; toolName?: string; input?: unknown; args?: unknown }>>(
      attrs['ai.response.toolCalls'],
    )
    const assistantToolCalls: GenAiToolCall[] | undefined = Array.isArray(aiResponseToolCalls)
      ? aiResponseToolCalls
          .filter((c) => typeof c.toolName === 'string')
          .map((c) => ({
            id: c.toolCallId,
            name: c.toolName as string,
            arguments: parseJson(c.input ?? c.args) ?? c.input ?? c.args ?? {},
          }))
      : undefined
    const aiResponseText = str(attrs['ai.response.text'])
    if (aiResponseText || (assistantToolCalls && assistantToolCalls.length > 0)) {
      const finishReason = strArray(attrs['gen_ai.response.finish_reasons'])?.[0] ?? str(attrs['ai.response.finishReason'])
      const msg = normalizeMessage({ role: 'assistant', content: aiResponseText ?? '' })
      if (finishReason) msg.finishReason = finishReason
      if (assistantToolCalls && assistantToolCalls.length > 0) msg.toolCalls = assistantToolCalls
      messages.push(msg)
    }
  }

  // Pydantic AI shape: `pydantic_ai.all_messages` JSON array on the parent
  // `agent run` span carries the full transcript in canonical parts shape.
  // Without this fallback, the parent span shows an empty conversation
  // even though all the data is right there on the attribute.
  if (messages.length === 0) {
    const pydanticMessages = parseJson<RawMessage[]>(attrs['pydantic_ai.all_messages'])
    if (Array.isArray(pydanticMessages)) {
      messages.push(...pydanticMessages.map(normalizeMessage))
    }
  }

  // OpenLLMetry legacy `llm.prompts.{n}.{role,content}` keys.
  if (messages.length === 0) {
    const legacy: GenAiMessage[] = []
    for (let i = 0; i < 32; i++) {
      const role = str(attrs[`gen_ai.prompt.${i}.role`]) ?? str(attrs[`llm.prompts.${i}.role`])
      const content = attrs[`gen_ai.prompt.${i}.content`] ?? attrs[`llm.prompts.${i}.content`]
      if (!role) break
      legacy.push(normalizeMessage({ role, content }))
    }
    for (let i = 0; i < 32; i++) {
      const role = str(attrs[`gen_ai.completion.${i}.role`]) ?? str(attrs[`llm.completions.${i}.role`])
      const content = attrs[`gen_ai.completion.${i}.content`] ?? attrs[`llm.completions.${i}.content`]
      const finishReason = str(attrs[`gen_ai.completion.${i}.finish_reason`])
      if (!role) break
      const msg = normalizeMessage({ role, content })
      if (finishReason) msg.finishReason = finishReason
      legacy.push(msg)
    }
    if (legacy.length > 0) messages = legacy
  }

  // Expand any tool-role messages that bundled multiple tool-results into
  // one message per result, so each gets its own tool_call_id chip.
  messages = messages.flatMap((m) => {
    const bundled = (m as GenAiMessage & {
      _toolResults?: Array<{ id?: string; value: unknown }>
    })._toolResults
    if (!bundled) return [m]
    return bundled.map((r) => ({
      role: 'tool' as const,
      parts: [{ kind: 'json' as const, value: r.value }],
      toolCallId: r.id,
    }))
  })

  // Tool calls aggregated from assistant messages.
  const toolCalls: GenAiToolCall[] = []
  for (const m of messages) if (m.toolCalls) toolCalls.push(...m.toolCalls)

  // Back-fill tool results by matching tool-role messages (which carry
  // `tool_call_id`) against the call list. Result becomes the text content
  // of the tool message, or parsed JSON when content is structured.
  if (toolCalls.length > 0) {
    const callsById = new Map<string, GenAiToolCall>()
    for (const tc of toolCalls) if (tc.id) callsById.set(tc.id, tc)
    for (const m of messages) {
      if (m.role !== 'tool' || !m.toolCallId) continue
      const target = callsById.get(m.toolCallId)
      if (!target || target.result !== undefined) continue
      const textPart = m.parts.find((p) => p.kind === 'text')
      const jsonPart = m.parts.find((p) => p.kind === 'json')
      if (textPart && textPart.kind === 'text') {
        target.result = parseJson(textPart.text) ?? textPart.text
      } else if (jsonPart && jsonPart.kind === 'json') {
        target.result = jsonPart.value
      }
    }
  }

  const usage = readUsage(attrs)
  const cost = priceCall({
    provider,
    model: responseModel ?? requestModel,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadInputTokens: usage.cacheReadInputTokens,
    cacheCreationInputTokens: usage.cacheCreationInputTokens,
  })

  const finishReasons = strArray(attrs['gen_ai.response.finish_reasons'])

  const agentName = str(attrs['gen_ai.agent.name'])
  const agentId = str(attrs['gen_ai.agent.id'])
  const agentDescription = str(attrs['gen_ai.agent.description'])
  const toolName = str(attrs['gen_ai.tool.name'])
  const toolCallId = str(attrs['gen_ai.tool.call.id'])
  const handoffFrom = str(attrs['gen_ai.handoff.from_agent'])
  const handoffTo = str(attrs['gen_ai.handoff.to_agent'])
  const guardrailName = str(attrs['gen_ai.guardrail.name'])
  const guardrailTriggered = bool(attrs['gen_ai.guardrail.triggered'])
  const evalName = str(attrs['gen_ai.evaluation.name'])
  const evalScoreValue = num(attrs['gen_ai.evaluation.score.value'])
  const evalScoreLabel = str(attrs['gen_ai.evaluation.score.label'])
  const evalExplanation = str(attrs['gen_ai.evaluation.explanation'])

  const audioIn = str(attrs['gen_ai.audio.input.format'])
  const audioOut = str(attrs['gen_ai.audio.output.format'])
  const speechVoice = str(attrs['gen_ai.speech.voice'])
  const speechInputText = str(attrs['gen_ai.speech.input_text'])
  const transcriptionText = str(attrs['gen_ai.transcription.text'])
  const embeddingDims = num(attrs['gen_ai.embeddings.dimension.count'])

  const raw: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(attrs)) {
    if (KNOWN_TOP_LEVEL_KEYS.has(k)) continue
    if (k.startsWith('gen_ai.prompt.') || k.startsWith('gen_ai.completion.')) continue
    if (k.startsWith('llm.prompts.') || k.startsWith('llm.completions.')) continue
    raw[k] = v
  }

  return {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    startMs: span.startTime,
    endMs: span.endTime,
    status:
      span.status?.code === 'OK' ? 'ok' : span.status?.code === 'ERROR' ? 'error' : 'unset',
    errorMessage: span.status?.message,

    provider,
    operation,
    requestModel,
    responseModel,

    params: {
      temperature: num(attrs['gen_ai.request.temperature']),
      topP: num(attrs['gen_ai.request.top_p']),
      topK: num(attrs['gen_ai.request.top_k']),
      maxTokens: num(attrs['gen_ai.request.max_tokens']),
      stopSequences: strArray(attrs['gen_ai.request.stop_sequences']),
      seed: num(attrs['gen_ai.request.seed']),
      frequencyPenalty: num(attrs['gen_ai.request.frequency_penalty']),
      presencePenalty: num(attrs['gen_ai.request.presence_penalty']),
      choiceCount: num(attrs['gen_ai.request.choice.count']),
    },

    messages,
    toolDefinitions: readToolDefinitions(attrs),
    toolCalls,

    usage,
    cost,

    finishReasons,
    responseId: str(attrs['gen_ai.response.id']),

    agent: agentId || agentName || agentDescription
      ? { id: agentId, name: agentName, description: agentDescription }
      : undefined,
    tool: toolName || toolCallId ? { name: toolName, callId: toolCallId } : undefined,
    handoff: handoffFrom || handoffTo ? { fromAgent: handoffFrom, toAgent: handoffTo } : undefined,
    guardrail: guardrailName || guardrailTriggered !== undefined
      ? { name: guardrailName, triggered: guardrailTriggered }
      : undefined,
    conversationId: str(attrs['gen_ai.conversation.id']),
    evaluation:
      evalName || evalScoreValue !== undefined || evalScoreLabel || evalExplanation
        ? {
            name: evalName,
            scoreValue: evalScoreValue,
            scoreLabel: evalScoreLabel,
            explanation: evalExplanation,
          }
        : undefined,

    modality:
      audioIn || audioOut || speechVoice || speechInputText || transcriptionText || embeddingDims
        ? {
            audioInputFormat: audioIn,
            audioOutputFormat: audioOut,
            speechVoice,
            speechInputText,
            transcriptionText,
            embeddingDimensions: embeddingDims,
          }
        : undefined,

    extras: {
      openaiServiceTier:
        str(attrs['gen_ai.openai.request.service_tier']) ||
        str(attrs['gen_ai.openai.response.service_tier']) ||
        str(attrs['openai.request.service_tier']) ||
        str(attrs['openai.response.service_tier'])
          ? {
              request:
                str(attrs['gen_ai.openai.request.service_tier']) ??
                str(attrs['openai.request.service_tier']),
              response:
                str(attrs['gen_ai.openai.response.service_tier']) ??
                str(attrs['openai.response.service_tier']),
            }
          : undefined,
      openaiSystemFingerprint:
        str(attrs['gen_ai.openai.response.system_fingerprint']) ??
        str(attrs['openai.response.system_fingerprint']),
      openaiResponseFormat:
        str(attrs['gen_ai.openai.request.response_format']) ??
        str(attrs['openai.request.response_format']),
      raw,
    },
  }
}
