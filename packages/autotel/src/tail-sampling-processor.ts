/**
 * Tail Sampling Span Processor
 *
 * Keeps or drops whole traces, decided once the trace has finished here.
 *
 * "Trace" here means a local root (no parent, or a remote one) and every span
 * started under it. One trace id can hold several: two requests a browser
 * sent under one page trace, or Next.js's `next.bubble` span beside the real
 * `BaseServer.handleRequest`. Each is decided on its own, so a verdict on one
 * never reaches its siblings.
 *
 * How it works:
 * 1. Every span is buffered until its local root has ended and every span
 *    started under it has ended too, or `traceTimeoutMs` passes. Spans that
 *    end after the decision follow it.
 * 2. The trace is kept when any span carries `autotel.sampling.tail.keep =
 *    true`: a `trace()` wrapper kept it (error, slow, baseline) or the code
 *    called `forceKeep()`.
 * 3. Otherwise the sampler decides from what the whole trace did: any span
 *    with ERROR status, the root's duration, the trace id for the baseline.
 *    This is what applies sampling to auto-instrumented roots (HTTP, DB,
 *    queues), which no `trace()` wrapper evaluated.
 *
 * Children follow their trace, so a dropped trace leaves no orphan spans.
 *
 * `spanFilter` drops are applied here too when a FilteringSpanProcessor wraps
 * this one: a filtered local root drops its own tree (not its siblings under
 * the same remote parent), and the children of
 * any other filtered span are re-parented to its nearest kept ancestor.
 *
 * The processor holds spans only when something needs the whole trace: a
 * sampler with `needsTailSampling()`, or a `spanFilter` in front of it.
 * Otherwise it forwards each span as it ends, dropping only a span a
 * `trace()` wrapper's own sampler marked to drop.
 *
 * Fail-open: a trace whose root has not ended by `traceTimeoutMs`, or the
 * oldest trace once `maxBufferedSpans` is exceeded, is exported as it stands.
 * `forceFlush()` leaves traces with running children pending; `shutdown()`
 * decides everything.
 */

