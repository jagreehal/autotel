/**
 * Reading Prompt API input and output, and encoding it as GenAI messages.
 *
 * The shapes are the ones measured on Canary 159 and declared in `types.ts`.
 * Tool objects keep their fields on the prototype, so `Object.keys()` sees
 * nothing and `JSON.stringify()` renders `{}`: every field is read by name and
 * copied into a plain object before anything is serialised.
 */

import type {
  ContentPart,
  Json,
  LanguageDetection,
  ModelInput,
  ModelOutput,
  PromptMessage,
  StreamChunk,
  ToolCallValue,
  ToolResponseValue,
} from './types';

/** A tool the model asked for. */
export interface ToolCall {
  arguments?: Json;
  /** `callId`, which the response repeats. */
  id: string;
  name: string;
}

/** The page's answer to one call: a result, or a failure. */
export interface ToolResponse {
  error?: string;
  id: string;
  name: string;
  result?: Json;
}

/** A completed turn, split into what it said and what it wants run. */
export interface Turn {
  text: string;
  /**
   * The call resolved to bare text. Only then is an empty `text` a real
   * zero-length answer rather than a turn that had no text to give.
   */
  textOnly: boolean;
  toolCalls: ToolCall[];
}

/** How big an input was, recorded without capturing it. */
export interface InputSize {
  /** Text input: its length. */
  chars?: number;
  /** A conversation: how many messages. */
  parts?: number;
}

/** A primitive string is the text form; every other input is an object. */
const isText = (input: ModelInput): input is string =>
  !(input instanceof Object);

const isMessageList = (
  input: PromptMessage | readonly PromptMessage[],
): input is readonly PromptMessage[] => Array.isArray(input);

/** Content parts carry a `type`; a detection or a vector entry does not. */
const isContentPart = (
  entry: ContentPart | LanguageDetection | number,
): entry is ContentPart => entry instanceof Object && 'type' in entry;

export function inputSize(input: ModelInput): InputSize {
  if (isText(input)) return { chars: input.length };
  if (isMessageList(input)) return { parts: input.length };
  return {};
}

export function readToolCall(value: ToolCallValue): ToolCall | undefined {
  if (!value.name) return undefined;
  const call: ToolCall = { id: value.callId ?? '', name: value.name };
  if (value.arguments !== undefined) call.arguments = value.arguments;
  return call;
}

export function readToolResponse(
  value: ToolResponseValue,
): ToolResponse | undefined {
  if (!value.name) return undefined;
  const response: ToolResponse = { id: value.callId ?? '', name: value.name };
  if (value.errorMessage !== undefined) {
    response.error = value.errorMessage;
    return response;
  }
  // Copied part by part: the platform's objects serialise to `{}`.
  if (value.result) {
    response.result = value.result.map((part) => ({
      type: part.type,
      value: part.value ?? null,
    }));
  }
  return response;
}

/** What one streamed chunk carried. */
export interface ChunkRead {
  call?: ToolCall;
  text?: string;
}

/** A streamed chunk is text, or one whole `tool-call` part. */
export function readChunk(chunk: StreamChunk): ChunkRead {
  if (!(chunk instanceof Object)) return { text: chunk };
  if (chunk.type !== 'tool-call') return {};
  const call = readToolCall(chunk.value);
  return call ? { call } : {};
}

const messagesOf = (input: ModelInput): readonly PromptMessage[] => {
  if (isText(input)) return [{ role: 'user', content: input }];
  return isMessageList(input) ? input : [input];
};

const isPartList = (
  content: string | readonly ContentPart[],
): content is readonly ContentPart[] => Array.isArray(content);

const partsOf = (message: PromptMessage): readonly ContentPart[] =>
  isPartList(message.content)
    ? message.content
    : [{ type: 'text', value: message.content }];

