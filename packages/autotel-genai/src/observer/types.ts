/**
 * Event model for {@link createGenAiObserver} — a stream of start/end lifecycle
 * events that the observer reconstructs into a canonical `gen_ai.*` span tree.
 *
 * Use this when you instrument a framework that emits its own telemetry stream
 * (Vercel AI SDK, agent runtimes, durable workflows) rather than wrapping each
 * call yourself with {@link traceGenAI}. Start and end arrive as separate events
 * correlated by `id`, so the observer can model work that spans async
 * boundaries, queues, or a resumed run.
 */

import type { Context, Link, Span, TimeInput, Tracer } from '@opentelemetry/api';
import type {
  GenAiAgentInput,
  GenAiRequestInput,
  GenAiResponseInput,
  GenAiToolInput,
  GenAiWorkflowInput,
} from '../attributes.js';
import type { TokenUsage } from '../cost.js';
import type { GenAiMessage, GenAiMessagePart } from '../events.js';
import type { GenAiProviderName } from '../semconv.js';
import type {
  AgentInputProvenance,
  AgentMemoryOperation,
  AgentOutputFormat,
} from '../agent/agent-security.js';

/** Tool identity (name/type/description/call id) without the content fields. */
export type GenAiToolIdentity = Omit<
  GenAiToolInput,
  'callArguments' | 'callResult'
>;

/** Fields shared by every `*.start` event. */
export interface SpanStart {
  /** Correlates this start with its `*.end` and names it as a parent. */
  id: string;
  /**
   * Parent entity id. When absent — or when the parent span is no longer open —
   * the observer falls back to {@link GenAiObserverOptions.resolveParentContext}
   * and otherwise starts a root span.
   */
  parentId?: string;
  /** Span start time; defaults to the current clock. */
  startTime?: TimeInput;
  /** Links to other spans, e.g. the interrupted run this one resumes. */
  links?: Link[];
}

/** Fields shared by every `*.end` event. */
export interface SpanEnd {
  /** The `id` of the matching `*.start`. */
  id: string;
  /** Span end time; defaults to the current clock. */
  endTime?: TimeInput;
  /** Error that terminated the operation; sets ERROR status and records it. */
  error?: unknown;
}

/** Start of a workflow (aggregate parent — never carries token usage). */
export interface WorkflowStartEvent extends SpanStart {
  type: 'workflow.start';
  workflow: GenAiWorkflowInput;
}

export interface WorkflowEndEvent extends SpanEnd {
  type: 'workflow.end';
}

/** Start of an agent invocation (aggregate parent — never carries token usage). */
export interface AgentStartEvent extends SpanStart {
  type: 'agent.start';
  agent: GenAiAgentInput;
  provider?: GenAiProviderName;
  /**
   * A remote agent call is a CLIENT span and keeps `gen_ai.agent.id`; an
   * in-process agent is INTERNAL and drops it per spec breaking change #242.
   */
  remote?: boolean;
}

export interface AgentEndEvent extends SpanEnd {
  type: 'agent.end';
}

/** Start of a single model inference call (a leaf — carries token usage). */
export interface ChatStartEvent extends SpanStart {
  type: 'chat.start';
  /** Request-side attributes; `operation` defaults to `chat`. */
  request: GenAiRequestInput;
  /** Opt-in content — written only when `exportContent` returns it. */
  inputMessages?: GenAiMessage[] | string;
  /** Opt-in content — written only when `exportContent` returns it. */
  systemInstructions?: GenAiMessagePart[] | string;
}

export interface ChatEndEvent extends SpanEnd {
  type: 'chat.end';
  response?: GenAiResponseInput;
  /** Leaf token usage → `gen_ai.usage.*` (and estimated `gen_ai.usage.cost.usd`). */
  usage?: TokenUsage;
  /** Model id for cost estimation; defaults to `response.model`. */
  costModel?: string;
  /** Opt-in content — written only when `exportContent` returns it. */
  outputMessages?: GenAiMessage[] | string;
  /**
   * Streaming-performance extensions for this model call. `timeToFirstChunk`
   * belongs on {@link ChatEndEvent.response} (it is the spec attribute); the
   * fields here are the autotel extensions recorded on finish.
   */
  streaming?: ChatStreamTiming;
}