import type {
  SpanProcessor,
  ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import {
  SpanStatusCode,
  type Context,
  type SpanContext,
} from '@opentelemetry/api';
import type { Span } from '@opentelemetry/sdk-trace-base';
import {
  AUTOTEL_SAMPLING_TAIL_KEEP,
  AUTOTEL_SAMPLING_TAIL_EVALUATED,
  type Sampler,
} from './sampling';

export interface TailSamplingSpanProcessorOptions {
  /**
   * Decides traces no wrapper kept. Without one, a trace is kept unless a
   * wrapper evaluated it and dropped it.
   */
  sampler?: Sampler;
  /**
   * Spans held across all undecided traces. Past this the oldest trace is
   * exported as it stands (fail-open). Default 20,000.
   */
  maxBufferedSpans?: number;
  /**
   * How long a trace may wait, from its first span, for its root and open
   * children to end. A trace whose root ended is then decided on what it has;
   * one whose root is still open is exported as it stands. Default 30,000.
   */
  traceTimeoutMs?: number;
}

interface PendingTrace {
  spans: ReadableSpan[];
  /** Spans started and not yet ended. */
  open: number;
  /**
   * Span id of the local root this trace is keyed on. Absent for spans no
   * `onStart` keyed, grouped by trace id with any local root as the root.
   */
  rootId?: string;
  root?: ReadableSpan;
  deadline: number;
}

interface Verdict {
  keep: boolean;
  /** Filtered span id → its parent, to re-parent spans that end later. */
  reparent: Map<string, SpanContext | undefined>;
}

/** Verdicts remembered for spans that end after their trace was decided. */
const MAX_DECIDED_TRACES = 10_000;

/** A local trace's key: its trace id and the span id of its local root. */
function traceKey(span: Span): string {
  return spanKey(span.spanContext());
}

function spanKey({ traceId, spanId }: SpanContext): string {
  return `${traceId}:${spanId}`;
}

function isLocalRoot(span: ReadableSpan): boolean {
  const parent = span.parentSpanContext;
  return !parent || parent.isRemote === true;
}

export class TailSamplingSpanProcessor implements SpanProcessor {
  private readonly wrappedProcessor: SpanProcessor;
  private sampler?: Sampler;
  private readonly maxBufferedSpans: number;
  private readonly traceTimeoutMs: number;
  private readonly pending = new Map<string, PendingTrace>();
  private readonly decided = new Map<string, Verdict>();
  /** Span ids a wrapping `spanFilter` rejected, consumed when the span ends. */
  private readonly filtered = new Set<string>();
  /**
   * The local trace each span belongs to, by `traceId:spanId`, read when a
   * child starts and when the span ends. Kept past the span's end, since a
   * child may start after its parent ended, and freed with its trace's
   * verdict.
   */
  private readonly keyOf = new Map<string, string>();
  /** The spans keyed under each local trace, to free them with it. */
  private readonly spansOf = new Map<string, string[]>();
  private buffered = 0;
  private filtering = false;
  private sweeper?: ReturnType<typeof setInterval>;

  constructor(
    wrappedProcessor: SpanProcessor,
    options: TailSamplingSpanProcessorOptions = {},
  ) {
    this.wrappedProcessor = wrappedProcessor;
    this.sampler = options.sampler;
    this.maxBufferedSpans = options.maxBufferedSpans ?? 20_000;
    this.traceTimeoutMs = options.traceTimeoutMs ?? 30_000;
  }

  /** Use `sampler` unless one was passed to the constructor. */
  setDefaultSampler(sampler: Sampler | undefined): void {
    this.sampler ??= sampler;
  }

  /** Called by a FilteringSpanProcessor that wraps this one. */
  enableFiltering(): void {
    this.filtering = true;
  }

  private get buffering(): boolean {
    return this.filtering || this.sampler?.needsTailSampling?.() === true;
  }

  /**
   * Called by a wrapping FilteringSpanProcessor just before it forwards a span
   * its predicate rejected, so the drop can respect the trace's shape.
   */
  markFiltered(spanId: string): void {
    this.filtered.add(spanId);
  }

  onStart(span: Span, parentContext: Context): void {
    this.wrappedProcessor.onStart(span, parentContext);
    if (!this.buffering) return;
    // Read by id, so a parent passed as a bare span context counts. A remote
    // parent, or a local one started before buffering, was never keyed: the
    // span is a local root of its own.
    const parent = span.parentSpanContext;
    const key =
      (parent && !parent.isRemote && this.keyOf.get(spanKey(parent))) ||
      traceKey(span);
    const id = traceKey(span);
    this.keyOf.set(id, key);
    const ids = this.spansOf.get(key);
    if (ids) ids.push(id);
    else this.spansOf.set(key, [id]);
    if (!this.decided.has(key)) this.pendingTrace(key).open++;
  }

  onEnd(span: ReadableSpan): void {
    const { spanId, traceId } = span.spanContext();
    // A span started before buffering was never keyed; group it by trace id.
    const key = this.keyOf.get(`${traceId}:${spanId}`) ?? traceId;
    const verdict = this.decided.get(key);
    if (verdict) {
      this.endLate(span, verdict);
      return;
    }
    if (!this.buffering) {
      const dropped =
        span.attributes[AUTOTEL_SAMPLING_TAIL_EVALUATED] === true &&
        span.attributes[AUTOTEL_SAMPLING_TAIL_KEEP] === false;
      if (!dropped) this.wrappedProcessor.onEnd(span);
      return;
    }

    const trace = this.pendingTrace(key);
    trace.spans.push(span);
    this.buffered++;
    // A span started before this processor existed was never counted.
    trace.open = Math.max(0, trace.open - 1);
    if (trace.rootId ? spanId === trace.rootId : isLocalRoot(span)) {
      trace.root = span;
    }

    if (trace.root && trace.open === 0) {
      this.decide(key, trace);
      return;
    }
    while (this.buffered > this.maxBufferedSpans) {
      const [oldestId, oldest] = this.pending.entries().next().value!;
      this.decide(oldestId, oldest, true);
    }
  }

  /** Sweep expired traces. Exposed for tests; the processor runs it itself. */
  sweep(now = Date.now()): void {
    for (const [key, trace] of this.pending) {
      // Insertion order is creation order, so deadlines ascend.
      if (trace.deadline > now) break;
      this.decide(key, trace, trace.root ? undefined : true);
    }
  }

  private pendingTrace(key: string): PendingTrace {
    let trace = this.pending.get(key);
    if (!trace) {
      trace = {
        spans: [],
        open: 0,
        rootId: key.includes(':') ? key.slice(key.indexOf(':') + 1) : undefined,
        deadline: Date.now() + this.traceTimeoutMs,
      };
      this.pending.set(key, trace);
      this.startSweeper();
    }
    return trace;
  }

  private startSweeper(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(
      () => this.sweep(),
      Math.min(1000, this.traceTimeoutMs),
    );
    this.sweeper.unref?.();
  }

  /** Decide a trace and release its spans. `failOpen` keeps it unjudged. */
  private decide(key: string, trace: PendingTrace, failOpen?: true): void {
    this.pending.delete(key);
    this.buffered -= trace.spans.length;

    const reparent = new Map<string, SpanContext | undefined>();
    for (const span of trace.spans) {
      const { spanId } = span.spanContext();
      if (this.filtered.delete(spanId)) {
        reparent.set(spanId, span.parentSpanContext);
      }
    }
    const root = trace.root;
    // A filtered root says the request itself is noise: drop all of it.
    const keep =
      failOpen ??
      (root !== undefined &&
        !reparent.has(root.spanContext().spanId) &&
        this.keepTrace(root, trace.spans));

    this.decided.set(key, { keep, reparent });
    if (this.decided.size > MAX_DECIDED_TRACES) {
      const evicted = this.decided.keys().next().value!;
      this.decided.delete(evicted);
      for (const id of this.spansOf.get(evicted) ?? []) this.keyOf.delete(id);
      this.spansOf.delete(evicted);
    }
    if (!keep) return;
    for (const span of trace.spans) {
      if (!reparent.has(span.spanContext().spanId)) {
        this.wrappedProcessor.onEnd(reparented(span, reparent));
      }
    }
  }

  private endLate(span: ReadableSpan, verdict: Verdict): void {
    const { spanId } = span.spanContext();
    if (this.filtered.delete(spanId)) {
      verdict.reparent.set(spanId, span.parentSpanContext);
      return;
    }
    if (verdict.keep) {
      this.wrappedProcessor.onEnd(reparented(span, verdict.reparent));
    }
  }

  private keepTrace(root: ReadableSpan, spans: ReadableSpan[]): boolean {
    const verdicts = new Set(
      spans
        .filter((s) => s.attributes[AUTOTEL_SAMPLING_TAIL_EVALUATED] === true)
        .map((s) => s.attributes[AUTOTEL_SAMPLING_TAIL_KEEP]),
    );
    if (verdicts.has(true)) return true;

    const failed = spans.find((s) => s.status.code === SpanStatusCode.ERROR);
    const rootDropped =
      root.attributes[AUTOTEL_SAMPLING_TAIL_EVALUATED] === true &&
      root.attributes[AUTOTEL_SAMPLING_TAIL_KEEP] === false;
    // The root's wrapper already weighed a clean trace; only a failure it
    // could not see (a child error it swallowed) reopens the question.
    if (!this.sampler?.shouldKeepTrace || (rootDropped && !failed)) {
      return !verdicts.has(false);
    }

    const [seconds, nanos] = root.duration;
    return this.sampler.shouldKeepTrace(
      {
        operationName: root.name,
        args: [],
        links: root.links,
        traceId: root.spanContext().traceId,
      },
      {
        success: !failed,
        duration: seconds * 1000 + nanos / 1e6,
        error: failed
          ? new Error(failed.status.message ?? failed.name)
          : undefined,
      },
    );
  }

  /**
   * Flushes decided spans only. A trace still waiting on running children
   * stays pending: deciding it now would miss a late error or `forceKeep()`,
   * and the wrapper flushes on every root end under `forceFlushOnShutdown`.
   */
  forceFlush(): Promise<void> {
    return this.wrappedProcessor.forceFlush();
  }

  shutdown(): Promise<void> {
    // Nothing more will end. Decide what has a root on what it has, and
    // export the rest (no root ever ended) rather than lose it.
    for (const [key, trace] of this.pending) {
      this.decide(key, trace, trace.root ? undefined : true);
    }
    clearInterval(this.sweeper);
    this.sweeper = undefined;
    this.decided.clear();
    this.filtered.clear();
    this.keyOf.clear();
    this.spansOf.clear();
    return this.wrappedProcessor.shutdown();
  }
}

/** `span` with its parent moved past any filtered ancestors. */
function reparented(
  span: ReadableSpan,
  reparent: Map<string, SpanContext | undefined>,
): ReadableSpan {
  let parent = span.parentSpanContext;
  if (!parent || !reparent.has(parent.spanId)) return span;
  while (parent && reparent.has(parent.spanId)) {
    parent = reparent.get(parent.spanId);
  }
  // The span is read-only; shadow its parent rather than copy it.
  return Object.create(span, {
    parentSpanContext: { value: parent, enumerable: true },
  }) as ReadableSpan;
}

/**
 * Every TailSamplingSpanProcessor inside `value`, however the caller wrapped
 * it (FilteringSpanProcessor, a redactor, an array). Reads enumerable fields,
 * so a wrapper that keeps its inner processor in a `#private` field hides it.
 */
export function findTailSamplingProcessors(
  value: unknown,
  depth = 0,
  seen = new Set<object>(),
): TailSamplingSpanProcessor[] {
  if (value instanceof TailSamplingSpanProcessor) return [value];
  if (depth > 4 || typeof value !== 'object' || value === null) return [];
  if (seen.has(value)) return [];
  seen.add(value);
  return Object.values(value).flatMap((child) =>
    findTailSamplingProcessors(child, depth + 1, seen),
  );
}
