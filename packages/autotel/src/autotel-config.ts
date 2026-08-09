/**
 * The shape of `init()`'s argument.
 *
 * A type with no runtime, kept apart from init.ts because the documentation on
 * these fields is the reference a reader reaches for, and it should not have to
 * be found inside the SDK wiring that consumes it.
 */

import type { Attributes } from '@opentelemetry/api';
import type {
  SpanExporter,
  SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type { MetricReader } from '@opentelemetry/sdk-metrics';
import type { LogRecordProcessor } from '@opentelemetry/sdk-logs';
import type { NodeSDK, NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import type { Resource } from '@opentelemetry/resources';
import type { Sampler, SamplingPreset } from './sampling';
import type { EventSubscriber } from './event-subscriber';
import type { Logger } from './logger';
import type { ValidationConfig } from './validation';
import type { EventsConfig } from './events-config';
import type { AutotelDevtoolsConfig } from './devtools';
import type { ProcessHandlersConfig } from './process-handlers';
import type { SpanFilterPredicate } from './filtering-span-processor';
import type { Policy } from './policy';
import type { SpanNameNormalizerConfig } from './span-name-normalizer';
import type {
  AttributeRedactorConfig,
  AttributeRedactorPreset,
} from './attribute-redacting-processor';
import type { CanonicalLogLinesConfig } from './canonical-log-lines-config';
import type { AutotelProtocol, OtlpDestinationConfig } from './otlp-exporters';

export interface AutotelConfig {
  /** Service name (required) */
  service: string;

  /**
   * Opt-in Node.js process handlers installed after telemetry is initialized.
   *
   * `true` (or `{}`) enables the defaults: flush-and-exit on SIGTERM/SIGINT
   * and on fatal errors, bounded by a 2s shutdown timeout. Pass a config
   * object to override individual defaults. Omit (or pass `false`) to leave
   * process lifecycle management to the application.
   */
  processHandlers?: boolean | ProcessHandlersConfig;

  /**
   * Flush telemetry when the process finishes on its own. Default: `true`.
   *
   * `processHandlers` covers a process that is stopped or that crashes. Neither
   * of those fires when a script runs to completion: Node drains the event loop
   * and exits, and anything the batch span processor is still holding goes with
   * it. Autotel listens for `beforeExit` and flushes there, so a CLI, a cron
   * job or a CI step keeps its telemetry without calling `shutdown()`.
   *
   * A flush, not a shutdown: `beforeExit` fires on any event-loop drain, so a
   * process that resumes work keeps working telemetry. Bounded by
   * `processHandlers.shutdownTimeoutMs`, after which the process exits rather
   * than waiting on an exporter that never answers.
   *
   * Set to `false` if your process manages its own exit and you would rather
   * autotel added no listener.
   */
  flushOnExit?: boolean;

  /**
   * Local developer UX for autotel-devtools.
   *
   * - `true`: send traces, metrics, and logs to `http://127.0.0.1:4318`
   * - `{ embedded: true }`: attempt to start `autotel-devtools` automatically
   *
   * When enabled:
   * - `endpoint` defaults to the local devtools URL
   * - `logs` default to `true` unless explicitly set
   *
   * This keeps production config unchanged while making local debugging
   * effectively zero-config.
   */
  devtools?: boolean | AutotelDevtoolsConfig;

  /** Event subscribers - bring your own (PostHog, Mixpanel, etc.) */
  subscribers?: EventSubscriber[];

  /**
   * Additional OpenTelemetry instrumentations to register (raw OTel classes).
   * Useful when you need custom instrumentation configs or instrumentations
   * not covered by autoInstrumentations.
   *
   * **Important:** If you need custom instrumentation configs (like `requireParentSpan: false`),
   * use EITHER manual instrumentations OR autoInstrumentations, not both for the same library.
   * Manual instrumentations always take precedence over auto-instrumentations.
   *
   * @example Manual instrumentations with custom config
   * ```typescript
   * import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb'
   *
   * init({
   *   service: 'my-app',
   *   autoInstrumentations: false,  // Disable auto-instrumentations
   *   instrumentations: [
   *     new MongoDBInstrumentation({
   *       requireParentSpan: false  // Custom config
   *     })
   *   ]
   * })
   * ```
   *
   * @example Mix auto + manual (auto for most, manual for specific configs)
   * ```typescript
   * import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb'
   *
   * init({
   *   service: 'my-app',
   *   autoInstrumentations: ['http', 'express'],  // Auto for these
   *   instrumentations: [
   *     new MongoDBInstrumentation({
   *       requireParentSpan: false  // Manual config for MongoDB
   *     })
   *   ]
   * })
   * ```
   */
  instrumentations?: NodeSDKConfiguration['instrumentations'];

  /**
   * Simple names for auto-instrumentation.
   * Uses @opentelemetry/auto-instrumentations-node (peer dependency).
   *
   * **Important:** If you provide manual instrumentations for the same library,
   * the manual config takes precedence and auto-instrumentation for that library is disabled.
   *
   * @example Enable all auto-instrumentations (simple approach)
   * ```typescript
   * init({
   *   service: 'my-app',
   *   autoInstrumentations: true  // Enable all with defaults
   * })
   * ```
   *
   * @example Enable specific auto-instrumentations
   * ```typescript
   * init({
   *   service: 'my-app',
   *   autoInstrumentations: ['express', 'pino', 'http']
   * })
   * ```
   *
   * @example Configure specific auto-instrumentations
   * ```typescript
   * init({
   *   service: 'my-app',
   *   autoInstrumentations: {
   *     express: { enabled: true },
   *     pino: { enabled: true },
   *     http: { enabled: false }
   *   }
   * })
   * ```
   *
   * @example Manual config when you need custom settings
   * ```typescript
   * import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb'
   *
   * init({
   *   service: 'my-app',
   *   autoInstrumentations: false,  // Use manual control
   *   instrumentations: [
   *     new MongoDBInstrumentation({
   *       requireParentSpan: false  // Custom config not available with auto
   *     })
   *   ]
   * })
   * ```
   */
  autoInstrumentations?:
    string[] | boolean | Record<string, { enabled?: boolean }>;

  /**
   * OTLP endpoint for traces/metrics/logs
   * Single-destination shorthand. For multi-backend OTLP fan-out, use
   * `destinations` instead.
   * Only used if you don't provide custom exporters/processors
   * @default process.env.OTLP_ENDPOINT || 'http://localhost:4318'
   */
  endpoint?: string;

  /**
   * Declarative OTLP multi-destination config.
   * Each destination can override endpoint, headers, protocol, and signals.
   *
   * This is the high-level alternative to wiring `spanExporters`,
   * `spanProcessors`, `metricReaders`, and `logRecordProcessors` manually when
   * you want to fan telemetry out to multiple OTLP backends.
   *
   * When provided, `destinations` takes precedence over the single `endpoint`
   * shorthand for built-in OTLP exporters/readers/processors.
   *
   * @example Grafana + Honeycomb for traces, Grafana only for metrics/logs
   * ```typescript
   * init({
   *   service: 'my-app',
   *   logs: true,
   *   destinations: [
   *     {
   *       endpoint: 'https://otlp-gateway-prod-eu-west-2.grafana.net/otlp',
   *       headers: { Authorization: 'Basic ...' },
   *     },
   *     {
   *       endpoint: 'https://api.honeycomb.io',
   *       headers: { 'x-honeycomb-team': '...' },
   *       signals: ['traces'],
   *     },
   *   ],
   * })
   * ```
   */
  destinations?: OtlpDestinationConfig[];

  /**
   * Custom span processors for traces (supports multiple processors)
   * Allows you to use any backend: Jaeger, Zipkin, Datadog, New Relic, etc.
   * If not provided, defaults to OTLP with tail sampling
   *
   * @example Multiple processors
   * ```typescript
   * import { JaegerExporter } from '@opentelemetry/exporter-jaeger'
   * import { BatchSpanProcessor, SimpleSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base'
   *
   * init({
   *   service: 'my-app',
   *   spanProcessors: [
   *     new BatchSpanProcessor(new JaegerExporter()),
   *     new SimpleSpanProcessor(new ConsoleSpanExporter())  // Debug alongside production
   *   ]
   * })
   * ```
   *
   * @example Single processor
   * ```typescript
   * import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
   *
   * init({
   *   service: 'my-app',
   *   spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())]
   * })
   * ```
   */
  spanProcessors?: SpanProcessor[];

  /**
   * Span processors that decorate spans on the way out, running before every
   * exporting processor.
   *
   * Unlike {@link spanProcessors}, which replaces the pipeline autotel would
   * have built, these are added to it. Use them for processors that enrich
   * rather than export, so `destinations` keeps working:
   *
   * @example
   * ```typescript
   * init({
   *   service: 'support-agent',
   *   destinations: [{ endpoint: `${langfuseUrl}/api/public/otel`, headers }],
   *   spanEnrichers: [langfuseCompatibility({ tags: ['production'] })],
   * })
   * ```
   */
  spanEnrichers?: SpanProcessor[];

  /**
   * Custom span processor for traces (single-item alias of spanProcessors)
   * @deprecated Use spanProcessors for consistency with other multi-value config fields
   */
  spanProcessor?: SpanProcessor;

  /**
   * Custom span exporters for traces (alternative to spanProcessors, supports multiple exporters)
   * Provide either spanProcessors OR spanExporters, not both
   * Each exporter will be wrapped in TailSamplingSpanProcessor + BatchSpanProcessor
   *
   * @example Multiple exporters
   * ```typescript
   * import { ZipkinExporter } from '@opentelemetry/exporter-zipkin'
   * import { JaegerExporter } from '@opentelemetry/exporter-jaeger'
   *
   * init({
   *   service: 'my-app',
   *   spanExporters: [
   *     new ZipkinExporter({ url: 'http://localhost:9411/api/v2/spans' }),
   *     new JaegerExporter()  // Send to multiple backends simultaneously
   *   ]
   * })
   * ```
   *
   * @example Single exporter
   * ```typescript
   * import { ZipkinExporter } from '@opentelemetry/exporter-zipkin'
   *
   * init({
   *   service: 'my-app',
   *   spanExporters: [new ZipkinExporter({ url: 'http://localhost:9411/api/v2/spans' })]
   * })
   * ```
   */
  spanExporters?: SpanExporter[];

  /**
   * Custom span exporter for traces (single-item alias of spanExporters)
   * @deprecated Use spanExporters for consistency with other multi-value config fields
   */
  spanExporter?: SpanExporter;

  /**
   * Custom metric readers (supports multiple readers)
   * Allows sending metrics to multiple backends: OTLP, Prometheus, custom readers
   * Defaults to OTLP metrics exporter when metrics are enabled.
   *
   * @example Multiple metric readers
   * ```typescript
   * import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
   * import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
   * import { PrometheusExporter } from '@opentelemetry/exporter-prometheus'
   *
   * init({
   *   service: 'my-app',
   *   metricReaders: [
   *     new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() }),
   *     new PrometheusExporter()  // Export to multiple backends
   *   ]
   * })
   * ```
   */
  metricReaders?: MetricReader[];

  /**
   * Custom metric reader (single-item alias of metricReaders)
   * @deprecated Use metricReaders for consistency with other multi-value config fields
   */
  metricReader?: MetricReader;

  /**
   * Custom log record processors. When omitted, logs are not configured.
   */
  logRecordProcessors?: LogRecordProcessor[];

  /**
   * Custom log record processor (single-item alias of logRecordProcessors)
   * @deprecated Use logRecordProcessors for consistency with other multi-value config fields
   */
  logRecordProcessor?: LogRecordProcessor;

  /**
   * PostHog integration - auto-configures OTLP log exporter.
   *
   * @example
   * ```typescript
   * init({
   *   service: 'my-app',
   *   posthog: { url: 'https://us.i.posthog.com/i/v1/logs?token=phc_xxx' }
   * });
   * ```
   *
   * Also reads from POSTHOG_LOGS_URL environment variable as fallback.
   */
  posthog?: { url: string };

  /** Additional resource attributes to merge with defaults. */
  resourceAttributes?: Attributes;

  /** Provide a fully custom Resource to merge (advanced use case). */
  resource?: Resource;

  /**
   * Headers for OTLP exporters. Accepts either an object map or
   * a "key=value" comma separated string.
   *
   * @example
   * ```typescript
   * init({
   *   service: 'my-app',
   *   endpoint: 'https://api.honeycomb.io',
   *   headers: { 'x-honeycomb-team': 'YOUR_API_KEY' }
   * })
   * ```
   */
  headers?: Record<string, string> | string;

  /**
   * OTLP protocol to use for traces, metrics, and logs
   * - 'http': HTTP/protobuf (default, uses port 4318)
   * - 'grpc': gRPC (uses port 4317)
   *
   * Can be overridden with OTEL_EXPORTER_OTLP_PROTOCOL env var.
   *
   * Note: gRPC exporters are optional peer dependencies. Install them with:
   * ```bash
   * pnpm add @opentelemetry/exporter-trace-otlp-grpc @opentelemetry/exporter-metrics-otlp-grpc
   * ```
   *
   * @example HTTP (default)
   * ```typescript
   * init({
   *   service: 'my-app',
   *   protocol: 'http',  // or omit (defaults to http)
   *   endpoint: 'http://localhost:4318'
   * })
   * ```
   *
   * @example gRPC
   * ```typescript
   * init({
   *   service: 'my-app',
   *   protocol: 'grpc',
   *   endpoint: 'grpc://localhost:4317'
   * })
   * ```
   *
   * @default 'http'
   */
  protocol?: AutotelProtocol;

  /**
   * Optional factory to build a customised NodeSDK instance from our defaults.
   */
  sdkFactory?: (defaults: Partial<NodeSDKConfiguration>) => NodeSDK;

  /**
   * Infrastructure metrics configuration
   * - true: always enabled (default)
   * - false: always disabled
   * - 'auto': always enabled (same as true)
   *
   * Can be overridden with AUTOTEL_METRICS=on|off env var
   */
  metrics?: boolean | 'auto';

  /**
   * OTLP logs configuration
   * - true: auto-configure OTLP log exporter from endpoint
   * - false: disabled (default)
   * - 'auto': same as false (opt-in only)
   *
   * When enabled and an endpoint is configured, autotel will automatically
   * create a BatchLogRecordProcessor with an OTLPLogExporter - no manual
   * imports needed. Works alongside logRecordProcessors (additive).
   *
   * Requires @opentelemetry/sdk-logs and @opentelemetry/exporter-logs-otlp-http
   * (or -grpc) as peer dependencies.
   *
   * Can be overridden with AUTOTEL_LOGS=on|off env var.
   *
   * @example
   * ```typescript
   * init({
   *   service: 'my-app',
   *   endpoint: 'http://localhost:4318',
   *   logs: true,
   * });
   * ```
   */
  logs?: boolean | 'auto';

  /** Sampling strategy - takes precedence over `sampling` preset */
  sampler?: Sampler;

  /**
   * Sampling preset shorthand — resolves to a pre-configured sampler.
   * If both `sampler` and `sampling` are provided, `sampler` takes precedence.
   *
   * @default 'production' (10% baseline + always-on for errors/slow)
   *
   * **Footgun for one-shot scripts:** the default samples ~90% of spans away,
   * which means a fixture-capture script that emits a single normal span
   * almost always sees zero output. For local debugging and capture use:
   *
   * ```typescript
   * init({
   *   service: 'fixture-capture',
   *   spanProcessors: [new SimpleSpanProcessor(new InMemorySpanExporter())],
   *   sampling: 'development', // capture EVERY span
   * });
   * ```
   *
   * Read `exporter.getFinishedSpans()` **before** calling `shutdown()` —
   * `InMemorySpanExporter.shutdown()` resets state.
   */
  sampling?: SamplingPreset;

  /** Service version (default: auto-detect from package.json or '1.0.0') */
  version?: string;

  /** Environment (default: process.env.NODE_ENV || 'development') */
  environment?: string;

  /**
   * Logger instance for internal autotel diagnostic messages
   *
   * This logger is used by autotel internally to log initialization, warnings,
   * and debug information. Any logger with info/warn/error/debug methods works.
   *
   * **For OTel instrumentation of your application logs**, use the `autoInstrumentations` option:
   * - `autoInstrumentations: ['pino']` - Injects traceId/spanId into Pino logs
   * - `autoInstrumentations: ['winston']` - Injects traceId/spanId into Winston logs
   *
   * Default: silent logger (no-op)
   *
   * @example Pino with OTel instrumentation
   * ```typescript
   * import pino from 'pino'
   * import { init } from 'autotel'
   *
   * const logger = pino({ level: 'info' })
   * init({
   *   service: 'my-app',
   *   logger,                       // For autotel's internal logs
   *   autoInstrumentations: ['pino'] // For OTel trace context in YOUR logs
   * })
   * ```
   *
   * @example Custom logger for autotel diagnostics
   * ```typescript
   * const logger = {
   *   info: (msg, extra) => console.log(msg, extra),
   *   warn: (msg, extra) => console.warn(msg, extra),
   *   error: (msg, err, extra) => console.error(msg, err, extra),
   *   debug: (msg, extra) => console.debug(msg, extra),
   * }
   * init({ service: 'my-app', logger })
   * ```
   */
  logger?: Logger;

  /**
   * Flush events queue when root spans end
   * - true: Flush on root span completion (default)
   * - false: Use batching (events flush every 10 seconds automatically)
   *
   * Only flushes on root spans to avoid excessive network calls.
   * Default is true for serverless/short-lived processes. Set to false
   * for long-running services where batching is more efficient.
   */
  flushOnRootSpanEnd?: boolean;

  /**
   * Force-flush OpenTelemetry spans on shutdown (default: false)
   *
   * When enabled, spans are force-flushed along with events on root
   * span completion. This is useful for serverless/short-lived processes where
   * spans may not export before the process ends.
   *
   * - true: Force-flush spans on root span completion (~50-200ms latency)
   * - false: Spans export via normal batch processor (default behavior)
   *
   * Only applies when flushOnRootSpanEnd is also enabled.
   *
   * Note: For edge runtimes (Cloudflare Workers, Vercel Edge), use the
   * 'autotel-edge' package instead, which handles this automatically.
   *
   * @example Serverless with force-flush
   * ```typescript
   * init({
   *   service: 'my-lambda',
   *   flushOnRootSpanEnd: true,
   *   forceFlushOnShutdown: true, // Force-flush spans
   * });
   * ```
   */
  forceFlushOnShutdown?: boolean;

  /**
   * Automatically copy baggage entries to span attributes
   *
   * When enabled, all baggage entries are automatically added as span attributes,
   * making them visible in trace UIs (Jaeger, Grafana, DataDog, etc.) without
   * manually calling ctx.setAttribute() for each entry.
   *
   * - `true`: adds baggage with 'baggage.' prefix (e.g. baggage.tenant.id)
   * - `string`: uses custom prefix (e.g. 'ctx' → ctx.tenant.id, '' → tenant.id)
   * - `false` or omit: disabled (default)
   *
   * @default false
   *
   * @example Enable with default prefix
   * ```typescript
   * init({
   *   service: 'my-app',
   *   baggage: true
   * });
   *
   * // Now baggage automatically appears as span attributes
   * await withBaggage({
   *   baggage: { 'tenant.id': 't1', 'user.id': 'u1' },
   *   fn: async () => {
   *     // Span has baggage.tenant.id and baggage.user.id attributes!
   *   }
   * });
   * ```
   *
   * @example Custom prefix
   * ```typescript
   * init({
   *   service: 'my-app',
   *   baggage: 'ctx' // Uses 'ctx.' prefix
   * });
   * // Creates attributes: ctx.tenant.id, ctx.user.id
   * ```
   *
   * @example No prefix
   * ```typescript
   * init({
   *   service: 'my-app',
   *   baggage: '' // No prefix
   * });
   * // Creates attributes: tenant.id, user.id
   * ```
   */
  baggage?: boolean | string;

  /**
   * Validation configuration for events events
   * - Override default sensitive field patterns for redaction
   * - Customize max lengths, nesting depth, etc.
   *
   * @example Disable redaction for development
   * ```typescript
   * init({
   *   service: 'my-app',
   *   validation: {
   *     sensitivePatterns: [] // Disable all redaction
   *   }
   * })
   * ```
   *
   * @example Add custom patterns
   * ```typescript
   * init({
   *   service: 'my-app',
   *   validation: {
   *     sensitivePatterns: [
   *       /password/i,
   *       /apiKey/i,
   *       /customSecret/i  // Your custom pattern
   *     ]
   *   }
   * })
   * ```
   */
  validation?: Partial<ValidationConfig>;

  /**
   * Events configuration for trace context, correlation IDs, and enrichment
   *
   * Controls how product events integrate with distributed tracing:
   * - `includeTraceContext`: Automatically include trace context in events
   * - `includeLinkedTraceIds`: Include full array of linked trace IDs (for batch/fan-in)
   * - `traceUrl`: Generate clickable trace URLs in events
   * - `enrichFromBaggage`: Auto-enrich events from baggage with guardrails
   *
   * @example Basic trace context
   * ```typescript
   * init({
   *   service: 'my-app',
   *   events: {
   *     includeTraceContext: true
   *   }
   * });
   * // Events now include autotel.trace_id, autotel.span_id, autotel.correlation_id
   * ```
   *
   * @example With clickable trace URLs
   * ```typescript
   * init({
   *   service: 'my-app',
   *   events: {
   *     includeTraceContext: true,
   *     traceUrl: (ctx) => `https://grafana.internal/explore?traceId=${ctx.traceId}`
   *   }
   * });
   * ```
   *
   * @example With baggage enrichment
   * ```typescript
   * init({
   *   service: 'my-app',
   *   events: {
   *     includeTraceContext: true,
   *     enrichFromBaggage: {
   *       allow: ['tenant.id', 'user.id'],
   *       prefix: 'ctx.',
   *       maxKeys: 10,
   *       maxBytes: 1024
   *     }
   *   }
   * });
   * ```
   */
  events?: EventsConfig;

  /**
   * Debug mode for local span inspection.
   * Enables console output to help you see spans as they're created.
   *
   * - `true`: Raw JSON output (ConsoleSpanExporter)
   * - `'pretty'`: Colorized, hierarchical output (PrettyConsoleExporter)
   * - `false`/undefined: No console output (default)
   *
   * When enabled: Outputs spans to console AND sends to backend (if endpoint/exporter configured)
   *
   * Perfect for progressive development:
   * - Start with debug: 'pretty' (no endpoint) → see traces immediately with nice formatting
   * - Add endpoint later → console + backend, verify before choosing provider
   * - Remove debug in production → backend only, clean production config
   *
   * Can be overridden with AUTOTEL_DEBUG environment variable.
   *
   * @example Pretty debug output (recommended for development)
   * ```typescript
   * init({
   *   service: 'my-app',
   *   debug: 'pretty'  // Colorized, hierarchical output
   * })
   * ```
   *
   * @example Raw JSON output (verbose)
   * ```typescript
   * init({
   *   service: 'my-app',
   *   debug: true  // Raw ConsoleSpanExporter output
   * })
   * ```
   *
   * @example Environment variable
   * ```bash
   * AUTOTEL_DEBUG=pretty node server.js
   * AUTOTEL_DEBUG=true node server.js
   * ```
   */
  debug?: boolean | 'pretty';

  /**
   * Filter predicate to drop unwanted spans before processing.
   *
   * Useful for filtering out noisy spans from specific instrumentations
   * (e.g., Next.js internal spans, health check endpoints).
   *
   * The filter runs on completed spans (onEnd), so you have access to:
   * - `span.name` - Span name
   * - `span.attributes` - All span attributes
   * - `span.instrumentationScope` - `{ name, version }` of the instrumentation
   * - `span.status` - Span status code and message
   * - `span.duration` - Span duration as `[seconds, nanoseconds]`
   *
   * Return `true` to keep the span, `false` to drop it.
   *
   * @example Filter out Next.js instrumentation spans
   * ```typescript
   * init({
   *   service: 'my-app',
   *   spanFilter: (span) => span.instrumentationScope.name !== 'next.js'
   * })
   * ```
   *
   * @example Filter out health check spans
   * ```typescript
   * init({
   *   service: 'my-app',
   *   spanFilter: (span) => !span.name.includes('/health')
   * })
   * ```
   *
   * @example Complex filtering (multiple conditions)
   * ```typescript
   * init({
   *   service: 'my-app',
   *   spanFilter: (span) => {
   *     // Drop Next.js internal spans
   *     if (span.instrumentationScope.name === 'next.js') return false;
   *     // Drop health checks
   *     if (span.name.includes('/health')) return false;
   *     // Drop very short spans (less than 1ms)
   *     const [secs, nanos] = span.duration;
   *     if (secs === 0 && nanos < 1_000_000) return false;
   *     return true;
   *   }
   * })
   * ```
   */
  spanFilter?: SpanFilterPredicate;

  /**
   * Telemetry Policies (experimental) — OTEP 4738.
   *
   * Portable, fail-open rules deciding what telemetry is kept and how it is
   * transformed. Pass a path to a `.json` file or a directory of them (reloaded
   * on change), or an inline array.
   *
   * Composes with `spanFilter`: a span must pass both.
   *
   * @example
   * ```typescript
   * init({ service: 'api', policies: './policies' })
   * ```
   *
   * @see `autotel/policy` for the supported subset of policy stages.
   */
  policies?: string | Policy[];

  /**
   * Normalize span names to reduce cardinality from dynamic path segments.
   *
   * High-cardinality span names (e.g., `/users/123/posts/456`) cause issues:
   * - Cost explosions in observability backends
   * - Cardinality limits exceeded
   * - Poor UX when searching/filtering traces
   *
   * The normalizer transforms dynamic segments into placeholders:
   * - `/users/123` → `/users/:id`
   * - `/items/550e8400-e29b-...` → `/items/:uuid`
   *
   * Provide either a custom function or use a built-in preset:
   * - `'rest-api'` - Numeric IDs, UUIDs, ObjectIds, dates, timestamps, emails
   * - `'graphql'` - GraphQL operation name normalization
   * - `'minimal'` - Only numeric IDs and UUIDs
   *
   * @example Custom normalizer function
   * ```typescript
   * init({
   *   service: 'my-app',
   *   spanNameNormalizer: (name) => {
   *     return name
   *       .replace(/\/[0-9]+/g, '/:id')
   *       .replace(/\/[a-f0-9-]{36}/gi, '/:uuid');
   *   }
   * })
   * ```
   *
   * @example Using built-in preset
   * ```typescript
   * init({
   *   service: 'my-app',
   *   spanNameNormalizer: 'rest-api'
   * })
   * ```
   *
   * @example Combining with spanFilter
   * ```typescript
   * init({
   *   service: 'my-app',
   *   spanNameNormalizer: 'rest-api',
   *   spanFilter: (span) => span.instrumentationScope.name !== 'next.js'
   * })
   * ```
   */
  spanNameNormalizer?: SpanNameNormalizerConfig;

  /**
   * Automatically redact PII and sensitive data from span attributes before export.
   * Critical for compliance (GDPR, PCI-DSS, HIPAA) and data security.
   *
   * Auto-enabled in production: when this is left unset and the resolved
   * environment is `production`, the `'default'` preset is applied. Override
   * with the `AUTOTEL_REDACT_PII` env var (`off` / `strict` / `pci-dss` / ...)
   * or pass `false` to disable redaction entirely.
   *
   * Can be a preset name, custom configuration, or `false` to disable:
   * - `'default'`: Emails, phones, SSNs, credit cards, sensitive keys (password, secret, token)
   * - `'strict'`: Default + Bearer tokens, JWTs, API keys in values
   * - `'pci-dss'`: Payment card industry focus (credit cards, CVV, card-related keys)
   *
   * @example Use default preset
   * ```typescript
   * init({
   *   service: 'my-app',
   *   attributeRedactor: 'default'
   * })
   * ```
   *
   * @example Custom patterns
   * ```typescript
   * init({
   *   service: 'my-app',
   *   attributeRedactor: {
   *     keyPatterns: [/password/i, /secret/i],
   *     valuePatterns: [
   *       { name: 'customerId', pattern: /CUST-\d{8}/g, replacement: 'CUST-***' }
   *     ]
   *   }
   * })
   * ```
   *
   * @example Custom redactor function
   * ```typescript
   * init({
   *   service: 'my-app',
   *   attributeRedactor: {
   *     redactor: (key, value) => {
   *       if (key === 'user.email' && typeof value === 'string') {
   *         return value.replace(/@.+/, '@[REDACTED]');
   *       }
   *       return value;
   *     }
   *   }
   * })
   * ```
   */
  attributeRedactor?: AttributeRedactorConfig | AttributeRedactorPreset | false;

  /**
   * OpenLLMetry integration for LLM observability.
   * Requires @traceloop/node-server-sdk as an optional peer dependency.
   *
   * @example Enable OpenLLMetry with default settings
   * ```typescript
   * init({
   *   service: 'my-app',
   *   openllmetry: { enabled: true }
   * })
   * ```
   *
   * @example Enable with custom options
   * ```typescript
   * init({
   *   service: 'my-app',
   *   openllmetry: {
   *     enabled: true,
   *     options: {
   *       disableBatch: process.env.NODE_ENV !== 'production',
   *       apiKey: process.env.TRACELOOP_API_KEY
   *     }
   *   }
   * })
   * ```
   */
  openllmetry?: {
    enabled: boolean;
    options?: Record<string, unknown>;
  };

  /** Emit completed spans as canonical wide-event logs. */
  canonicalLogLines?: CanonicalLogLinesConfig;

  /**
   * Suppress console output while keeping OTel exporters running.
   * Useful for platforms like GCP Cloud Run / AWS Lambda where stdout
   * is managed externally by the platform's log collector.
   *
   * @default false
   */
  silent?: boolean;

  /**
   * Minimum log level for internal autotel diagnostic messages.
   * Messages below this level are dropped before processing.
   *
   * @default 'info'
   */
  minLevel?: 'debug' | 'info' | 'warn' | 'error';
}
