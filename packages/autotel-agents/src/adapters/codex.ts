/**
 * Codex: events prefixed `codex.*`, keyed by `conversation.id`. Unlike opencode
 * it does not mirror Claude Code's contract, so it gets its own adapter.
 * Contract: https://github.com/openai/codex/blob/main/docs/config.md#otel
 *
 * - **Requests.** `codex.api_request` (or `codex.websocket_request`) is one
 *   transport attempt and carries no tokens; it only counts when it failed.
 *   The usage arrives on the stream's `codex.sse_event` (or
 *   `codex.websocket_event`) whose `event.kind` is `response.completed`, so
 *   that event is the request. A failed stream message is an error; every
 *   other one is a delta and is dropped: one per token would bury the timeline.
 * - **Tokens.** OpenAI counts cached input inside `input_token_count` and
 *   reasoning inside `output_token_count`. The model here keeps cache reads
 *   separate (Claude's shape), so cached is subtracted from input; output is
 *   left whole.
 * - **Cost.** Codex reports none, and the fallback table prices no OpenAI
 *   model, so `costUsd` stays unset: unknown, not zero.
 * - **Metrics.** Codex's token histograms carry no conversation or turn id, so
 *   nothing can attribute them to a session. They are recognised and dropped.
 */

import { bool, num, str } from '../attrs';
import { mergeAttrs } from '../identity';
import type {
  AgentEvent,
  AgentEventType,
  AgentRawEvent,
  ToolDecision,
} from '../types';
import { buildToolRef } from './prefix-adapter';
import type { AgentAdapter } from './types';

const PREFIX = 'codex.';

const isCodex = (name: string, resource: AgentRawEvent['resource']): boolean =>
  name.startsWith(PREFIX) ||
  (str(resource, 'service.name')?.includes('codex') ?? false);

/** Codex's approval outcomes, collapsed to accept/reject. */
function decisionOf(value: string | undefined): ToolDecision | undefined {
  if (value === 'approved' || value === 'approved_for_session') return 'accept';
  if (value === 'denied' || value === 'abort') return 'reject';
  return undefined;
}

const failedMessage = (attrs: AgentRawEvent['attributes']): boolean =>
  bool(attrs, 'success') === false || str(attrs, 'error.message') !== undefined;

function typeOf(
  name: string,
  attrs: AgentRawEvent['attributes'],
): AgentEventType | null {
  switch (name) {
    // The response stream arrives over SSE or a WebSocket; same message kinds.
    case 'sse_event':
    case 'websocket_event': {
      const kind = str(attrs, 'event.kind', 'kind');
      if (kind === 'response.completed') return 'api_request';
      if (kind === 'response.failed' || failedMessage(attrs))
        return 'api_error';
      return null;
    }
    case 'api_request':
    case 'websocket_request': {
      const status = num(attrs, 'http.response.status_code');
      const failed =
        failedMessage(attrs) || (status !== undefined && status >= 400);
      return failed ? 'api_error' : null;
    }
    case 'user_prompt': {
      return 'user_prompt';
    }
    case 'tool_decision': {
      return 'tool_decision';
    }
    case 'tool_result': {
      return 'tool_result';
    }
    default: {
      return 'other';
    }
  }
}

export const codexAdapter: AgentAdapter = {
  kind: 'codex',

  matchesMetric: (record) => isCodex(record.name, record.resource),
  matchesEvent: (record) => isCodex(record.eventName, record.resource),

  normalizeEvent(record) {
    const attrs = mergeAttrs(record.resource, record.attributes);
    const sessionId = str(attrs, 'conversation.id', 'thread.id', 'session.id');
    if (!sessionId) return null;
    const rawName = record.eventName.startsWith(PREFIX)
      ? record.eventName.slice(PREFIX.length)
      : record.eventName;
    const type = typeOf(rawName, attrs);
    if (type === null) return null;

    const event: AgentEvent = {
      id: `${sessionId}:0`,
      sessionId,
      agent: 'codex',
      type,
      rawEventName: rawName,
      timestamp: record.timestamp,
      model: str(attrs, 'model', 'slug'),
      promptId: str(attrs, 'turn.id', 'turn_id'),
      attributes: record.attributes,
    };

    switch (type) {
      case 'api_request': {
        const input = num(attrs, 'input_token_count', 'input_tokens');
        const cached = num(
          attrs,
          'cached_token_count',
          'cached_input_token_count',
          'cached_input_tokens',
        );
        event.inputTokens =
          input === undefined ? undefined : Math.max(0, input - (cached ?? 0));
        event.cacheReadTokens = cached;
        event.outputTokens = num(attrs, 'output_token_count', 'output_tokens');
        event.durationMs = num(attrs, 'duration_ms');
        event.effort = str(attrs, 'reasoning_effort', 'effort');
        break;
      }
      case 'api_error': {
        event.errorMessage = str(attrs, 'error.message', 'error');
        event.statusCode = num(attrs, 'http.response.status_code');
        event.durationMs = num(attrs, 'duration_ms');
        break;
      }
      case 'user_prompt': {
        event.promptLength = num(attrs, 'prompt_length');
        const text = str(attrs, 'prompt');
        // Codex sends a placeholder unless `log_user_prompt` is on.
        if (text && text !== '[REDACTED]') event.promptText = text;
        break;
      }
      case 'tool_decision': {
        const tool = str(attrs, 'tool_name');
        if (tool) event.tool = buildToolRef(tool, attrs);
        event.decision = decisionOf(str(attrs, 'decision'));
        break;
      }
      case 'tool_result': {
        const tool = str(attrs, 'tool_name');
        if (tool) event.tool = buildToolRef(tool, attrs);
        event.success = bool(attrs, 'success');
        event.durationMs = num(attrs, 'duration_ms');
        break;
      }
      default: {
        break;
      }
    }
    return event;
  },

  normalizeMetric: () => [],
};
