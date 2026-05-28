import { appendLedgerEntryAsync, flushLedgerWrites, type LedgerOptions } from './ledger.js';
import { PACT_ATTRS } from './attrs.js';
import { LEDGER_ENTRY_SPEC, type InteractionLedgerEntry, type PactKind } from './types.js';

/** Minimal ReadableSpan shape — avoids hard dependency on sdk-trace-base. */
export interface ReadableSpanLike {
  attributes: Record<string, unknown>;
  spanContext(): { traceId: string; spanId: string };
  /** OTel SpanStatus. code 2 = ERROR (see @opentelemetry/api SpanStatusCode). */
  status?: { code: number; message?: string };
}

export interface SpanLike {
  spanContext(): { traceId: string; spanId: string };
}

/** Opaque parent context — matches OTel SpanProcessor without a hard dependency. */
export type OtelContext = unknown;

export interface SpanProcessorLike {
  onStart(span: SpanLike, parentContext: OtelContext): void;
  onEnd(span: ReadableSpanLike): void;
  shutdown(): Promise<void>;
  forceFlush(): Promise<void>;
}

export interface PactLedgerProcessorOptions extends LedgerOptions {
  /** Max queued ledger writes before dropping (default 1024). */
  maxQueueSize?: number;
  onDrop?: (reason: 'queue_full') => void;
  onWriteError?: (error: unknown) => void;
  onWarn?: (message: string) => void;
}

const DEFAULT_MAX_QUEUE = 1024;
const WARN_INTERVAL_MS = 60_000;

type QueueItem = { entry: InteractionLedgerEntry; opts: LedgerOptions };

function attrString(attrs: Record<string, unknown>, key: string): string | undefined {
  const v = attrs[key];
  if (typeof v === 'string' && v.length > 0) return v;
  return undefined;
}

function attrStates(attrs: Record<string, unknown>): string[] {
  const v = attrs[PACT_ATTRS.INTERACTION_STATES];
  if (Array.isArray(v)) {
    return v.filter((s): s is string => typeof s === 'string');
  }
  return [];
}

function ledgerEntryFromSpan(span: ReadableSpanLike): InteractionLedgerEntry | null {
  const attrs = span.attributes;
  const consumer = attrString(attrs, PACT_ATTRS.CONSUMER);
  const provider = attrString(attrs, PACT_ATTRS.PROVIDER);
  const description = attrString(attrs, PACT_ATTRS.INTERACTION_DESCRIPTION);
  const interactionId = attrString(attrs, PACT_ATTRS.INTERACTION_ID);
  if (!consumer || !provider || (!description && !interactionId)) {
    return null;
  }

  const kindRaw = attrString(attrs, PACT_ATTRS.KIND);
  const kind: PactKind = kindRaw === 'http' ? 'http' : 'message';
  const ctx = span.spanContext();
  // SpanStatusCode.ERROR === 2. Treat anything else (UNSET, OK) as passed.
  const errored = span.status?.code === 2;

  const entry: InteractionLedgerEntry = {
    type: 'interaction',
    spec: LEDGER_ENTRY_SPEC,
    consumer,
    provider,
    interaction: description ?? interactionId!,
    interaction_id: interactionId,
    states: attrStates(attrs),
    kind,
    outcome: errored ? 'failed' : 'passed',
    source: 'production',
    role: 'consumer',
    duration_ms: 0,
    observed_at: new Date().toISOString(),
    trace_id: ctx.traceId,
    span_id: ctx.spanId,
    run_id: process.env.AUTOTEL_PACT_RUN_ID,
    git_sha: process.env.GIT_SHA ?? process.env.GITHUB_SHA,
  };
  if (errored && span.status?.message) {
    entry.error = span.status.message;
  }
  return entry;
}

/**
 * Records pact-tagged spans to the JSONL ledger. Bounded queue, drop-on-full, fail-open.
 */
export class PactLedgerSpanProcessor implements SpanProcessorLike {
  private readonly opts: PactLedgerProcessorOptions;
  private readonly maxQueue: number;
  private pending: QueueItem[] = [];
  private flushing = false;
  private drops = 0;
  private lastWarnAt = 0;

  constructor(opts: PactLedgerProcessorOptions = {}) {
    this.opts = opts;
    this.maxQueue = opts.maxQueueSize ?? DEFAULT_MAX_QUEUE;
  }

  onStart(_span: SpanLike, _parentContext: OtelContext): void {
    // no-op
  }

  onEnd(span: ReadableSpanLike): void {
    try {
      const entry = ledgerEntryFromSpan(span);
      if (!entry) return;

      if (this.pending.length >= this.maxQueue) {
        // FIFO eviction: drop the oldest queued entry to keep the newest.
        // Recent evidence is more valuable than backlog under sustained pressure.
        this.pending.shift();
        this.drops++;
        this.opts.onDrop?.('queue_full');
        this.maybeWarn(
          `autotel-pact: dropped oldest queued ledger entry (queue full, max ${this.maxQueue}). ` +
            `${this.drops} total drops.`,
        );
      }

      this.pending.push({ entry, opts: this.opts });
      queueMicrotask(() => {
        void this.flush();
      });
    } catch (error) {
      this.opts.onWriteError?.(error);
    }
  }

  private maybeWarn(message: string): void {
    const now = Date.now();
    if (now - this.lastWarnAt < WARN_INTERVAL_MS) return;
    this.lastWarnAt = now;
    if (this.opts.onWarn) {
      this.opts.onWarn(message);
    } else {
      console.warn(message);
    }
  }

  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.pending.length > 0) {
        const item = this.pending.shift()!;
        try {
          await appendLedgerEntryAsync(item.entry, item.opts);
        } catch (error) {
          this.opts.onWriteError?.(error);
          this.maybeWarn(
            `autotel-pact: ledger write failed (fail-open): ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } finally {
      this.flushing = false;
      if (this.pending.length > 0) {
        queueMicrotask(() => {
          void this.flush();
        });
      }
    }
  }

  async forceFlush(): Promise<void> {
    await this.flush();
    await flushLedgerWrites();
  }

  async shutdown(): Promise<void> {
    await this.forceFlush();
  }
}

export function createPactLedgerProcessor(
  opts: PactLedgerProcessorOptions = {},
): PactLedgerSpanProcessor {
  return new PactLedgerSpanProcessor(opts);
}
