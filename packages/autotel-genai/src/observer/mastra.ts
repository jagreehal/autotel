/**
 * Mastra → {@link createGenAiObserver} glue.
 *
 * Mastra's observability pipeline is a real event stream: register an exporter
 * and it receives `span_started` / `span_ended` for every agent run, model
 * generation, tool call, and workflow step, each with `id` / `parentSpanId` —
 * which map directly onto the observer's `id` / `parentId`.
 * {@link createMastraObserver} returns an object shaped like Mastra's
 * `ObservabilityExporter`, so you pass it straight to the `Mastra` constructor.
 *
 * ## Why not `@mastra/otel-exporter`
 *
 * That exporter also emits canonical `gen_ai.*`, but it owns its own span
 * processor and its own endpoint, and it rebuilds spans from Mastra's trace ids
 * after the fact. The result is a second, detached trace: the agent run does not
 * sit under the HTTP request span that triggered it, it never passes through
 * `init({ spanEnrichers })` (so `langfuseCompatibility` never sees it), and it
 * carries no cost.
 *
 * This adapter emits into autotel's tracer instead. Mastra dispatches events
 * synchronously, so the ambient context is still the caller's — the agent run
 * lands inside the span you opened around it, reaches every configured
 * destination, and gets priced.
 *
 * ## What maps
 *
 * | Mastra span type                                                  | Emitted as                    |
 * | ----------------------------------------------------------------- | ----------------------------- |
 * | `agent_run`                                                        | `invoke_agent`                |
 * | `model_generation`                                                 | `chat` (usage + cost)         |
 * | `rag_embedding`                                                    | `embeddings` (usage + cost)   |
 * | `tool_call`, `mcp_tool_call`, `client_tool_call`, `provider_tool_call` | `execute_tool`             |
 * | `workflow_run`, `workflow_step`                                    | `invoke_workflow`             |
 *
 * Everything else — model steps and chunks, processors, scorers, mappings,
 * conditionals — is plumbing; it is skipped, and its children reparent to the
 * nearest kept ancestor. Pass `skipSpan` to drop additional supported spans.
 *
 * `model_step` / `model_inference` are deliberately dropped rather than mapped
 * to their own `chat` spans: their usage is already summed on the enclosing
 * `model_generation`, and emitting both would double-count `gen_ai.usage.*`. A
 * multi-step agentic loop therefore appears as one `chat` span with the run's
 * total tokens.
 *
 * Typed structurally against Mastra's exported span shape so it pulls in no
 * Mastra dependency.
 *
 * @example
 * ```ts
 * import { Mastra } from '@mastra/core/mastra';
 * import { Observability } from '@mastra/observability';
 * import { createGenAiObserver, createMastraObserver } from 'autotel-genai/observer';
 *
 * const observe = createGenAiObserver();
 *
 * export const mastra = new Mastra({
 *   agents: { ragAgent },
 *   observability: new Observability({
 *     configs: {
 *       autotel: {
 *         serviceName: 'support-agent',
 *         exporters: [createMastraObserver(observe)],
 *       },
 *     },
 *   }),
 * });
 * ```
 */

import { normalizeAiSdkProvider } from '../ai-sdk-bridge.js';
import type { TokenUsage } from '../cost.js';
import { GEN_AI_OPERATION } from '../semconv.js';
import type { GenAiToolType } from '../semconv.js';
import type { GenAiObserver } from './types.js';

/** Mastra `UsageStats`. */
interface MastraUsage {
  inputTokens?: number;
  outputTokens?: number;
  inputDetails?: { cacheRead?: number; cacheWrite?: number };
  outputDetails?: { reasoning?: number };
}

/**
 * The union of every Mastra span-attribute field this adapter reads. Mastra
 * types these per span type; flattening them here keeps the adapter dependency
 * free, and every field stays optional because only some types carry it.
 *
 * The span's `attributes` field is declared `unknown` rather than this type:
 * Mastra's own union of per-type attribute interfaces has no member in common
 * with a flattened view, so declaring it would make a real `ExportedSpan`
 * unassignable and force every caller into a cast. `span.type` is the
 * discriminant, and each branch reads only the fields that type carries.
 */
export interface MastraSpanAttributes {
  model?: string;
  provider?: string;
  responseModel?: string;
  responseId?: string;
  finishReason?: string;
  streaming?: boolean;
  completionStartTime?: Date;
  usage?: MastraUsage;
  serverAddress?: string;
  serverPort?: number;
  parameters?: {
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    stopSequences?: string[];
    seed?: number;
  };
  toolDescription?: string;
  toolCallId?: string;
}

/** The subset of Mastra's `ExportedSpan` this adapter reads. */
export interface MastraExportedSpan {
  id: string;
  parentSpanId?: string;
  name: string;
  type: string;
  entityName?: string;
  startTime: Date;
  endTime?: Date;
  isEvent: boolean;
  /** Narrowed to {@link MastraSpanAttributes} per span type — see the note there. */
  attributes?: unknown;
  input?: unknown;
  output?: unknown;
  errorInfo?: { message?: string };
}

