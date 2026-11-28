import { logLevelToSeverityNumber } from '@effect/opentelemetry/OtelLogger';
import * as OtelTracer from '@effect/opentelemetry/OtelTracer';
import * as Resource from '@effect/opentelemetry/Resource';
import { logs } from '@opentelemetry/api';
import { flattenToAttributes } from 'autotel';
import { createBuiltinLogger, type BuiltinLoggerOptions } from 'autotel/logger';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as ManagedRuntime from 'effect/ManagedRuntime';
import * as Tracer from 'effect/Tracer';
import { withBaggage } from './baggage.js';
import { withEffectSemantics, type EffectSpanOptions } from './semantics.js';
import * as Logger from 'effect/Logger';
import * as Predicate from 'effect/Predicate';
import type * as LogLevel from 'effect/LogLevel';
import * as References from 'effect/References';

export { baggageMiddleware, CurrentBaggage, parseBaggage } from './baggage.js';
export { effectSpanFilter, type EffectSpanOptions } from './semantics.js';
export {
  vercelWaitUntil,
  WaitUntil,
  webHandler,
  type WebHandlerOptions,
} from './serverless.js';

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
  /**
   * How span exits are classified (expected failures stay OK) and which span
   * subtrees are never recorded. To drop single spans, pass
   * `effectSpanFilter()` to `init({ spanFilter })`.
   */
  readonly spans?: EffectSpanOptions;
}

/**
 * Routes `Effect.withSpan` and `Effect.log*` through autotel's global
 * OpenTelemetry provider.
 *
 * Call `autotel.init()` before this layer is built — typically by loading an
 * instrumentation module with `node --import` or `tsx --import`.
 */
export function layer(options: AutotelEffectLayerOptions): Layer.Layer<never> {
  // OtelTracer.layerGlobal, with exits classified (see withEffectSemantics) and the request's baggage active
  // around each evaluation (see CurrentBaggage).
  const tracer = Layer.effect(
    Tracer.Tracer,
    Effect.map(OtelTracer.make, (otel) =>
      withBaggage(withEffectSemantics(otel, options.spans)),
    ),
  ).pipe(
    Layer.provideMerge(OtelTracer.layerGlobalTracer),
    Layer.provide(
      Resource.layer({
        serviceName: options.serviceName,
        // Resource.layer treats an empty serviceVersion as absent.
        serviceVersion: options.serviceVersion,
      }),
    ),
  );

  const logs = options.logs ?? true;
  const loggerOptions: AutotelEffectLoggerOptions =
    logs === true || logs === false ? {} : logs;

  return Layer.mergeAll(
    tracer,
    logs === false
      ? Layer.empty
      : loggerLayer({
          ...loggerOptions,
          serviceName: options.serviceName,
          serviceVersion: options.serviceVersion || undefined,
        }),
  );
}

/**
 * A runtime for effects started from Promise-based callbacks (a bot framework, an MCP server, a queue consumer),
 * built once from `appLayer` with autotel's layer merged in, so a callback's spans and logs export like the server's.
 *
 * Run each callback with `runtime.runPromiseExit`, which returns a defect as an `Exit`.
 */
export function runtime<R, E>(
  appLayer: Layer.Layer<R, E>,
  options: AutotelEffectLayerOptions,
) {
  return ManagedRuntime.make(Layer.mergeAll(appLayer, layer(options)));
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
    level: options.level,
    pretty: options.pretty,
  });
  // Resolved per-emit, not here: `init()` installs the global LoggerProvider,
  // and the layer may well be built before it runs.
  const otelLogger = () =>
    logs.getLogger(options.serviceName, options.serviceVersion);

  return Logger.layer(
    [
      Logger.make(({ cause, date, fiber, logLevel, message }) => {
        const method = LEVEL_TO_METHOD.get(logLevel);
        if (!method) return;

        const parts = Array.isArray(message) ? message : [message];
        const metadata = { ...fiber.getRef(References.CurrentLogAnnotations) };
        // `Effect.withLogSpan` durations in milliseconds.
        for (const [label, start] of fiber.getRef(References.CurrentLogSpans)) {
          metadata[`logSpan.${label}`] = date.getTime() - start;
        }

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
          timestamp: date,
          severityNumber: logLevelToSeverityNumber(logLevel),
          severityText: logLevel,
          // Annotations are `unknown`; only what flattens to an OTel attribute
          // reaches the record, in the same shape the rest of autotel emits.
          attributes: flattenToAttributes(
            Array.isArray(metadata.err)
              ? { ...metadata, err: metadata.err.join('\n') }
              : metadata,
          ),
        });
      }),
    ],
    { mergeWithExisting: options.mergeWithExisting ?? false },
  );
}

const LEVEL_TO_METHOD = new Map<
  LogLevel.LogLevel,
  'debug' | 'info' | 'warn' | 'error'
>([
  ['Trace', 'debug'],
  ['Debug', 'debug'],
  ['Info', 'info'],
  ['Warn', 'warn'],
  ['Error', 'error'],
  ['Fatal', 'error'],
]);

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Effect.log* message parts can be any value the caller logged; this renders them.
function formatPart(part: unknown): string {
  if (Predicate.isString(part)) return part;
  // `JSON.stringify(new Error('x'))` is `{}` — String() keeps the message.
  if (part instanceof Error) return String(part);
  try {
    return JSON.stringify(part) ?? String(part);
  } catch {
    return String(part);
  }
}
