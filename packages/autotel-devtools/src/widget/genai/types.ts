// Normalized GenAI model consumed by the GenAI view.
// Spec: ../../../docs/genai-view-spec.md

export type GenAiOperation =
  | 'chat'
  | 'text_completion'
  | 'embeddings'
  | 'generate_content'
  | 'execute_tool'
  | 'invoke_agent'
  | 'create_agent'
  | 'speech'
  | 'transcription'
  | (string & {})

export type GenAiRole = 'system' | 'user' | 'assistant' | 'tool'

export type GenAiMessagePart =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mediaType: string; dataRef: string }
  | { kind: 'audio'; mediaType: string; dataRef: string }
  | { kind: 'json'; value: unknown }
  // Used when a provider externalizes large message bodies via
  // `gen_ai.{input,output}.messages.ref` rather than inlining them.
  | { kind: 'ref'; ref: string; direction: 'input' | 'output' }

export interface GenAiToolDef {
  name: string
  description?: string
  type?: string
  schema?: unknown
}

export interface GenAiToolCall {
  id?: string
  name: string
  arguments: unknown
  result?: unknown
  type?: string
}

export interface GenAiMessage {
  role: GenAiRole
  parts: GenAiMessagePart[]
  toolCalls?: GenAiToolCall[]
  toolCallId?: string
  finishReason?: string
}

export interface GenAiUsage {
  inputTokens?: number
  outputTokens?: number
  reasoningOutputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
}

export interface GenAiCost {
  currency: 'USD'
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  source: 'table' | 'unknown'
}

export interface GenAiSpan {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  // Milliseconds (the SpanData contract — OTLP nanos are converted to ms at
  // ingestion in server/otlp.ts). Absolute nanosecond unix timestamps overflow
  // JS Number precision, which is why the whole app works in ms.
  startMs: number
  endMs: number
  status: 'ok' | 'error' | 'unset'
  errorMessage?: string

  provider: string
  operation: GenAiOperation
  requestModel: string
  responseModel?: string

  params: {
    temperature?: number
    topP?: number
    topK?: number
    maxTokens?: number
    stopSequences?: string[]
    seed?: number
    frequencyPenalty?: number
    presencePenalty?: number
    choiceCount?: number
  }

  messages: GenAiMessage[]

  toolDefinitions?: GenAiToolDef[]
  toolCalls: GenAiToolCall[]

  usage: GenAiUsage
  cost?: GenAiCost

  finishReasons?: string[]
  responseId?: string

  agent?: { id?: string; name?: string; description?: string }
  // The executed tool, on `execute_tool` spans (`gen_ai.tool.*`). Distinct from
  // `toolCalls` (a model's *requests* to call tools) and from `agent`.
  tool?: { name?: string; callId?: string }
  handoff?: { fromAgent?: string; toAgent?: string }
  guardrail?: { name?: string; triggered?: boolean }
  conversationId?: string
  evaluation?: {
    name?: string
    scoreValue?: number
    scoreLabel?: string
    explanation?: string
  }

  modality?: {
    audioInputFormat?: string
    audioOutputFormat?: string
    speechVoice?: string
    speechInputText?: string
    transcriptionText?: string
    embeddingDimensions?: number
  }

  extras: {
    openaiServiceTier?: { request?: string; response?: string }
    openaiSystemFingerprint?: string
    openaiResponseFormat?: string
    raw: Record<string, unknown>
  }
}
