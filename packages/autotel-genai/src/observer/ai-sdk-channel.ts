/**
 * `subscribeAiTelemetry` — the zero-config Vercel AI SDK path.
 *
 * Instead of `registerTelemetry(autotelTelemetry())`, subscribe to the AI SDK's
 * `ai:telemetry` Node [tracing channel](https://nodejs.org/api/diagnostics_channel.html).
 * The SDK publishes an operation span per `generateText` / `streamText` /
 * `languageModelCall` / `executeTool` / `embed` as long as the channel has a
 * subscriber — no registration call, and it binds async context across provider
 * calls and tool executions:
 *
 * ```ts
 * import { subscribeAiTelemetry } from 'autotel-genai/observer';
 *
 * const unsubscribe = subscribeAiTelemetry(); // once, at startup
 * ```
 *
 * Fidelity note: the channel exposes coarser data than the registered
 * {@link autotelTelemetry} integration. You get the canonical
 * `invoke_agent › chat › execute_tool` tree with token usage and cost (read
 * from each operation's result), but **not** the per-call streaming timing
 * (`time_to_first_chunk` etc.) that only the lifecycle `onLanguageModelCallEnd`
 * event carries. Prefer `registerTelemetry(autotelTelemetry())` when you can;
 * use this when you cannot add a registration call.
 *
 * No-ops (returning an unsubscribe that does nothing) on runtimes without Node
 * diagnostics-channel support, so it is safe to call unconditionally.
 */

import type { Context, Tracer } from '@opentelemetry/api';
import { subscribeTracingChannel } from 'autotel/diagnostics';
import { GEN_AI_OPERATION, GEN_AI_TOOL_TYPE } from '../semconv.js';
import {
  contentToGenAiMessage,
  promptToGenAiMessages,
  type ContentPartView,
  type ModelMessageView,
} from './ai-sdk-messages.js';
import {
  normalizeProvider,
  toChatRequest,
  toTokenUsage,
  type AiSdkUsageShape,
} from './ai-sdk-shapes.js';
import { createGenAiObserver } from './observer.js';
import type { GenAiObserver, GenAiObserverEvent } from './types.js';

const AI_SDK_TELEMETRY_TRACING_CHANNEL = 'ai:telemetry';
const AI_SDK_AGENT_NAME = 'ai-sdk';

/** A published tracing-channel message: `{ type, event }` plus the settled result. */
interface ChannelMessage {
  type?: string;
  event?: ChannelEvent;
  result?: unknown;
  error?: unknown;
}

interface ChannelEvent {
  callId?: string;
  provider?: string;
  modelId?: string;
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
  seed?: number;
  toolCall?: { toolCallId?: string; toolName?: string; input?: unknown };
  messages?: readonly ModelMessageView[];
  recordInputs?: boolean;
  recordOutputs?: boolean;
}

export interface SubscribeAiTelemetryOptions {
  /** Tracer to emit spans on. Defaults to the global observer tracer. */
  tracer?: Tracer;
  /**
   * Capture prompt/response content and tool arguments/results. Off by default.
   * @see {@link import('./ai-sdk-telemetry.js').AutotelTelemetryOptions.captureContent}
   */
  captureContent?: boolean;
  /** Privacy gate for captured content (redact or drop per event). */
  exportContent?: (event: GenAiObserverEvent) => GenAiObserverEvent | undefined;
  /** Resolve an OTel parent context for otherwise-root operations. */
  resolveParentContext?: (event: GenAiObserverEvent) => Context | undefined;
}

/**
 * Subscribe to the `ai:telemetry` tracing channel and emit canonical `gen_ai.*`
 * spans. Returns an unsubscribe function (a no-op on unsupported runtimes).
 */
