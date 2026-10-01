// Ingest → issues → automations, for the devtools server.
//
// Every trace and log that arrives is checked for a failure. A failure is
// counted once (idempotent across exporter retries and multi-batch traces),
// source-mapped first so it groups by the code you wrote rather than the
// bundle that ran, and then every automation it trips is delivered with
// retries and a recorded run.

import {
  deliver,
  firesOn,
  occurrenceFromLog,
  occurrenceFromTrace,
  redactDestination,
  type Automation,
  type Issue,
  type IssuePayload,
  type Occurrence,
  type SendTrigger,
} from '../issues';
import type { SourceMapResolver } from './sourcemap';
import { logToIssueLog, traceToIssueSpans } from './issue-input';
import type { DevtoolsStore } from './store/store';
import type { IssueRun } from './store/issues';
import type { LogData, SpanData, TraceData } from './types';

const DAY = 86_400_000;

export interface IssueEngineOptions {
  store: DevtoolsStore;
  resolver?: SourceMapResolver;
  fetch?: typeof fetch;
  now?: () => number;
  /** Base URL devtools is reachable at, for links in sent issues. */
  baseUrl?: () => string | undefined;
  /** Delivery retry backoff; tests set 0. */
  backoffMs?: number;
  log?: (message: string) => void;
}

function stackKeyOf(attributes: Record<string, unknown> | undefined) {
  for (const key of [
    'exception.stacktrace',
    'exception.stack',
    'error.stack',
  ]) {
    if (typeof attributes?.[key] === 'string') return key;
  }
  return undefined;
}

export class IssueEngine {
  private readonly pending = new Set<Promise<unknown>>();
  private readonly now: () => number;

  constructor(private readonly options: IssueEngineOptions) {
    this.now = options.now ?? Date.now;
  }

  private get issues() {
    return this.options.store.issues;
  }

  /**
   * Rewrite exception stacks through source maps, in place, before anything
   * stores or shows them: the waterfall, the Errors tab and issue grouping all
   * then see the original file and line.
   */
  resolveStacks(spans: SpanData[]): void {
    const { resolver } = this.options;
    if (!resolver) return;
    for (const span of spans) {
      for (const holder of [
        span.attributes,
        ...(span.events ?? []).map((e) => e.attributes),
      ]) {
        const key = stackKeyOf(holder);
        if (holder && key) {
          holder[key] = resolver.resolveStack(String(holder[key]));
        }
      }
    }
  }

  ingestTrace(trace: TraceData): void {
    const occurrence = occurrenceFromTrace(
      trace.traceId,
      traceToIssueSpans(trace),
    );
    if (occurrence) this.process(occurrence);
  }

  ingestLog(log: LogData): void {
    const input = logToIssueLog(log);
    const stackKey = stackKeyOf(input.attributes);
    if (stackKey && this.options.resolver && input.attributes) {
      input.attributes = {
        ...input.attributes,
        [stackKey]: this.options.resolver.resolveStack(
          String(input.attributes[stackKey]),
        ),
      };
    }
    const occurrence = occurrenceFromLog(input);
    if (occurrence) this.process(occurrence);
  }

  private process(occurrence: Occurrence): void {
    const result = this.issues.record(occurrence);
    if (!result.isNew) return;
    for (const automation of this.issues.listAutomations()) {
      if (!firesOn(automation, result.step)) continue;
      const trigger: SendTrigger =
        automation.trigger.type === 'threshold' ? 'threshold' : 'recurrence';
      if (
        trigger === 'threshold' &&
        this.issues.hasRun(automation.id, occurrence.fingerprint, trigger)
      ) {
        continue;
      }
      this.track(
        this.run(
          occurrence.fingerprint,
          automation.destinationId,
          trigger,
          automation,
        ),
      );
    }
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    void promise.finally(() => this.pending.delete(promise));
    return promise;
  }

  /** Resolves when every in-flight delivery has finished. */
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  /** The issue plus what a fixer needs: its latest trace and the logs around it. */
  payload(issue: Issue, trigger: SendTrigger): IssuePayload {
    const { store } = this.options;
    const traceId = issue.sampleTraceIds[0];
    const trace = traceId ? store.getTrace(traceId) : null;
    const service = issue.service.replaceAll('"', '\\"');
    const logs = store.queryLogs({
      query: `service = "${service}"`,
      window: { start: issue.lastSeen - 30_000, end: issue.lastSeen + 30_000 },
      limit: 50,
    }).logs;
    const base = this.options.baseUrl?.();
    return {
      trigger,
      issue,
      ...(trace
        ? {
            trace: {
              traceId: trace.traceId,
              service: trace.service,
              durationMs: trace.duration,
              spans: trace.spans.slice(0, 100).map((span) => ({
                name: span.name,
                spanId: span.spanId,
                parentSpanId: span.parentSpanId,
                status: span.status.code,
                durationMs: span.duration,
                ...(span.status.message ? { error: span.status.message } : {}),
              })),
            },
          }
        : {}),
      logs: logs.map((log) => ({
        timestamp: log.timestamp,
        severity: log.severityText,
        body:
          typeof log.body === 'string' ? log.body : JSON.stringify(log.body),
      })),
      ...(base ? { url: `${base}/?issue=${issue.fingerprint}` } : {}),
    };
  }

  /** Send one issue to one destination now, recording the run. */
  async run(
    fingerprint: string,
    destinationId: string,
    trigger: SendTrigger,
    automation?: Automation,
  ): Promise<IssueRun | undefined> {
    const destination = this.issues.getDestination(destinationId);
    const now = this.now();
    const issue = this.issues.get(fingerprint, now - 7 * DAY, now);
    if (!destination || !issue) return undefined;
    const id = this.issues.startRun({
      automationId: automation?.id,
      destinationId,
      fingerprint,
      trigger,
      at: now,
    });
    const outcome = await deliver(destination, this.payload(issue, trigger), {
      fetch: this.options.fetch,
      backoffMs: this.options.backoffMs,
    });
    this.issues.finishRun(id, outcome, this.now());
    if (!outcome.ok) {
      this.options.log?.(
        `issue ${fingerprint} → ${redactDestination(destination).name}: ${outcome.error ?? 'failed'}`,
      );
    }
    return this.issues
      .runs({ fingerprint, limit: 50 })
      .find((r) => r.id === id);
  }

  hasDestination(id: string): boolean {
    return this.issues.getDestination(id) !== undefined;
  }

  /** Manual "send now" from the UI or API. */
  send(
    fingerprint: string,
    destinationId: string,
  ): Promise<IssueRun | undefined> {
    return this.track(this.run(fingerprint, destinationId, 'manual'));
  }

  /** Occurrence details for 7 days, run history for 30, as Cloudflare keeps them. */
  enforceRetention(): void {
    const now = this.now();
    this.issues.pruneOccurrences(now - 7 * DAY);
    this.issues.pruneRuns(now - 30 * DAY);
  }
}
