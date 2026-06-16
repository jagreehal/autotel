/**
 * Runtime contract enforcement as an OpenTelemetry SpanProcessor.
 *
 * Wire it into `init({ spanProcessors: [...] })` and every span your service
 * emits is validated against the contract as it ends. In development a typo'd
 * or undeclared attribute surfaces immediately instead of silently drifting
 * the public telemetry API out from under the agents reading it.
 *
 * Fail-open by construction: a bug in validation must never break the app or
 * lose a span. Off in production by default (validation belongs in CI and dev),
 * but `enabledInProduction` is there if you want a sampled canary in prod.
 */

import { validateSpan, type SchemaViolation, type ValidateOptions } from './validate.js';
import type { TelemetryContract } from './contract.js';

/** Minimal ReadableSpan shape — matches OTel without a hard SDK dependency. */
export interface ReadableSpanLike {
  name: string;
  attributes: Record<string, unknown>;
}

export interface SpanLike {
  spanContext(): { traceId: string; spanId: string };
}

/** Opaque parent context — matches OTel SpanProcessor without importing it. */
export type OtelContext = unknown;

export interface SpanProcessorLike {
  onStart(span: SpanLike, parentContext: OtelContext): void;
  onEnd(span: ReadableSpanLike): void;
  shutdown(): Promise<void>;
  forceFlush(): Promise<void>;
}

/** How the processor reacts to a contract violation. */
export type SchemaProcessorMode = 'warn' | 'throw' | 'silent';

export interface SchemaValidationProcessorOptions extends ValidateOptions {
  contract: TelemetryContract;
  /**
   * `warn` (default): log each distinct violation once per interval.
   * `throw`: throw on the first error-severity violation — for tests/CI only.
   * `silent`: collect via `onViolation` without logging.
   */
  mode?: SchemaProcessorMode;
  /** Called for every violation, before mode handling. */
  onViolation?: (violation: SchemaViolation, span: ReadableSpanLike) => void;
  /** Override the warn sink (defaults to `console.warn`). */
  onWarn?: (message: string) => void;
  /** Run even when `NODE_ENV === 'production'`. Default `false`. */
  enabledInProduction?: boolean;
  /** Throttle window for repeated identical warnings (ms). Default 60s. */
  warnIntervalMs?: number;
}

const DEFAULT_WARN_INTERVAL_MS = 60_000;

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Validates each ending span against a {@link TelemetryContract}. Bounded,
 * deduplicated warnings; fail-open on any internal error.
 */
export class SchemaValidationSpanProcessor implements SpanProcessorLike {
  private readonly opts: SchemaValidationProcessorOptions;
  private readonly enabled: boolean;
  private readonly warnIntervalMs: number;
  private readonly lastWarnAt = new Map<string, number>();
  private violationCount = 0;

  constructor(opts: SchemaValidationProcessorOptions) {
    this.opts = opts;
    this.enabled = opts.enabledInProduction === true || !isProduction();
    this.warnIntervalMs = opts.warnIntervalMs ?? DEFAULT_WARN_INTERVAL_MS;
  }

  /** Number of violations seen since startup (across all spans). */
  get totalViolations(): number {
    return this.violationCount;
  }

  onStart(_span: SpanLike, _parentContext: OtelContext): void {
    // no-op — validation happens once the span is complete
  }

  onEnd(span: ReadableSpanLike): void {
    if (!this.enabled) return;
    let violations: SchemaViolation[];
    try {
      // Validation itself is fail-open: a bug here must never break export.
      violations = validateSpan(
        { name: span.name, attributes: span.attributes },
        this.opts.contract,
        { strictSpanNames: this.opts.strictSpanNames },
      );
    } catch {
      return;
    }
    // Mode handling runs outside the fail-open guard so `throw` mode propagates.
    for (const violation of violations) {
      this.violationCount++;
      this.opts.onViolation?.(violation, span);
      this.handle(violation);
    }
  }

  private handle(violation: SchemaViolation): void {
    const mode = this.opts.mode ?? 'warn';
    if (mode === 'silent') return;
    if (mode === 'throw' && violation.severity === 'error') {
      throw new Error(
        `autotel-schema: contract violation (${violation.code}) on span "${violation.spanName}": ${violation.message}`,
      );
    }
    this.maybeWarn(violation);
  }

  private maybeWarn(violation: SchemaViolation): void {
    const key = `${violation.code}:${violation.spanName}:${violation.attribute ?? ''}`;
    const now = Date.now();
    const last = this.lastWarnAt.get(key) ?? 0;
    if (now - last < this.warnIntervalMs) return;
    this.lastWarnAt.set(key, now);
    const suffix = violation.suggestion
      ? ` (did you mean "${violation.suggestion}"?)`
      : '';
    const message = `autotel-schema [${violation.severity}] ${violation.code} on "${violation.spanName}"${violation.attribute ? `.${violation.attribute}` : ''}: ${violation.message}${suffix}`;
    if (this.opts.onWarn) {
      this.opts.onWarn(message);
    } else {
      console.warn(message);
    }
  }

  async forceFlush(): Promise<void> {
    // nothing buffered — validation is synchronous in onEnd
  }

  async shutdown(): Promise<void> {
    this.lastWarnAt.clear();
  }
}

export function createSchemaValidationProcessor(
  opts: SchemaValidationProcessorOptions,
): SchemaValidationSpanProcessor {
  return new SchemaValidationSpanProcessor(opts);
}