/** Tool responses in an input: the sign a turn answers an earlier one. */
export function toolResponsesIn(input: ModelInput): ToolResponse[] {
  if (isText(input)) return [];
  const responses: ToolResponse[] = [];
  for (const message of messagesOf(input)) {
    for (const part of partsOf(message)) {
      if (part.type !== 'tool-response') continue;
      const response = readToolResponse(part.value);
      if (response) responses.push(response);
    }
  }
  return responses;
}

/**
 * Normalise what a call resolved to. Text comes back as a string; a session
 * with tools answers in content parts, tool calls and plain text alike.
 * Anything else — a language list, a vector, a correction — has no text.
 */
export function readTurn(output: ModelOutput): Turn {
  if (!(output instanceof Object)) {
    return { text: output, textOnly: true, toolCalls: [] };
  }
  const turn: Turn = { text: '', textOnly: false, toolCalls: [] };
  if (!Array.isArray(output)) return turn;
  for (const entry of output) {
    if (!isContentPart(entry)) continue;
    if (entry.type === 'text') turn.text += entry.value ?? entry.content ?? '';
    if (entry.type === 'tool-call') {
      const call = readToolCall(entry.value);
      if (call) turn.toolCalls.push(call);
    }
  }
  return turn;
}

const truncate = (value: string, max: number): string =>
  value.length <= max
    ? value
    : `${value.slice(0, max)}...[${value.length} chars]`;

/** A GenAI message part. Media is recorded by modality, never by value. */
function encodePart(part: ContentPart): Json {
  if (part.type === 'text') {
    return { type: 'text', content: part.value ?? part.content ?? '' };
  }
  if (part.type === 'tool-call') {
    const call = readToolCall(part.value);
    if (call) return toolCallPart(call);
  }
  if (part.type === 'tool-response') {
    const response = readToolResponse(part.value);
    if (response) {
      return response.error === undefined
        ? {
            type: 'tool_call_response',
            id: response.id,
            name: response.name,
            response: response.result ?? null,
          }
        : {
            type: 'tool_call_response',
            id: response.id,
            name: response.name,
            error: response.error,
          };
    }
  }
  return { type: 'redacted', modality: part.type };
}

const toolCallPart = (call: ToolCall): Json => ({
  type: 'tool_call',
  id: call.id,
  name: call.name,
  arguments: call.arguments ?? null,
});

/**
 * Tool payloads come from the model and the page; neither is trusted, and a
 * page can hand over a cycle the types cannot rule out.
 */
const safeJson = (value: Json): string | undefined => {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
};

/** A mutable copy of a JSON value, which trimming edits in place. */
type Draft =
  string | number | boolean | null | Draft[] | { [key: string]: Draft };

/** Copy with every string leaf longer than `cap` cut, keeping the shape. */
function capStrings(value: Json, cap: number): Draft {
  if (typeof value === 'string') return truncate(value, cap);
  if (Array.isArray(value)) return value.map((item) => capStrings(item, cap));
  if (value === null || !(value instanceof Object)) return value;
  const out: { [key: string]: Draft } = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = capStrings(item, cap);
  }
  return out;
}

/** Length of the longest string anywhere in `value`. */
function longestString(value: Json): number {
  if (typeof value === 'string') return value.length;
  if (value === null || !(value instanceof Object)) return 0;
  let longest = 0;
  for (const item of Array.isArray(value) ? value : Object.values(value)) {
    longest = Math.max(longest, longestString(item));
  }
  return longest;
}

/**
 * The longest array anywhere in `value` not yet trimmed, so entries go where
 * the bulk is.
 */
function longestArray(
  value: Draft,
  done: ReadonlySet<Draft[]>,
): Draft[] | undefined {
  let best: Draft[] | undefined;
  const visit = (node: Draft): void => {
    if (Array.isArray(node)) {
      if (!done.has(node) && (!best || node.length > best.length)) best = node;
      node.forEach(visit);
      return;
    }
    if (node !== null && node instanceof Object) {
      Object.values(node).forEach(visit);
    }
  };
  visit(value);
  return best;
}

