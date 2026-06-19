/**
 * `createGenAiObserver` — turn a stream of GenAI lifecycle events into a
 * canonical `gen_ai.*` span tree.
 *
 * A complement to {@link traceGenAI}: where the wrapper instruments code you
 * own, the observer instruments a framework that emits its own event stream.
 * Subscribe it once and feed every event through it; it reconstructs the span
 * hierarchy, estimates cost, force-closes abandoned children, and keeps
 * sensitive content off spans unless you opt in.
 *
 * Scope: this adapter records span attributes only. It deliberately does not
 * emit the `gen_ai.*` log events (`inference.operation.details`,
 * `operation.exception`) that `recordInferenceDetails` provides — the source
 * event stream already carries that detail.
 *
 * @example
 * ```ts
 * const observe = createGenAiObserver();
 * observe({ type: 'agent.start', id: 'a1', agent: { name: 'planner' } });
 * observe({ type: 'chat.start', id: 'c1', parentId: 'a1',
 *           request: { provider: 'openai', model: 'gpt-4o' } });
 * observe({ type: 'chat.end', id: 'c1',
 *           usage: { inputTokens: 412, outputTokens: 87 } });
 * observe({ type: 'agent.end', id: 'a1' });
 * ```
 */

import {
  context as otelContext,
  SpanKind,
  SpanStatusCode,
  trace as otelTrace,
  type Context,
  type Span,
  type SpanOptions,
} from '@opentelemetry/api';
import {
  genAiAgentAttributes,
  genAiRequestAttributes,
  genAiResponseAttributes,
  genAiToolAttributes,
  genAiUsageAttributes,
  genAiWorkflowAttributes,
  type GenAiAttributeMap,
} from '../attributes.js';
import { estimateLLMCost } from '../cost.js';
import { setGenAiContent, type GenAiContentSink } from '../events.js';
import { GEN_AI, GEN_AI_OPERATION, genAiSpanName } from '../semconv.js';
import { SpanRegistry } from './span-registry.js';
import type {
  ChatEndEvent,
  ChatStartEvent,
  GenAiObserver,
  GenAiObserverEvent,
  GenAiObserverOptions,
  SpanEnd,
  ToolEndEvent,
  ToolStartEvent,
} from './types.js';

const ORPHAN_MESSAGE =
  'Parent ended before this span received its terminal event.';

/** The `*.start` half of the event union — the events that open a span. */
type StartEvent = Extract<GenAiObserverEvent, { type: `${string}.start` }>;

