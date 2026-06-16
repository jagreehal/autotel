/**
 * OpenTelemetry GenAI semantic conventions — canonical constants.
 *
 * Source of truth for `gen_ai.*` attribute keys, operation names, provider
 * names, and span-naming rules, aligned to the semantic-conventions snapshot
 * in `/Users/jreehal/dev/temp/semantic-conventions-genai`.
 *
 * Everything here is the canonical underscore namespace (`gen_ai.*`). There is
 * no legacy `gen.ai.*` / `prompt_tokens` / `completion_tokens` surface — this
 * package is canonical-only by design.
 *
 * @see https://opentelemetry.io/docs/specs/semconv/gen-ai/
 */

/**
 * Canonical `gen_ai.*` attribute keys.
 *
 * Grouped by the spec's registry sections. Use these constants instead of
 * string literals so a future spec rename is a one-line change here.
 */
export const GEN_AI = {
  // --- Endpoint ------------------------------------------------------------
  SERVER_ADDRESS: 'server.address',
  SERVER_PORT: 'server.port',

  // --- Operation & provider ------------------------------------------------
  OPERATION_NAME: 'gen_ai.operation.name',
  PROVIDER_NAME: 'gen_ai.provider.name',
  CONVERSATION_ID: 'gen_ai.conversation.id',
  DATA_SOURCE_ID: 'gen_ai.data_source.id',
  OUTPUT_TYPE: 'gen_ai.output.type',

  // --- Request -------------------------------------------------------------
  REQUEST_MODEL: 'gen_ai.request.model',
  REQUEST_MAX_TOKENS: 'gen_ai.request.max_tokens',
  REQUEST_TEMPERATURE: 'gen_ai.request.temperature',
  REQUEST_TOP_P: 'gen_ai.request.top_p',
  REQUEST_TOP_K: 'gen_ai.request.top_k',
  REQUEST_FREQUENCY_PENALTY: 'gen_ai.request.frequency_penalty',
  REQUEST_PRESENCE_PENALTY: 'gen_ai.request.presence_penalty',
  REQUEST_STOP_SEQUENCES: 'gen_ai.request.stop_sequences',
  REQUEST_SEED: 'gen_ai.request.seed',
  REQUEST_STREAM: 'gen_ai.request.stream',
  REQUEST_CHOICE_COUNT: 'gen_ai.request.choice.count',
  REQUEST_ENCODING_FORMATS: 'gen_ai.request.encoding_formats',

  // --- Response ------------------------------------------------------------
  RESPONSE_MODEL: 'gen_ai.response.model',
  RESPONSE_ID: 'gen_ai.response.id',
  RESPONSE_FINISH_REASONS: 'gen_ai.response.finish_reasons',
  RESPONSE_TIME_TO_FIRST_CHUNK: 'gen_ai.response.time_to_first_chunk',

  // --- Usage ---------------------------------------------------------------
  USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
  USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
  USAGE_REASONING_OUTPUT_TOKENS: 'gen_ai.usage.reasoning.output_tokens',
  USAGE_CACHE_READ_INPUT_TOKENS: 'gen_ai.usage.cache_read.input_tokens',
  USAGE_CACHE_CREATION_INPUT_TOKENS: 'gen_ai.usage.cache_creation.input_tokens',
  TOKEN_TYPE: 'gen_ai.token.type',

  // --- Content (opt-in, may carry sensitive data) --------------------------
  INPUT_MESSAGES: 'gen_ai.input.messages',
  OUTPUT_MESSAGES: 'gen_ai.output.messages',
  SYSTEM_INSTRUCTIONS: 'gen_ai.system_instructions',

  // --- Agent ---------------------------------------------------------------
  AGENT_ID: 'gen_ai.agent.id',
  AGENT_NAME: 'gen_ai.agent.name',
  AGENT_VERSION: 'gen_ai.agent.version',
  AGENT_DESCRIPTION: 'gen_ai.agent.description',

  // --- Tool ----------------------------------------------------------------
  TOOL_NAME: 'gen_ai.tool.name',
  TOOL_TYPE: 'gen_ai.tool.type',
  TOOL_DESCRIPTION: 'gen_ai.tool.description',
  TOOL_CALL_ID: 'gen_ai.tool.call.id',
  TOOL_CALL_ARGUMENTS: 'gen_ai.tool.call.arguments',
  TOOL_CALL_RESULT: 'gen_ai.tool.call.result',
  TOOL_DEFINITIONS: 'gen_ai.tool.definitions',

  // --- Workflow / prompt ---------------------------------------------------
  WORKFLOW_NAME: 'gen_ai.workflow.name',
  PROMPT_NAME: 'gen_ai.prompt.name',

  // --- Embeddings ----------------------------------------------------------
  EMBEDDINGS_DIMENSION_COUNT: 'gen_ai.embeddings.dimension.count',

  // --- Retrieval -----------------------------------------------------------
  RETRIEVAL_TOP_K: 'gen_ai.retrieval.top_k',
  RETRIEVAL_QUERY_TEXT: 'gen_ai.retrieval.query.text',
  RETRIEVAL_DOCUMENTS: 'gen_ai.retrieval.documents',

  // --- Memory --------------------------------------------------------------
  MEMORY_STORE_ID: 'gen_ai.memory.store.id',
  MEMORY_RECORD_ID: 'gen_ai.memory.record.id',
  MEMORY_RECORD_COUNT: 'gen_ai.memory.record.count',
  MEMORY_QUERY_TEXT: 'gen_ai.memory.query.text',
  MEMORY_RECORDS: 'gen_ai.memory.records',

  // --- Evaluation ----------------------------------------------------------
  EVALUATION_NAME: 'gen_ai.evaluation.name',
  EVALUATION_SCORE_VALUE: 'gen_ai.evaluation.score.value',
  EVALUATION_SCORE_LABEL: 'gen_ai.evaluation.score.label',
  EVALUATION_EXPLANATION: 'gen_ai.evaluation.explanation',

  // --- Cost (autotel extension — not part of the published spec) -----------
  /**
   * Estimated USD cost for the call. NOT an OpenTelemetry attribute; an autotel
   * convenience derived from token usage and {@link MODEL_PRICING}. Kept under
   * the `gen_ai.usage.*` prefix so it sits beside the spec usage attributes.
   */
  USAGE_COST_USD: 'gen_ai.usage.cost.usd',
} as const;