/** Read a span's attributes as the flattened view this adapter understands. */
function attributesOf(span: MastraExportedSpan): MastraSpanAttributes {
  return (span.attributes ?? {}) as MastraSpanAttributes;
}

/**
 * What the span is *of* — the agent, tool, or workflow it ran. Mastra's `name`
 * is a display string built around that identity (`tool: 'searchDocuments'`,
 * `mcp_tool: 'search' on 'docs'`), which would land verbatim in
 * `gen_ai.tool.name`; `entityName` is the identity itself.
 */
function identityOf(span: MastraExportedSpan): string {
  return span.entityName ?? span.name;
}

/** Mastra's `TracingEvent`. */
export interface MastraTracingEvent {
  type: 'span_started' | 'span_updated' | 'span_ended';
  exportedSpan: MastraExportedSpan;
}

/** The subset of Mastra's `ObservabilityExporter` this adapter implements. */
export interface MastraObserverExporter {
  name: string;
  exportTracingEvent(event: MastraTracingEvent): Promise<void>;
  flush(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface MastraObserverOptions {
  /** Exporter name Mastra logs against. Defaults to `autotel`. */
  name?: string;
  /**
   * Drop an additional supported Mastra span from the emitted tree. Unsupported
   * plumbing spans are always dropped because this adapter has no canonical
   * mapping for them. Children of every dropped span reparent to the nearest
   * kept ancestor.
   */
  skipSpan?: (span: MastraExportedSpan) => boolean;
}

/** Mastra `SpanType` values this adapter understands. */
const MASTRA_SPAN = {
  AGENT_RUN: 'agent_run',
  MODEL_GENERATION: 'model_generation',
  RAG_EMBEDDING: 'rag_embedding',
  TOOL_CALL: 'tool_call',
  MCP_TOOL_CALL: 'mcp_tool_call',
  CLIENT_TOOL_CALL: 'client_tool_call',
  PROVIDER_TOOL_CALL: 'provider_tool_call',
  WORKFLOW_RUN: 'workflow_run',
  WORKFLOW_STEP: 'workflow_step',
} as const;

type MastraSpanType = (typeof MASTRA_SPAN)[keyof typeof MASTRA_SPAN];

/**
 * The two lookup tables below spell their keys out instead of computing them
 * from {@link MASTRA_SPAN}, and use an object rather than a `Set`.
 *
 * Both forms a bundler can drop: a plain object literal is inert, while a
 * computed key or a `new Set(...)` call is something it must assume can throw,
 * so it survives even when nothing references it. That difference is the whole
 * cost of this file to an app that imports a sibling of this module and never
 * calls `createMastraObserver` — around 200 bytes gzipped, or nothing.
 *
 * `Record<MastraSpanType, …>` is what keeps the spelled-out keys honest: a typo
 * or a missing span type fails to compile.
 */
const KEPT: Record<MastraSpanType, true> = {
  agent_run: true,
  model_generation: true,
  rag_embedding: true,
  tool_call: true,
  mcp_tool_call: true,
  client_tool_call: true,
  provider_tool_call: true,
  workflow_run: true,
  workflow_step: true,
};

/**
 * Tool-call span types → the canonical `gen_ai.tool.type` they represent.
 *
 * `satisfies` rather than `GEN_AI_TOOL_TYPE.*` for the same reason: a property
 * access is a member expression, which a bundler must assume can throw, so it
 * pins the table in place. The type still checks every value against the
 * canonical union, so an invented tool type fails to compile.
 */
const TOOL_TYPES = {
  tool_call: 'function',
  client_tool_call: 'function',
  mcp_tool_call: 'extension',
  provider_tool_call: 'extension',
} satisfies Partial<Record<MastraSpanType, GenAiToolType>>;

export function createMastraObserver(
  observe: GenAiObserver,
  options: MastraObserverOptions = {},
): MastraObserverExporter {
  const shouldSkip = (span: MastraExportedSpan): boolean =>
    KEPT[span.type as MastraSpanType] !== true ||
    options.skipSpan?.(span) === true;
  // Skipped spans record the kept ancestor their children should parent to.
  const reparented = new Map<string, string | undefined>();
  // Spans we have already opened, so an end event for a span whose start never
  // arrived still produces a span rather than vanishing.
  const open = new Set<string>();

  /** The span id a child of `spanId` should use as its parent. */
  function keptParent(spanId: string | undefined): string | undefined {
    if (spanId === undefined) return undefined;
    return reparented.has(spanId) ? reparented.get(spanId) : spanId;
  }

  function start(span: MastraExportedSpan): void {
    const parentId = keptParent(span.parentSpanId);
    if (shouldSkip(span)) {
      reparented.set(span.id, parentId);
      return;
    }
    open.add(span.id);
    const attributes = attributesOf(span);

    switch (span.type) {
      case MASTRA_SPAN.AGENT_RUN: {
        observe({
          type: 'agent.start',
          id: span.id,
          parentId,
          startTime: span.startTime,
          agent: { name: identityOf(span) },
        });
        return;
      }
      case MASTRA_SPAN.WORKFLOW_RUN:
      case MASTRA_SPAN.WORKFLOW_STEP: {
        observe({
          type: 'workflow.start',
          id: span.id,
          parentId,
          startTime: span.startTime,
          workflow: { workflowName: identityOf(span) },
        });
        return;
      }
      case MASTRA_SPAN.MODEL_GENERATION:
      case MASTRA_SPAN.RAG_EMBEDDING: {
        const embeddings = span.type === MASTRA_SPAN.RAG_EMBEDDING;
        observe({
          type: 'chat.start',
          id: span.id,
          parentId,
          startTime: span.startTime,
          request: {
            operation: embeddings
              ? GEN_AI_OPERATION.EMBEDDINGS
              : GEN_AI_OPERATION.CHAT,
            provider: attributes.provider
              ? normalizeAiSdkProvider(attributes.provider)
              : undefined,
            model: attributes.model,
            stream: attributes.streaming,
            serverAddress: attributes.serverAddress,
            serverPort: attributes.serverPort,
            maxTokens: attributes.parameters?.maxOutputTokens,
            temperature: attributes.parameters?.temperature,
            topP: attributes.parameters?.topP,
            topK: attributes.parameters?.topK,
            frequencyPenalty: attributes.parameters?.frequencyPenalty,
            presencePenalty: attributes.parameters?.presencePenalty,
            stopSequences: attributes.parameters?.stopSequences,
            seed: attributes.parameters?.seed,
          },
          inputMessages: asContent(span.input),
        });
        return;
      }
      default: {
        observe({
          type: 'tool.start',
          id: span.id,
          parentId,
          startTime: span.startTime,
          tool: {
            name: identityOf(span),
            type: TOOL_TYPES[span.type as keyof typeof TOOL_TYPES],
            description: attributes.toolDescription,
            callId: attributes.toolCallId,
          },
          callArguments: span.input,
        });
      }
    }
  }

  function end(span: MastraExportedSpan): void {
    if (reparented.delete(span.id)) return;
    if (!open.delete(span.id)) return;
    const attributes = attributesOf(span);
    const error = span.errorInfo
      ? (span.errorInfo.message ?? span.errorInfo)
      : undefined;
    const endTime = span.endTime ?? span.startTime;

    switch (span.type) {
      case MASTRA_SPAN.AGENT_RUN: {
        observe({ type: 'agent.end', id: span.id, endTime, error });
        return;
      }
      case MASTRA_SPAN.WORKFLOW_RUN:
      case MASTRA_SPAN.WORKFLOW_STEP: {
        observe({ type: 'workflow.end', id: span.id, endTime, error });
        return;
      }
      case MASTRA_SPAN.MODEL_GENERATION:
      case MASTRA_SPAN.RAG_EMBEDDING: {
        observe({
          type: 'chat.end',
          id: span.id,
          endTime,
          error,
          response: {
            model: attributes.responseModel,
            id: attributes.responseId,
            finishReasons: attributes.finishReason
              ? [attributes.finishReason]
              : undefined,
            timeToFirstChunk: timeToFirstChunk(span),
          },
          usage: mastraUsage(attributes.usage),
          costModel: attributes.responseModel ?? attributes.model,
          outputMessages: asContent(span.output),
        });
        return;
      }
      default: {
        observe({
          type: 'tool.end',
          id: span.id,
          endTime,
          error,
          callResult: span.output,
        });
      }
    }
  }

  return {
    name: options.name ?? 'autotel',

    async exportTracingEvent(event: MastraTracingEvent): Promise<void> {
      const span = event.exportedSpan;
      // An event span occurs at a point in time: Mastra emits it once, as an
      // end event, so open and close it together.
      if (span.isEvent) {
        if (event.type !== 'span_updated') {
          start(span);
          end(span);
        }
        return;
      }
      if (event.type === 'span_started') start(span);
      // A span whose start we never saw still gets one, so nothing is lost.
      else if (event.type === 'span_ended') {
        if (!open.has(span.id) && !reparented.has(span.id)) start(span);
        end(span);
      }
    },

    async flush(): Promise<void> {},
    async shutdown(): Promise<void> {},
  };
}

/**
 * Seconds between the span starting and the first completion chunk. Mastra
 * records the absolute instant; the spec attribute is a duration.
 */
function timeToFirstChunk(span: MastraExportedSpan): number | undefined {
  const completionStart = attributesOf(span).completionStartTime;
  if (!(completionStart instanceof Date)) return undefined;
  const seconds = (completionStart.getTime() - span.startTime.getTime()) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function mastraUsage(usage: MastraUsage | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  const { inputTokens, outputTokens, inputDetails, outputDetails } = usage;
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return {
    inputTokens,
    outputTokens,
    reasoningOutputTokens: outputDetails?.reasoning,
    cacheReadInputTokens: inputDetails?.cacheRead,
    cacheCreationInputTokens: inputDetails?.cacheWrite,
  };
}

/**
 * Mastra's `input`/`output` are free-form. Hand the observer a string rather
 * than claiming a shape it does not have — it stays behind `exportContent`
 * either way.
 */
function asContent(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value || undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