/**
 * Serialise `value` in at most `max` characters **as valid JSON**.
 *
 * Slicing serialised JSON lands mid-token, and a consumer that cannot parse
 * the attribute drops it whole. So an oversized value shrinks from the inside:
 * long strings are cut first, keeping every message, part and key where it
 * was; only if that is not enough do the longest lists lose trailing entries,
 * each replaced by a marker counting what went. Mirrors autotel-genai's
 * `serializeWithinBudget`, which a browser package cannot import.
 */
export function fitJson(value: Json, max: number): string | undefined {
  const whole = safeJson(value);
  if (whole === undefined || max <= 0 || whole.length <= max) return whole;

  // A cap no string exceeds would copy and re-serialise everything for
  // nothing, so those passes are skipped. Trimming below edits the copy in
  // place, never the caller's value.
  const longest = longestString(value);
  let capped: Draft | undefined;
  for (const cap of [Math.floor(max / 4), Math.floor(max / 16), 16]) {
    const limit = Math.max(cap, 16);
    if (longest <= limit) continue;
    capped = capStrings(value, limit);
    const text = safeJson(capped);
    if (text !== undefined && text.length <= max) return text;
  }
  const draft = capped ?? capStrings(value, Number.POSITIVE_INFINITY);

  // Trailing entries go from the longest list, behind one marker counting what
  // went. A binary search picks how many to keep, so a list costs about
  // log2(n) serialisations on the page's main thread: 20,000 rows take ~20 ms.
  // A list that cannot fit even empty keeps only its marker, and the next
  // longest list is tried; each list is trimmed at most once.
  const trimmed = new Set<Draft[]>();
  for (;;) {
    const list = longestArray(draft, trimmed);
    if (!list || list.length === 0) break;
    trimmed.add(list);
    const original = list.slice();
    const keep = (count: number): string | undefined => {
      list.length = count;
      for (let index = 0; index < count; index += 1) {
        list[index] = original[index] ?? null;
      }
      if (count < original.length) {
        list.push(`...[${original.length - count} more]`);
      }
      const text = safeJson(draft);
      return text !== undefined && text.length <= max ? text : undefined;
    };
    // The whole list did not fit, so the answer is below its length; and an
    // entry costs at least two characters (a value and a comma), so no more
    // than `max / 2` can fit. Starting there keeps each try small.
    let low = 0;
    let high = Math.min(original.length - 1, Math.floor(max / 2));
    let best: string | undefined;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const text = keep(middle);
      if (text === undefined) high = middle - 1;
      else {
        best = text;
        low = middle + 1;
      }
    }
    if (best !== undefined) return best;
    keep(0);
  }
  if (Array.isArray(value)) return '[]';
  return value !== null && value instanceof Object ? '{}' : 'null';
}

/** `gen_ai.input.messages` */
export function encodeInput(
  input: ModelInput,
  max: number,
): string | undefined {
  return fitJson(
    messagesOf(input).map((message) => ({
      role: message.role ?? 'user',
      parts: partsOf(message).map(encodePart),
    })),
    max,
  );
}

/** `gen_ai.output.messages` */
export function encodeOutput(
  turn: Turn,
  finishReason: string,
  max: number,
): string | undefined {
  const parts: Json[] = turn.text ? [{ type: 'text', content: turn.text }] : [];
  for (const call of turn.toolCalls) parts.push(toolCallPart(call));
  return fitJson(
    [{ role: 'assistant', parts, finish_reason: finishReason }],
    max,
  );
}

/** `gen_ai.system_instructions`, from the system messages in `initialPrompts`. */
export function encodeSystemInstructions(
  initialPrompts: readonly PromptMessage[] | undefined,
  max: number,
): string | undefined {
  const parts = (initialPrompts ?? [])
    .filter((message) => message.role === 'system')
    .flatMap((message) => partsOf(message).map(encodePart));
  return parts.length > 0 ? fitJson(parts, max) : undefined;
}

export { safeJson, truncate };