export function subscribeAiTelemetry(
  options: SubscribeAiTelemetryOptions = {},
): () => void {
  const captureContent = options.captureContent ?? false;
  const exportContent =
    options.exportContent ??
    (captureContent ? (event: GenAiObserverEvent) => event : undefined);

  const observe: GenAiObserver = createGenAiObserver({
    tracer: options.tracer,
    exportContent,
    resolveParentContext: options.resolveParentContext,
  });

  // Pair each `start` with its `asyncEnd`/`error` by message-object identity,
  // recording the observer span id we assigned at start.
  const ids = new WeakMap<ChannelMessage, string>();
  let seq = 0;

  const handlers = {
    start(message: ChannelMessage) {
      const event = message.event ?? {};
      const callId = event.callId ?? `op:${seq}`;
      switch (message.type) {
        case 'generateText':
        case 'streamText': {
          ids.set(message, callId);
          observe({
            type: 'agent.start',
            id: callId,
            provider: normalizeProvider(event.provider),
            agent: { name: event.modelId ?? AI_SDK_AGENT_NAME },
          });
          return;
        }
        case 'languageModelCall': {
          const id = `${callId}:lm:${seq++}`;
          ids.set(message, id);
          const content =
            captureContent && event.recordInputs !== false
              ? promptToGenAiMessages(event.messages)
              : undefined;
          observe({
            type: 'chat.start',
            id,
            parentId: callId,
            request: toChatRequest(event),
            inputMessages: content?.messages,
            systemInstructions: content?.systemInstructions,
          });
          return;
        }
        case 'executeTool': {
          const id = `${callId}:tool:${event.toolCall?.toolCallId ?? seq++}`;
          ids.set(message, id);
          observe({
            type: 'tool.start',
            id,
            parentId: callId,
            tool: {
              name: event.toolCall?.toolName,
              callId: event.toolCall?.toolCallId,
              type: GEN_AI_TOOL_TYPE.FUNCTION,
            },
            callArguments:
              captureContent && event.recordInputs !== false
                ? event.toolCall?.input
                : undefined,
          });
          return;
        }
        case 'embed': {
          ids.set(message, callId);
          observe({
            type: 'chat.start',
            id: callId,
            request: {
              operation: GEN_AI_OPERATION.EMBEDDINGS,
              provider: normalizeProvider(event.provider),
              model: event.modelId,
            },
          });
          return;
        }
        // 'step' and 'rerank' are intentionally not mapped.
      }
    },

    asyncEnd(message: ChannelMessage) {
      const id = ids.get(message);
      if (id === undefined) return;
      closeSpan(observe, message, id, captureContent);
    },

    error(message: ChannelMessage) {
      const id = ids.get(message);
      if (id === undefined) return;
      // `closeSpan` reads `message.error`; route by type to the right end event.
      closeSpan(observe, message, id, captureContent);
    },
  };

  return subscribeTracingChannel(AI_SDK_TELEMETRY_TRACING_CHANNEL, handlers);
}

function closeSpan(
  observe: GenAiObserver,
  message: ChannelMessage,
  id: string,
  captureContent: boolean,
): void {
  const error = message.error;
  const result = message.result as ResultView | undefined;
  const event = message.event;

  switch (message.type) {
    case 'generateText':
    case 'streamText': {
      observe({ type: 'agent.end', id, error });
      return;
    }
    case 'embed': {
      observe({
        type: 'chat.end',
        id,
        response: { model: event?.modelId },
        usage: toTokenUsage(result?.usage),
        costModel: event?.modelId,
        error,
      });
      return;
    }
    case 'languageModelCall': {
      const outputMessage =
        captureContent && event?.recordOutputs !== false
          ? contentToGenAiMessage(result?.content, result?.finishReason)
          : undefined;
      observe({
        type: 'chat.end',
        id,
        response: {
          model: result?.response?.modelId ?? event?.modelId,
          id: result?.response?.id,
          finishReasons: result?.finishReason ? [result.finishReason] : undefined,
        },
        usage: toTokenUsage(result?.usage),
        costModel: event?.modelId,
        outputMessages: outputMessage ? [outputMessage] : undefined,
        error,
      });
      return;
    }
    case 'executeTool': {
      observe({
        type: 'tool.end',
        id,
        callResult:
          captureContent &&
          event?.recordOutputs !== false &&
          result?.output !== undefined
            ? result.output
            : undefined,
        error,
      });
      return;
    }
  }
}

interface ResultView {
  content?: readonly ContentPartView[];
  finishReason?: string;
  output?: unknown;
  response?: { id?: string; modelId?: string };
  usage?: AiSdkUsageShape;
}

