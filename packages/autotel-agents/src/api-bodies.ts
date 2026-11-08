/**
 * Facts from the raw request and response bodies Claude Code exports with
 * `OTEL_LOG_RAW_API_BODIES=1`: the Anthropic Messages API JSON, as a string
 * attribute named `body`.
 *
 * The response body is small and complete. The request body is cut at 60 KB,
 * so a request past that yields its size and nothing else.
 */

import { bool, num, str } from './attrs';
import type {
  AgentEvent,
  Attributes,
  AttrValue,
  RequestContents,
} from './types';

/** A parsed JSON object, read field by field through the attribute coercers. */
type JsonObject = Attributes;

function parseObject(text: string | undefined): JsonObject | undefined {
  if (!text) return undefined;
  try {
    return asObject(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function asObject(value: AttrValue | undefined): JsonObject | undefined {
  return value instanceof Object && !Array.isArray(value) ? value : undefined;
}

function list(value: AttrValue | undefined): AttrValue[] {
  return Array.isArray(value) ? value : [];
}

/** Request-body facts: the size always, the shape when the body is whole. */
export function readRequestBody(
  attrs: Attributes,
): Pick<AgentEvent, 'requestBytes' | 'request'> {
  const requestBytes = num(attrs, 'body_length');
  if (bool(attrs, 'body_truncated')) {
    return { requestBytes };
  }
  const body = parseObject(str(attrs, 'body'));
  if (!body) return { requestBytes };
  const request: RequestContents = {
    systemChars: list(body.system).reduce<number>(
      (total, block) =>
        total + (str(asObject(block) ?? {}, 'text')?.length ?? 0),
      0,
    ),
    toolDefinitions: list(body.tools).length,
    messages: list(body.messages).length,
  };
  return { requestBytes, request };
}

/** Response-body facts: why it stopped, what it spent, which tools it called. */
export function readResponseBody(
  attrs: Attributes,
): Pick<
  AgentEvent,
  | 'stopReason'
  | 'thinkingTokens'
  | 'cacheWrite1hTokens'
  | 'cacheWrite5mTokens'
  | 'toolUses'
  | 'serviceTier'
> {
  const body = parseObject(str(attrs, 'body'));
  if (!body) return {};
  const usage = asObject(body.usage) ?? {};
  const cacheCreation = asObject(usage.cache_creation) ?? {};
  const toolUses = list(body.content)
    .map((block) => asObject(block) ?? {})
    .filter((block) => str(block, 'type') === 'tool_use')
    .flatMap((block) => str(block, 'name') ?? []);
  return {
    stopReason: str(body, 'stop_reason'),
    thinkingTokens: num(
      asObject(usage.output_tokens_details) ?? {},
      'thinking_tokens',
    ),
    cacheWrite1hTokens: num(cacheCreation, 'ephemeral_1h_input_tokens'),
    cacheWrite5mTokens: num(cacheCreation, 'ephemeral_5m_input_tokens'),
    toolUses,
    serviceTier: str(usage, 'service_tier'),
  };
}