/** Union of every canonical `gen_ai.*` attribute key. */
export type GenAiAttributeKey = (typeof GEN_AI)[keyof typeof GEN_AI];

/**
 * `gen_ai.operation.name` values. Determines span name and which attributes are
 * required. The `*_memory*` set is included for completeness with v1.42.0.
 */
export const GEN_AI_OPERATION = {
  CHAT: 'chat',
  GENERATE_CONTENT: 'generate_content',
  TEXT_COMPLETION: 'text_completion',
  EMBEDDINGS: 'embeddings',
  RETRIEVAL: 'retrieval',
  CREATE_AGENT: 'create_agent',
  INVOKE_AGENT: 'invoke_agent',
  EXECUTE_TOOL: 'execute_tool',
  INVOKE_WORKFLOW: 'invoke_workflow',
  PLAN: 'plan',
  SEARCH_MEMORY: 'search_memory',
  CREATE_MEMORY: 'create_memory',
  UPDATE_MEMORY: 'update_memory',
  UPSERT_MEMORY: 'upsert_memory',
  DELETE_MEMORY: 'delete_memory',
  CREATE_MEMORY_STORE: 'create_memory_store',
  DELETE_MEMORY_STORE: 'delete_memory_store',
} as const;

export type GenAiOperationName =
  (typeof GEN_AI_OPERATION)[keyof typeof GEN_AI_OPERATION];

/**
 * Well-known `gen_ai.provider.name` values (v1.42.0). The attribute is an open
 * enum — any string is valid — but prefer these for the listed vendors so
 * dashboards group consistently.
 */