export function createGenAiObserver(
  options: GenAiObserverOptions = {},
): GenAiObserver {
  const tracer =
    options.tracer ?? otelTrace.getTracer('autotel-genai/observer');
  const registry = new SpanRegistry();

  /** Parent context: a tracked parent span, else the resolver, else root. */
  function parentContext(event: StartEvent): Context | undefined {
    const parentSpan = event.parentId
      ? registry.spanFor(event.parentId)
      : undefined;
    if (parentSpan) return otelTrace.setSpan(otelContext.active(), parentSpan);
    return options.resolveParentContext?.(event);
  }

  /** Start a span, register it under its parent, and return it. */
  function start(
    event: StartEvent,
    name: string,
    kind: SpanKind,
    attributes: GenAiAttributeMap,
  ): Span {
    const parent = parentContext(event);
    const spanOptions: SpanOptions = {
      kind,
      attributes,
      startTime: event.startTime,
      links: event.links,
      root: parent === undefined,
    };
    const span = tracer.startSpan(name, spanOptions, parent);
    registry.add(event.id, span, event.parentId);
    return span;
  }

  /**
   * Close the span for `event.id`: first force-close any descendant whose
   * terminal event never arrived, then decorate, set status, and end.
   */
  function end(event: SpanEnd, decorate?: (span: Span) => void): void {
    const span = registry.take(event.id);
    if (!span) return;
    registry.reapDescendants(event.id, ORPHAN_MESSAGE, event.endTime);
    decorate?.(span);
    if (event.error !== undefined) {
      const message = errorMessage(event.error);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      // The SDK normalizes a string or Error; hand it the original Error when
      // we have one, otherwise the message we already derived.
      span.recordException(
        event.error instanceof Error ? event.error : (message ?? 'error'),
      );
    }
    span.end(event.endTime);
  }

  /** Run the privacy gate; without it, content is always omitted. */
  function approvedContent(
    event: GenAiObserverEvent,
  ): GenAiObserverEvent | undefined {
    if (!options.exportContent) return undefined;
    try {
      return options.exportContent({ ...event });
    } catch (error) {
      console.error('[autotel-genai:observer] exportContent failed:', error);
      return undefined;
    }
  }

  function applyChatStart(span: Span, event: ChatStartEvent): void {
    const content = approvedContent(event);
    if (content?.type !== 'chat.start') return;
    setGenAiContent(spanSink(span), {
      inputMessages: content.inputMessages,
      systemInstructions: content.systemInstructions,
    });
  }

  function applyChatEnd(span: Span, event: ChatEndEvent): void {
    if (event.response) {
      span.setAttributes(genAiResponseAttributes(event.response));
    }
    if (event.usage) {
      const costModel = event.costModel ?? event.response?.model;
      const costUsd = costModel
        ? estimateLLMCost(costModel, event.usage)
        : undefined;
      span.setAttributes(genAiUsageAttributes({ ...event.usage, costUsd }));
    }
    const content = approvedContent(event);
    if (content?.type === 'chat.end') {
      setGenAiContent(spanSink(span), {
        outputMessages: content.outputMessages,
      });
    }
  }

  function applyToolStart(span: Span, event: ToolStartEvent): void {
    const content = approvedContent(event);
    if (content?.type !== 'tool.start') return;
    span.setAttributes(
      genAiToolAttributes({ callArguments: content.callArguments }),
    );
  }

  function applyToolEnd(span: Span, event: ToolEndEvent): void {
    const content = approvedContent(event);
    if (content?.type !== 'tool.end') return;
    span.setAttributes(genAiToolAttributes({ callResult: content.callResult }));
  }

  return (event: GenAiObserverEvent): void => {
    switch (event.type) {
      case 'workflow.start': {
        start(
          event,
          genAiSpanName(
            GEN_AI_OPERATION.INVOKE_WORKFLOW,
            event.workflow.workflowName,
          ),
          SpanKind.INTERNAL,
          {
            [GEN_AI.OPERATION_NAME]: GEN_AI_OPERATION.INVOKE_WORKFLOW,
            ...genAiWorkflowAttributes(event.workflow),
          },
        );
        return;
      }
      case 'agent.start': {
        const internal = !event.remote;
        start(
          event,
          genAiSpanName(GEN_AI_OPERATION.INVOKE_AGENT, event.agent.name),
          internal ? SpanKind.INTERNAL : SpanKind.CLIENT,
          {
            [GEN_AI.OPERATION_NAME]: GEN_AI_OPERATION.INVOKE_AGENT,
            ...(event.provider
              ? { [GEN_AI.PROVIDER_NAME]: event.provider }
              : {}),
            ...genAiAgentAttributes(event.agent, { internal }),
          },
        );
        return;
      }
      case 'chat.start': {
        const operation = event.request.operation ?? GEN_AI_OPERATION.CHAT;
        const span = start(
          event,
          genAiSpanName(operation, event.request.model),
          SpanKind.CLIENT,
          genAiRequestAttributes({ ...event.request, operation }),
        );
        applyChatStart(span, event);
        return;
      }
      case 'tool.start': {
        const span = start(
          event,
          genAiSpanName(GEN_AI_OPERATION.EXECUTE_TOOL, event.tool.name),
          SpanKind.INTERNAL,
          {
            [GEN_AI.OPERATION_NAME]: GEN_AI_OPERATION.EXECUTE_TOOL,
            ...genAiToolAttributes(event.tool),
          },
        );
        applyToolStart(span, event);
        return;
      }
      case 'workflow.end':
      case 'agent.end': {
        end(event);
        return;
      }
      case 'chat.end': {
        end(event, (span) => applyChatEnd(span, event));
        return;
      }
      case 'tool.end': {
        end(event, (span) => applyToolEnd(span, event));
        return;
      }
      default: {
        const unexpected: never = event;
        void unexpected;
      }
    }
  };
}

/** A {@link GenAiContentSink} backed by a raw span (only `setAttributes` is used). */
function spanSink(span: Span): GenAiContentSink {
  return {
    setAttributes: (attrs) => {
      span.setAttributes(attrs);
    },
    track: () => {},
  };
}

function errorMessage(error: unknown): string | undefined {
  if (error === undefined) return undefined;
  if (typeof error === 'string') return error || undefined;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
