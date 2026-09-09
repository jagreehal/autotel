import { logLevelToSeverityNumber } from '@effect/opentelemetry/OtelLogger';
import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import * as Resource from '@effect/opentelemetry/Resource';
import { logs } from '@opentelemetry/api-logs';
import { flattenToAttributes, getActiveSpan, otelTrace } from 'autotel';
import { createBuiltinLogger, type BuiltinLoggerOptions } from 'autotel/logger';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Logger from 'effect/Logger';
import type * as LogLevel from 'effect/LogLevel';
import * as References from 'effect/References';

export interface AutotelEffectLoggerOptions {
  /** Keep Effect's default console logger alongside this one. Default: false. */
  readonly mergeWithExisting?: boolean;
  /**
   * Minimum level autotel's logger emits to stdout. Default: `'info'` — leave
   * it there and `Effect.logDebug` never reaches stdout even when Effect's own
   * minimum log level allows it.
   */
  readonly level?: BuiltinLoggerOptions['level'];
  /** Pretty-print the stdout line instead of JSON. Default: false. */
  readonly pretty?: boolean;
  /**
   * Also write each log to stdout via autotel's built-in logger.
   * Default: true. Set to false when `captureConsole()` is on, otherwise
   * every Effect log is reported twice.
   */
  readonly console?: boolean;
}

export interface AutotelEffectLayerOptions {
  readonly serviceName: string;
  readonly serviceVersion?: string;
  /**
   * Bridge `Effect.log*` as well as spans. Default: `true`. Pass `false` for
   * spans only, or an options object to configure the logger.
   */
  readonly logs?: boolean | AutotelEffectLoggerOptions;
}

/**
 * Routes `Effect.withSpan` and `Effect.log*` through autotel's global
 * OpenTelemetry provider.
 *
 * Call `autotel.init()` before this layer is built — typically by loading an
 * instrumentation module with `node --import` or `tsx --import`.
 */
export function layer(options: AutotelEffectLayerOptions): Layer.Layer<never> {
  const tracer = OtelTracer.layerGlobal.pipe(
    Layer.provide(
      Resource.layer({
        serviceName: options.serviceName,
        ...(options.serviceVersion
          ? { serviceVersion: options.serviceVersion }
          : {}),
      }),
    ),
  );

  const logs = options.logs ?? true;

  return Layer.mergeAll(
    tracer,
    logs === false
      ? Layer.empty
      : loggerLayer({
          serviceName: options.serviceName,
          ...(options.serviceVersion
            ? { serviceVersion: options.serviceVersion }
            : {}),
          ...(logs === true ? {} : logs),
        }),
  );
}

/**
 * Runs `self` as a child of the autotel span active around it, so an
 * `Effect.withSpan` inside an instrumented handler lands in that request's
 * trace: `Effect.runPromise(withAutotel(program))`.
 *
 * Effect takes a span's parent from its own `Tracer.ParentSpan`, which the
 * ambient OpenTelemetry context does not supply. The active span is read when
 * the effect runs rather than when it is built, so a program assembled once at
 * startup still joins the request it runs inside - and why this is not part of
 * `layer()`, which is built once for the whole application.
 */
export function withAutotel<A, E, R>(
  self: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.suspend(() => {
    const spanContext = getActiveSpan()?.spanContext();
    // An invalid context is what the API hands back for a non-recording span;
    // parenting to it would produce a child of the all-zero trace id.
    return spanContext && otelTrace.isSpanContextValid(spanContext)
      ? OtelTracer.withSpanContext(self, spanContext)
      : self;
  });
}

/**
 * Routes Effect's `Effect.log*` through autotel instead of Effect's console
 * logger, emitting each log as an OpenTelemetry log record (so it reaches any
 * OTLP log backend, autotel-devtools included) and, unless disabled, a
 * structured line on stdout via autotel's built-in logger.
 *
 * `layer()` already includes this. Reach for it on its own only when something
 * else owns the tracer and you want autotel to own the logs.
 */
export function loggerLayer(
  options: Omit<AutotelEffectLayerOptions, 'logs'> & AutotelEffectLoggerOptions,
) {
  const log = createBuiltinLogger(options.serviceName, {
    ...(options.level ? { level: options.level } : {}),
    ...(options.pretty ? { pretty: options.pretty } : {}),
  });
  // Resolved per-emit, not here: `init()` installs the global LoggerProvider,
  // and the layer may well be built before it runs.
  const otelLogger = () =>
    logs.getLogger(options.serviceName, options.serviceVersion);

  return Logger.layer(
    [
      Logger.make(({ cause, fiber, logLevel, message }) => {
        const method = LEVEL_TO_METHOD[logLevel];
        if (!method) return;

        const parts = Array.isArray(message) ? message : [message];
        const metadata: Record<string, unknown> = {
          ...fiber.getRef(References.CurrentLogAnnotations),
        };

        // `Effect.logError('msg', error)` puts the error in the message parts,
        // `Effect.log(...).pipe(Effect.catchCause(...))` puts it in the cause.
        // Either way the stack belongs in `err`, not stringified into `msg`.
        const errors = parts.filter((part) => part instanceof Error);
        if (cause.reasons.length > 0) {
          metadata.err = Cause.pretty(cause);
        } else if (errors.length > 0) {
          metadata.err = errors.map((error) => error.stack ?? String(error));
        }

        const body = parts.map(formatPart).join(' ');

        if (options.console ?? true) {
          log[method](metadata, body);
        }
        otelLogger().emit({
          body,
          severityNumber: logLevelToSeverityNumber(logLevel),
          severityText: logLevel,
          // Annotations are `unknown`; only what flattens to an OTel attribute
          // reaches the record, in the same shape the rest of autotel emits.
          attributes: flattenToAttributes({
            ...metadata,
            ...(Array.isArray(metadata.err)
              ? { err: metadata.err.join('\n') }
              : {}),
          }),
        });
      }),
    ],
    { mergeWithExisting: options.mergeWithExisting ?? false },
  );
}

const LEVEL_TO_METHOD: Partial<
  Record<LogLevel.LogLevel, 'debug' | 'info' | 'warn' | 'error'>
> = {
  Trace: 'debug',
  Debug: 'debug',
  Info: 'info',
  Warn: 'warn',
  Error: 'error',
  Fatal: 'error',
};

function formatPart(part: unknown): string {
  if (typeof part === 'string') return part;
  // `JSON.stringify(new Error('x'))` is `{}` — String() keeps the message.
  if (part instanceof Error) return String(part);
  try {
    return JSON.stringify(part) ?? String(part);
  } catch {
    return String(part);
  }
}