export const GEN_AI_PROVIDER = {
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  AWS_BEDROCK: 'aws.bedrock',
  AZURE_AI_INFERENCE: 'azure.ai.inference',
  AZURE_AI_OPENAI: 'azure.ai.openai',
  COHERE: 'cohere',
  DEEPSEEK: 'deepseek',
  GCP_GEMINI: 'gcp.gemini',
  GCP_GEN_AI: 'gcp.gen_ai',
  GCP_VERTEX_AI: 'gcp.vertex_ai',
  GROQ: 'groq',
  IBM_WATSONX_AI: 'ibm.watsonx.ai',
  MISTRAL_AI: 'mistral_ai',
  MOONSHOT_AI: 'moonshot_ai',
  PERPLEXITY: 'perplexity',
  X_AI: 'x_ai',
} as const;

/** A well-known provider value, or any other vendor string. */
export type GenAiProviderName =
  | (typeof GEN_AI_PROVIDER)[keyof typeof GEN_AI_PROVIDER]
  | (string & {});

/** `gen_ai.token.type` values (metric dimension). */
export const GEN_AI_TOKEN_TYPE = {
  INPUT: 'input',
  OUTPUT: 'output',
} as const;

export type GenAiTokenType =
  (typeof GEN_AI_TOKEN_TYPE)[keyof typeof GEN_AI_TOKEN_TYPE];

/** `gen_ai.output.type` values. */
export const GEN_AI_OUTPUT_TYPE = {
  TEXT: 'text',
  JSON: 'json',
  IMAGE: 'image',
  SPEECH: 'speech',
} as const;

export type GenAiOutputType =
  (typeof GEN_AI_OUTPUT_TYPE)[keyof typeof GEN_AI_OUTPUT_TYPE];

/** `gen_ai.tool.type` values. */
export const GEN_AI_TOOL_TYPE = {
  FUNCTION: 'function',
  EXTENSION: 'extension',
  DATASTORE: 'datastore',
} as const;

export type GenAiToolType =
  (typeof GEN_AI_TOOL_TYPE)[keyof typeof GEN_AI_TOOL_TYPE];

/** Canonical client metric instrument names (histograms). */
export const GEN_AI_METRIC = {
  TOKEN_USAGE: 'gen_ai.client.token.usage',
  OPERATION_DURATION: 'gen_ai.client.operation.duration',
  TIME_TO_FIRST_CHUNK: 'gen_ai.client.operation.time_to_first_chunk',
  TIME_PER_OUTPUT_CHUNK: 'gen_ai.client.operation.time_per_output_chunk',
  WORKFLOW_DURATION: 'gen_ai.workflow.duration',
} as const;

/** Canonical event names from the GenAI semantic conventions snapshot. */
export const GEN_AI_EVENT = {
  INFERENCE_OPERATION_DETAILS: 'gen_ai.client.inference.operation.details',
  EVALUATION_RESULT: 'gen_ai.evaluation.result',
  CLIENT_OPERATION_EXCEPTION: 'gen_ai.client.operation.exception',
} as const;

/**
 * Compute the span name once you've already picked the canonical identifier for
 * the operation. Upstream rules vary by operation: inference uses
 * `request.model`, retrieval uses `data_source.id`, tools use `tool.name`,
 * agents use `agent.name`, workflows use `workflow.name`, and memory spans
 * often have no trailing identifier at all.
 *
 * @example
 * ```ts
 * genAiSpanName('chat', 'gpt-4o');            // 'chat gpt-4o'
 * genAiSpanName('execute_tool', 'get_weather'); // 'execute_tool get_weather'
 * genAiSpanName('invoke_agent');              // 'invoke_agent'
 * ```
 */
export function genAiSpanName(
  operation: GenAiOperationName | (string & {}),
  identifier?: string | undefined,
): string {
  const id = identifier?.trim();
  return id ? `${operation} ${id}` : operation;
}