/**
 * Streaming-performance fields written on a `chat.end` span (all seconds /
 * tokens-per-second). All are autotel extensions — see `streaming.ts`.
 */
export interface ChatStreamTiming {
  /** Total response time, seconds → `gen_ai.response.time_to_finish`. */
  timeToFinish?: number;
  /** Throughput → `gen_ai.response.output_tokens_per_second`. */
  outputTokensPerSecond?: number;
  /** Mean inter-chunk gap, seconds → `gen_ai.response.time_per_output_chunk`. */
  timePerOutputChunk?: number;
}

/** Start of a tool execution. */
export interface ToolStartEvent extends SpanStart {
  type: 'tool.start';
  tool: GenAiToolIdentity;
  /** Opt-in content — written only when `exportContent` returns it. */
  callArguments?: unknown;
}

export interface ToolEndEvent extends SpanEnd {
  type: 'tool.end';
  /** Opt-in content — written only when `exportContent` returns it. */
  callResult?: unknown;
}

/** Record a bounded plan-step snapshot on the parent span (no chain-of-thought). */
export interface PlanStepEvent {
  type: 'plan.step';
  parentId: string;
  stepIndex: number;
  toolIntents?: string[];
  policyIds?: string[];
  summary?: string;
}

/** Stamp input provenance on the parent span. */
export interface InputProvenanceEvent {
  type: 'input.provenance';
  parentId: string;
  provenance: AgentInputProvenance;
}

/** Record agent memory access without logging raw content. */
export interface MemoryAccessEvent {
  type: 'memory.access';
  parentId: string;
  operation: AgentMemoryOperation;
  isolationKey: string;
  contentHash?: string;
}

/** Characterize rendered output for XSS/exfil triage (no raw output). */
export interface RenderOutputEvent {
  type: 'render.output';
  parentId: string;
  format?: AgentOutputFormat;
  containsUrl?: boolean;
  urlCount?: number;
}

/** Discriminated union of every event the observer understands. */
export type GenAiObserverEvent =
  | WorkflowStartEvent
  | WorkflowEndEvent
  | AgentStartEvent
  | AgentEndEvent
  | ChatStartEvent
  | ChatEndEvent
  | ToolStartEvent
  | ToolEndEvent
  | PlanStepEvent
  | InputProvenanceEvent
  | MemoryAccessEvent
  | RenderOutputEvent;

/** The subscriber returned by {@link createGenAiObserver}. */
export type GenAiObserver = (event: GenAiObserverEvent) => void;

export interface GenAiObserverOptions {
  /**
   * Tracer to emit spans on. Defaults to the global `autotel-genai/observer`
   * tracer. Pass an application-owned tracer to share one configuration.
   */
  tracer?: Tracer;
  /**
   * Privacy gate for sensitive content. Receives a shallow copy of each
   * content-bearing event; return it (optionally redacted) to export its
   * content, or `undefined` to omit content from that event. When this option
   * is absent, **no** content (messages, tool arguments/results) is ever
   * written to spans — only identifiers, model/provider, usage, and durations.
   */
  exportContent?: (event: GenAiObserverEvent) => GenAiObserverEvent | undefined;
  /**
   * Resolve an OpenTelemetry parent context for an event that has no tracked
   * parent. Return a context to attach the otherwise-root span to an
   * application-owned span (e.g. the incoming request), or `undefined` to keep
   * it a root.
   */
  resolveParentContext?: (event: GenAiObserverEvent) => Context | undefined;
  /**
   * Called with the live {@link Span} immediately after each `*.start` event
   * opens it, keyed by the event `id`. Lets a caller enter the span's context
   * later — e.g. to make provider HTTP calls or a tool's nested `generateText`
   * children of the span — without the observer keeping it active on the
   * ambient context.
   */
  onSpanStart?: (id: string, span: Span) => void;
}
