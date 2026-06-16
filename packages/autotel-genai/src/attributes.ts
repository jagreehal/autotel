/**
 * Typed builders for canonical `gen_ai.*` span attributes.
 *
 * Each builder takes a typed, camelCase input and returns a flat attribute map
 * keyed by the exact spec attribute names. Builders omit any field that is
 * `undefined`/`null`, so they compose cleanly with `ctx.setAttributes(...)`.
 *
 * @example
 * ```ts
 * ctx.setAttributes({
 *   ...genAiRequestAttributes({ operation: 'chat', provider: 'openai', model: 'gpt-4o', temperature: 0.2 }),
 *   ...genAiUsageAttributes({ inputTokens: 412, outputTokens: 87 }),
 * });
 * ```
 */

import {
  GEN_AI,
  type GenAiOperationName,
  type GenAiOutputType,
  type GenAiProviderName,
  type GenAiToolType,
} from './semconv.js';

/**
 * OpenTelemetry span attribute value — primitives and homogeneous arrays.
 *
 * Defined locally (rather than imported from `autotel`/`@opentelemetry/api`) so
 * it is the strict variant with no `null`/`undefined` array members, matching
 * what `TraceContext.setAttributes` accepts.
 */
export type GenAiAttributeValue =
  | string
  | number
  | boolean
  | string[]
  | number[]
  | boolean[];

/** Flat attribute map (canonical keys → primitive/array values). */
export type GenAiAttributeMap = Record<string, GenAiAttributeValue>;

function set(
  target: GenAiAttributeMap,
  key: string,
  value: GenAiAttributeValue | null | undefined,
): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value) && value.length === 0) return;
  target[key] = value;
}

/** Set `key` to the integer-truncated `value` (spec types these as int), unless absent. */
function setInt(
  target: GenAiAttributeMap,
  key: string,
  value: number | undefined,
): void {
  if (value === undefined) return;
  target[key] = Math.trunc(value);
}

/** Set `key` to the JSON-serialised `value` (spec types these as `any`), unless absent. */
function setJson(
  target: GenAiAttributeMap,
  key: string,
  value: unknown,
): void {
  if (value === undefined) return;
  target[key] = typeof value === 'string' ? value : JSON.stringify(value);
}

/** Request-side inputs for a GenAI operation. */
export interface GenAiRequestInput {
  operation?: GenAiOperationName | (string & {});
  provider?: GenAiProviderName;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  /** Integer per spec (decoding parameter, not OpenAI `top_logprobs`). */
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  seed?: number;
  stream?: boolean;
  choiceCount?: number;
  encodingFormats?: string[];
  conversationId?: string;
  dataSourceId?: string;
  outputType?: GenAiOutputType;
  serverAddress?: string;
  serverPort?: number;
}

export function genAiRequestAttributes(
  input: GenAiRequestInput,
): GenAiAttributeMap {
  const attrs: GenAiAttributeMap = {};
  set(attrs, GEN_AI.OPERATION_NAME, input.operation);
  set(attrs, GEN_AI.PROVIDER_NAME, input.provider);
  set(attrs, GEN_AI.REQUEST_MODEL, input.model);
  set(attrs, GEN_AI.REQUEST_MAX_TOKENS, input.maxTokens);
  set(attrs, GEN_AI.REQUEST_TEMPERATURE, input.temperature);
  set(attrs, GEN_AI.REQUEST_TOP_P, input.topP);
  setInt(attrs, GEN_AI.REQUEST_TOP_K, input.topK);
  set(attrs, GEN_AI.REQUEST_FREQUENCY_PENALTY, input.frequencyPenalty);
  set(attrs, GEN_AI.REQUEST_PRESENCE_PENALTY, input.presencePenalty);
  set(attrs, GEN_AI.REQUEST_STOP_SEQUENCES, input.stopSequences);
  set(attrs, GEN_AI.REQUEST_SEED, input.seed);
  set(attrs, GEN_AI.REQUEST_STREAM, input.stream);
  set(attrs, GEN_AI.REQUEST_CHOICE_COUNT, input.choiceCount);
  set(attrs, GEN_AI.REQUEST_ENCODING_FORMATS, input.encodingFormats);
  set(attrs, GEN_AI.CONVERSATION_ID, input.conversationId);
  set(attrs, GEN_AI.DATA_SOURCE_ID, input.dataSourceId);
  set(attrs, GEN_AI.OUTPUT_TYPE, input.outputType);
  set(attrs, GEN_AI.SERVER_ADDRESS, input.serverAddress);
  setInt(attrs, GEN_AI.SERVER_PORT, input.serverPort);
  return attrs;
}

/** Response-side inputs. */
export interface GenAiResponseInput {
  model?: string;
  id?: string;
  finishReasons?: string[];
  timeToFirstChunk?: number;
}

export function genAiResponseAttributes(
  input: GenAiResponseInput,
): GenAiAttributeMap {
  const attrs: GenAiAttributeMap = {};
  set(attrs, GEN_AI.RESPONSE_MODEL, input.model);
  set(attrs, GEN_AI.RESPONSE_ID, input.id);
  set(attrs, GEN_AI.RESPONSE_FINISH_REASONS, input.finishReasons);
  set(attrs, GEN_AI.RESPONSE_TIME_TO_FIRST_CHUNK, input.timeToFirstChunk);
  return attrs;
}

/** Token-usage inputs (camelCase mirror of `gen_ai.usage.*`). */
export interface GenAiUsageInput {
  inputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  /** Estimated USD cost (autotel extension). */
  costUsd?: number;
}

export function genAiUsageAttributes(input: GenAiUsageInput): GenAiAttributeMap {
  const attrs: GenAiAttributeMap = {};
  set(attrs, GEN_AI.USAGE_INPUT_TOKENS, input.inputTokens);
  set(attrs, GEN_AI.USAGE_OUTPUT_TOKENS, input.outputTokens);
  set(attrs, GEN_AI.USAGE_REASONING_OUTPUT_TOKENS, input.reasoningOutputTokens);
  set(attrs, GEN_AI.USAGE_CACHE_READ_INPUT_TOKENS, input.cacheReadInputTokens);
  set(
    attrs,
    GEN_AI.USAGE_CACHE_CREATION_INPUT_TOKENS,
    input.cacheCreationInputTokens,
  );
  set(attrs, GEN_AI.USAGE_COST_USD, input.costUsd);
  return attrs;
}

/** Agent inputs. */
export interface GenAiAgentInput {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
}

/**
 * Build `gen_ai.agent.*` attributes.
 *
 * Per spec breaking change #242, `gen_ai.agent.id` MUST NOT be recorded on
 * *internal* `invoke_agent` spans (in-memory instance ids are transient). Pass
 * `{ internal: true }` for in-process agent spans to drop the id; keep it for
 * `create_agent` and remote (CLIENT) `invoke_agent` spans.
 */
export function genAiAgentAttributes(
  input: GenAiAgentInput,
  options: { internal?: boolean } = {},
): GenAiAttributeMap {
  const attrs: GenAiAttributeMap = {};
  if (!options.internal) set(attrs, GEN_AI.AGENT_ID, input.id);
  set(attrs, GEN_AI.AGENT_NAME, input.name);
  set(attrs, GEN_AI.AGENT_VERSION, input.version);
  set(attrs, GEN_AI.AGENT_DESCRIPTION, input.description);
  return attrs;
}

/** Tool inputs. */
export interface GenAiToolInput {
  name?: string;
  type?: GenAiToolType;
  description?: string;
  callId?: string;
  callArguments?: unknown;
  callResult?: unknown;
}

export function genAiToolAttributes(input: GenAiToolInput): GenAiAttributeMap {
  const attrs: GenAiAttributeMap = {};
  set(attrs, GEN_AI.TOOL_NAME, input.name);
  set(attrs, GEN_AI.TOOL_TYPE, input.type);
  set(attrs, GEN_AI.TOOL_DESCRIPTION, input.description);
  set(attrs, GEN_AI.TOOL_CALL_ID, input.callId);
  setJson(attrs, GEN_AI.TOOL_CALL_ARGUMENTS, input.callArguments);
  setJson(attrs, GEN_AI.TOOL_CALL_RESULT, input.callResult);
  return attrs;
}

export interface GenAiRetrievalInput {
  topK?: number;
  queryText?: string;
  documents?: unknown;
}

export function genAiRetrievalAttributes(
  input: GenAiRetrievalInput,
): GenAiAttributeMap {
  const attrs: GenAiAttributeMap = {};
  setInt(attrs, GEN_AI.RETRIEVAL_TOP_K, input.topK);
  set(attrs, GEN_AI.RETRIEVAL_QUERY_TEXT, input.queryText);
  setJson(attrs, GEN_AI.RETRIEVAL_DOCUMENTS, input.documents);
  return attrs;
}

export interface GenAiMemoryInput {
  storeId?: string;
  recordId?: string;
  recordCount?: number;
  queryText?: string;
  records?: unknown;
}

export function genAiMemoryAttributes(
  input: GenAiMemoryInput,
): GenAiAttributeMap {
  const attrs: GenAiAttributeMap = {};
  set(attrs, GEN_AI.MEMORY_STORE_ID, input.storeId);
  set(attrs, GEN_AI.MEMORY_RECORD_ID, input.recordId);
  setInt(attrs, GEN_AI.MEMORY_RECORD_COUNT, input.recordCount);
  set(attrs, GEN_AI.MEMORY_QUERY_TEXT, input.queryText);
  setJson(attrs, GEN_AI.MEMORY_RECORDS, input.records);
  return attrs;
}

export interface GenAiWorkflowInput {
  workflowName?: string;
  promptName?: string;
}

export function genAiWorkflowAttributes(
  input: GenAiWorkflowInput,
): GenAiAttributeMap {
  const attrs: GenAiAttributeMap = {};
  set(attrs, GEN_AI.WORKFLOW_NAME, input.workflowName);
  set(attrs, GEN_AI.PROMPT_NAME, input.promptName);
  return attrs;
}
