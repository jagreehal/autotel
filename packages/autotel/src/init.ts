/**
 * Simplified initialization for autotel
 *
 * Single init() function with sensible defaults.
 * Replaces initInstrumentation() and separate events config.
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import type { NodeSDKConfiguration } from '@opentelemetry/sdk-node';
import {
  BatchSpanProcessor,
  type SpanProcessor,
  SimpleSpanProcessor,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-base';
import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import {
  resourceFromAttributes,
  type Resource,
} from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import type { Sampler } from './sampling';
import { AdaptiveSampler } from './sampling';
import type { EventSubscriber } from './event-subscriber';
import type { Logger } from './logger';
import type { Attributes } from '@opentelemetry/api';
import type { ValidationConfig } from './validation';
import {
  PeriodicExportingMetricReader,
  type MetricReader,
} from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter as OTLPMetricExporterHTTP } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter as OTLPTraceExporterHTTP } from '@opentelemetry/exporter-trace-otlp-http';
import type { PushMetricExporter } from '@opentelemetry/sdk-metrics';
import type { LogRecordProcessor } from '@opentelemetry/sdk-logs';
import { TailSamplingSpanProcessor } from './tail-sampling-processor';
import { BaggageSpanProcessor } from './baggage-span-processor';
import {
  FilteringSpanProcessor,
  type SpanFilterPredicate,
} from './filtering-span-processor';
import {
  SpanNameNormalizingProcessor,
  type SpanNameNormalizerConfig,
} from './span-name-normalizer';
import {
  AttributeRedactingProcessor,
  type AttributeRedactorConfig,
  type AttributeRedactorPreset,
} from './attribute-redacting-processor';
import { PrettyConsoleExporter } from './pretty-console-exporter';
import { resolveConfigFromEnv } from './env-config';
import { loadYamlConfig } from './yaml-config';
import { requireModule, safeRequire } from './node-require';
import {
  CanonicalLogLineProcessor,
  type CanonicalLogLineOptions,
} from './processors/canonical-log-line-processor';
import type { EventsConfig } from './events-config';

/**
 * Silent logger (no-op) - used as default when user doesn't provide one.
 * Internal autotel logs are silent by default to avoid spam.
 * Users can import { autotelLogger } from 'autotel/logger' to create their own.
 */
const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

// Type imports for exporters
type OTLPExporterConfig = {
  url?: string;
  headers?: Record<string, string>;
  timeoutMillis?: number;
  concurrencyLimit?: number;
};

// Lazy-load gRPC exporters (optional peer dependencies)
let OTLPTraceExporterGRPC:
  | (new (config: OTLPExporterConfig) => SpanExporter)
  | undefined;
let OTLPMetricExporterGRPC:
  | (new (config: OTLPExporterConfig) => PushMetricExporter)
  | undefined;

/**
 * Helper: Lazy-load gRPC trace exporter
 */
function loadGRPCTraceExporter(): new (
  config: OTLPExporterConfig,
) => SpanExporter {
  if (OTLPTraceExporterGRPC) return OTLPTraceExporterGRPC;

  try {
    // Dynamic import for optional peer dependency
    const grpcModule = requireModule<{
      OTLPTraceExporter: new (config: OTLPExporterConfig) => SpanExporter;
    }>('@opentelemetry/exporter-trace-otlp-grpc');
    OTLPTraceExporterGRPC = grpcModule.OTLPTraceExporter;
    return OTLPTraceExporterGRPC;
  } catch {
    throw new Error(
      'gRPC trace exporter not found. Install @opentelemetry/exporter-trace-otlp-grpc',
    );
  }
}

/**
 * Helper: Lazy-load gRPC metric exporter
 */
function loadGRPCMetricExporter(): new (
  config: OTLPExporterConfig,
) => PushMetricExporter {
  if (OTLPMetricExporterGRPC) return OTLPMetricExporterGRPC;

  try {
    // Dynamic import for optional peer dependency
    const grpcModule = requireModule<{
      OTLPMetricExporter: new (
        config: OTLPExporterConfig,
      ) => PushMetricExporter;
    }>('@opentelemetry/exporter-metrics-otlp-grpc');
    OTLPMetricExporterGRPC = grpcModule.OTLPMetricExporter;
    return OTLPMetricExporterGRPC;
  } catch {
    throw new Error(
      'gRPC metric exporter not found. Install @opentelemetry/exporter-metrics-otlp-grpc',
    );
  }
}

/**
 * Helper: Create trace exporter based on protocol
 */
function createTraceExporter(
  protocol: 'http' | 'grpc',
  config: OTLPExporterConfig,
): SpanExporter {
  if (protocol === 'grpc') {
    const Exporter = loadGRPCTraceExporter();
    return new Exporter(config);
  }

  // Default: HTTP
  return new OTLPTraceExporterHTTP(config);
}

/**
 * Helper: Create metric exporter based on protocol
 */
function createMetricExporter(
  protocol: 'http' | 'grpc',
  config: OTLPExporterConfig,
): PushMetricExporter {
  if (protocol === 'grpc') {
    const Exporter = loadGRPCMetricExporter();
    return new Exporter(config);
  }

  // Default: HTTP
  return new OTLPMetricExporterHTTP(config);
}

/**
 * Helper: Resolve protocol from config and environment
 */
function resolveProtocol(configProtocol?: 'http' | 'grpc'): 'http' | 'grpc' {
  // 1. Check config parameter (highest priority)
  if (configProtocol === 'grpc' || configProtocol === 'http') {
    return configProtocol;
  }

  // 2. Check OTEL_EXPORTER_OTLP_PROTOCOL env var
  const envProtocol = process.env.OTEL_EXPORTER_OTLP_PROTOCOL;
  if (envProtocol === 'grpc') return 'grpc';
  if (envProtocol === 'http/protobuf' || envProtocol === 'http') return 'http';

  // 3. Default to HTTP
  return 'http';
}

/**
 * Helper: Adjust endpoint URL for protocol
 * gRPC exporters don't need the /v1/traces or /v1/metrics path
 * HTTP exporters need the full path
 */
function formatEndpointUrl(
  endpoint: string,
  signal: 'traces' | 'metrics',
  protocol: 'http' | 'grpc',
): string {
  if (protocol === 'grpc') {
    // gRPC: strip any paths, return base endpoint
    return endpoint.replace(/\/(v1\/)?(traces|metrics|logs)$/, '');
  }

  // HTTP: append signal path if not present
  if (!endpoint.endsWith(`/v1/${signal}`)) {
    return `${endpoint}/v1/${signal}`;
  }

  return endpoint;
}

// Built-in logger is created dynamically in init() with service name

export interface AutotelConfig {
  /** Service name (required) */
  service: string;

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
    | string[]
    | boolean
    | Record<string, { enabled?: boolean }>;

  /**
   * OTLP endpoint for traces/metrics/logs
   * Only used if you don't provide custom exporters/processors
   * @default process.env.OTLP_ENDPOINT || 'http://localhost:4318'
   */
  endpoint?: string;

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
   * Custom log record processors. When omitted, logs are not configured.
   */
  logRecordProcessors?: LogRecordProcessor[];

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
  protocol?: 'http' | 'grpc';

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

  /** Sampling strategy (default: AdaptiveSampler with 10% baseline) */
  sampler?: Sampler;

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
   * Can be a preset name or custom configuration:
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
  attributeRedactor?: AttributeRedactorConfig | AttributeRedactorPreset;

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

  /**
   * Canonical log lines - automatically emit spans as wide events (canonical log lines)
   *
   * When enabled, each span (or root span only) is automatically emitted as a
   * comprehensive log record with ALL span attributes. This implements the
   * "canonical log line" pattern: one comprehensive event per request with all context.
   *
   * **Benefits:**
   * - One log line per request with all context (wide event)
   * - High-cardinality, high-dimensionality data for powerful queries
   * - Automatic - no manual logging needed
   * - Queryable as structured data instead of string search
   *
   * @example Basic usage (one canonical log line per request)
   * ```typescript
   * init({
   *   service: 'checkout-api',
   *   canonicalLogLines: {
   *     enabled: true,
   *     rootSpansOnly: true, // One canonical log line per request
   *   },
   * });
   * ```
   *
   * @example With custom logger
   * ```typescript
   * import pino from 'pino';
   * const logger = pino();
   * init({
   *   service: 'my-app',
   *   logger,
   *   canonicalLogLines: {
   *     enabled: true,
   *     logger, // Use Pino for canonical log lines
   *     rootSpansOnly: true,
   *   },
   * });
   * ```
   *
   * @example Custom message format
   * ```typescript
   * init({
   *   service: 'my-app',
   *   canonicalLogLines: {
   *     enabled: true,
   *     messageFormat: (span) => {
   *       const status = span.status.code === 2 ? 'ERROR' : 'SUCCESS';
   *       return `${span.name} [${status}]`;
   *     },
   *   },
   * });
   * ```
   */
  canonicalLogLines?: {
    enabled: boolean;
    /** Logger to use for emitting canonical log lines (defaults to OTel Logs API) */
    logger?: Logger;
    /** Only emit canonical log lines for root spans (default: false) */
    rootSpansOnly?: boolean;
    /** Minimum log level for canonical log lines (default: 'info') */
    minLevel?: 'debug' | 'info' | 'warn' | 'error';
    /** Custom message format (default: uses span name) */
    messageFormat?: (
      span: import('@opentelemetry/sdk-trace-base').ReadableSpan,
    ) => string;
    /** Whether to include resource attributes (default: true) */
    includeResourceAttributes?: boolean;
  };
}

// Internal state
let initialized = false;
let config: AutotelConfig | null = null;
let sdk: NodeSDK | null = null;
let warnedOnce = false;
let logger: Logger = silentLogger; // Silent by default - no spam
let validationConfig: Partial<ValidationConfig> | null = null;
let eventsConfig: EventsConfig | null = null;

/**
 * Resolve metrics flag with env var override support
 */
export function resolveMetricsFlag(
  configFlag: boolean | 'auto' = 'auto',
): boolean {
  // 1. Check env var override (highest priority)
  const envFlag = process.env.AUTOTEL_METRICS;
  if (envFlag === 'on' || envFlag === 'true') return true;
  if (envFlag === 'off' || envFlag === 'false') return false;

  // 2. Check config flag
  if (configFlag === true) return true;
  if (configFlag === false) return false;

  // 3. Default: enabled in all environments (simpler)
  return true;
}

/**
 * Resolve debug flag with env var override support
 *
 * Supports:
 * - `'pretty'`: Colorized, hierarchical output (PrettyConsoleExporter)
 * - `true` / `'true'` / `'1'`: Raw JSON output (ConsoleSpanExporter)
 * - `false` / `'false'` / `'0'`: Disabled
 */
export function resolveDebugFlag(
  configFlag?: boolean | 'pretty',
): boolean | 'pretty' {
  // 1. Check env var override (highest priority)
  const envFlag = process.env.AUTOTEL_DEBUG;
  if (envFlag === 'pretty') return 'pretty';
  if (envFlag === 'true' || envFlag === '1') return true;
  if (envFlag === 'false' || envFlag === '0') return false;

  // 2. Return config flag (defaults to false)
  return configFlag ?? false;
}

function normalizeOtlpHeaders(
  headers?: Record<string, string> | string,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  if (typeof headers !== 'string') return headers;

  const parsed: Record<string, string> = {};
  for (const pair of headers.split(',')) {
    const [key, ...valueParts] = pair.split('=');
    if (!key || valueParts.length === 0) continue;
    parsed[key.trim()] = valueParts.join('=').trim();
  }
  return parsed;
}

/**
 * Initialize autotel - Write Once, Observe Everywhere
 *
 * Follows OpenTelemetry standards: opinionated defaults with full flexibility
 * Idempotent: multiple calls are safe, last one wins
 *
 * @example Minimal setup (OTLP default)
 * ```typescript
 * init({ service: 'my-app' })
 * ```
 *
 * @example With events (observe in PostHog, Mixpanel, etc.)
 * ```typescript
 * import { PostHogSubscriber } from 'autotel-subscribers/posthog';
 *
 * init({
 *   service: 'my-app',
 *   subscribers: [new PostHogSubscriber({ apiKey: '...' })]
 * })
 * ```
 *
 * @example Observe in Jaeger
 * ```typescript
 * import { JaegerExporter } from '@opentelemetry/exporter-jaeger'
 *
 * init({
 *   service: 'my-app',
 *   spanExporter: new JaegerExporter({ endpoint: 'http://localhost:14268/api/traces' })
 * })
 * ```
 *
 * @example Observe in Zipkin
 * ```typescript
 * import { ZipkinExporter } from '@opentelemetry/exporter-zipkin'
 *
 * init({
 *   service: 'my-app',
 *   spanExporter: new ZipkinExporter({ url: 'http://localhost:9411/api/v2/spans' })
 * })
 * ```
 *
 * @example Observe in Datadog
 * ```typescript
 * import { DatadogSpanProcessor } from '@opentelemetry/exporter-datadog'
 *
 * init({
 *   service: 'my-app',
 *   spanProcessor: new DatadogSpanProcessor({ ... })
 * })
 * ```
 *
 * @example Console output (dev)
 * ```typescript
 * import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
 *
 * init({
 *   service: 'my-app',
 *   spanProcessor: new SimpleSpanProcessor(new ConsoleSpanExporter())
 * })
 * ```
 */

export function init(cfg: AutotelConfig): void {
  // Resolve configs in priority order: explicit > yaml > env > defaults
  const envConfig = resolveConfigFromEnv();
  const yamlConfig = loadYamlConfig() ?? {};

  // Merge configs: explicit config > yaml file > env vars > defaults
  const mergedConfig: AutotelConfig = {
    ...envConfig, // Environment variables (lowest priority)
    ...yamlConfig, // YAML file (middle priority)
    ...cfg, // Explicit config (highest priority)
    // Deep merge for resourceAttributes
    resourceAttributes: {
      ...envConfig.resourceAttributes,
      ...yamlConfig.resourceAttributes,
      ...cfg.resourceAttributes,
    },
    // Handle headers merge (can be string or object)
    headers: cfg.headers ?? yamlConfig.headers ?? envConfig.headers,
  } as AutotelConfig;

  // Set logger (use provided or default to silent - no spam)
  logger = mergedConfig.logger || silentLogger;

  // Warn if re-initializing (same behavior in all environments)
  if (initialized) {
    logger.warn(
      {},
      '[autotel] init() called again - last config wins. This may cause unexpected behavior.',
    );
  }

  config = mergedConfig;
  validationConfig = mergedConfig.validation || null;
  eventsConfig = mergedConfig.events || null;

  // Initialize OpenTelemetry
  // Only use endpoint if explicitly configured (no default fallback)
  const endpoint = mergedConfig.endpoint;
  const otlpHeaders = normalizeOtlpHeaders(mergedConfig.headers);
  const version = mergedConfig.version || detectVersion();
  const environment =
    mergedConfig.environment || process.env.NODE_ENV || 'development';
  const metricsEnabled = resolveMetricsFlag(mergedConfig.metrics);

  // Detect hostname for proper Datadog correlation and Service Catalog discovery
  const hostname = detectHostname();

  let resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: mergedConfig.service,
    [ATTR_SERVICE_VERSION]: version,
    // Support both old and new OpenTelemetry semantic conventions for environment
    'deployment.environment': environment, // Deprecated but widely supported
    'deployment.environment.name': environment, // OTel v1.27.0+ standard
  });

  // Add hostname attributes for Datadog Service Catalog and infrastructure correlation
  if (hostname) {
    resource = resource.merge(
      resourceFromAttributes({
        'host.name': hostname, // OpenTelemetry standard
        'datadog.host.name': hostname, // Datadog-specific, highest priority for Datadog
      }),
    );
  }

  if (mergedConfig.resource) {
    resource = resource.merge(mergedConfig.resource);
  }

  if (mergedConfig.resourceAttributes) {
    resource = resource.merge(
      resourceFromAttributes(mergedConfig.resourceAttributes),
    );
  }

  // Resolve OTLP protocol (http or grpc)
  const protocol = resolveProtocol(mergedConfig.protocol);

  // Build array of span processors (supports multiple)
  let spanProcessors: SpanProcessor[] = [];

  if (mergedConfig.spanProcessors && mergedConfig.spanProcessors.length > 0) {
    // User provided custom processors (full control)
    spanProcessors.push(...mergedConfig.spanProcessors);
  } else if (
    mergedConfig.spanExporters &&
    mergedConfig.spanExporters.length > 0
  ) {
    // User provided custom exporters (wrap each with tail sampling)
    for (const exporter of mergedConfig.spanExporters) {
      spanProcessors.push(
        new TailSamplingSpanProcessor(new BatchSpanProcessor(exporter)),
      );
    }
  } else if (endpoint) {
    // Default: OTLP with tail sampling (only if endpoint is configured)
    const traceExporter = createTraceExporter(protocol, {
      url: formatEndpointUrl(endpoint, 'traces', protocol),
      headers: otlpHeaders,
    });

    spanProcessors.push(
      new TailSamplingSpanProcessor(new BatchSpanProcessor(traceExporter)),
    );
  }
  // If no endpoint and no custom processors/exporters, array remains empty
  // SDK will still work but won't export traces

  // Add baggage span processor if enabled
  if (mergedConfig.baggage) {
    const prefix =
      typeof mergedConfig.baggage === 'string'
        ? mergedConfig.baggage
          ? `${mergedConfig.baggage}.`
          : ''
        : 'baggage.';
    spanProcessors.push(new BaggageSpanProcessor({ prefix }));
  }

  // Apply debug mode configuration
  const debugMode = resolveDebugFlag(mergedConfig.debug);

  if (debugMode === 'pretty') {
    // Pretty debug: colorized, hierarchical output
    spanProcessors.push(new SimpleSpanProcessor(new PrettyConsoleExporter()));
  } else if (debugMode === true) {
    // Raw debug: JSON output
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  // Add canonical log line processor BEFORE wrapping processors
  // This ensures it gets wrapped with the same filter/normalizer/redactor as other processors,
  // so canonical logs respect spanFilter (filtered spans aren't logged), spanNameNormalizer
  // (normalized names are used), and attributeRedactor (sensitive data is redacted).
  if (mergedConfig.canonicalLogLines?.enabled) {
    const canonicalOptions: CanonicalLogLineOptions = {
      logger: mergedConfig.canonicalLogLines.logger || mergedConfig.logger,
      rootSpansOnly: mergedConfig.canonicalLogLines.rootSpansOnly,
      minLevel: mergedConfig.canonicalLogLines.minLevel,
      messageFormat: mergedConfig.canonicalLogLines.messageFormat,
      includeResourceAttributes:
        mergedConfig.canonicalLogLines.includeResourceAttributes,
    };
    spanProcessors.push(new CanonicalLogLineProcessor(canonicalOptions));
  }

  // Wrap processors in order: redactor (innermost) → normalizer → filter (outermost)
  // This ensures onEnd() execution order is: filter → normalizer → redactor
  // So filtering sees original attributes, and redaction happens last before export.

  // Step 1: Wrap with AttributeRedactingProcessor (innermost - executes last in onEnd)
  if (mergedConfig.attributeRedactor && spanProcessors.length > 0) {
    spanProcessors = spanProcessors.map(
      (processor) =>
        new AttributeRedactingProcessor(processor, {
          redactor: mergedConfig.attributeRedactor!,
        }),
    );
  }

  // Step 2: Wrap with SpanNameNormalizingProcessor (middle)
  // Normalizer runs in onStart(), so span names are normalized before any onEnd processing
  if (mergedConfig.spanNameNormalizer && spanProcessors.length > 0) {
    spanProcessors = spanProcessors.map(
      (processor) =>
        new SpanNameNormalizingProcessor(processor, {
          normalizer: mergedConfig.spanNameNormalizer!,
        }),
    );
  }

  // Step 3: Wrap with FilteringSpanProcessor (outermost - executes first in onEnd)
  // Filter sees original (unredacted) attributes, so it can match on sensitive values
  if (mergedConfig.spanFilter && spanProcessors.length > 0) {
    spanProcessors = spanProcessors.map(
      (processor) =>
        new FilteringSpanProcessor(processor, {
          filter: mergedConfig.spanFilter!,
        }),
    );
  }

  // Build array of metric readers (supports multiple)
  const metricReaders: MetricReader[] = [];

  if (mergedConfig.metricReaders && mergedConfig.metricReaders.length > 0) {
    // User provided custom metric readers
    metricReaders.push(...mergedConfig.metricReaders);
  } else if (metricsEnabled && endpoint) {
    // Default: OTLP metrics exporter (only if endpoint is configured)
    const metricExporter = createMetricExporter(protocol, {
      url: formatEndpointUrl(endpoint, 'metrics', protocol),
      headers: otlpHeaders,
    });

    metricReaders.push(
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
      }),
    );
  }

  let logRecordProcessors: LogRecordProcessor[] | undefined;
  if (
    mergedConfig.logRecordProcessors &&
    mergedConfig.logRecordProcessors.length > 0
  ) {
    logRecordProcessors = [...mergedConfig.logRecordProcessors];
  }

  // Handle instrumentations: merge manual instrumentations with auto-instrumentations
  let finalInstrumentations: NodeSDKConfiguration['instrumentations'] =
    mergedConfig.instrumentations ? [...mergedConfig.instrumentations] : [];

  if (
    mergedConfig.autoInstrumentations !== undefined &&
    mergedConfig.autoInstrumentations !== false
  ) {
    // Check for ESM mode and provide guidance
    const isESM = isESMMode();
    if (isESM) {
      logger.info(
        {},
        '[autotel] ESM mode detected. For auto-instrumentation to work:\n' +
          '  1. Install @opentelemetry/auto-instrumentations-node as a direct dependency\n' +
          '  2. Import autotel/register FIRST in your instrumentation file\n' +
          '  3. Use getNodeAutoInstrumentations() directly instead of autoInstrumentations\n' +
          '  See: https://github.com/jagreehal/autotel#esm-setup',
      );
    }

    try {
      // Detect manual instrumentations to avoid conflicts
      const manualInstrumentationNames = getInstrumentationNames(
        mergedConfig.instrumentations ?? [],
      );

      // Warn if both autoInstrumentations and manual instrumentations are provided
      if (manualInstrumentationNames.size > 0) {
        const manualNames = [...manualInstrumentationNames].join(', ');
        logger.info(
          {},
          `[autotel] Detected manual instrumentations (${manualNames}). ` +
            'These will take precedence over auto-instrumentations. ' +
            'Tip: Set autoInstrumentations:false if you want full manual control, or remove manual configs to use auto-instrumentations.',
        );
      }

      const autoInstrumentations = getAutoInstrumentations(
        mergedConfig.autoInstrumentations,
        manualInstrumentationNames,
      );
      if (autoInstrumentations && autoInstrumentations.length > 0) {
        // Cast to proper type - getNodeAutoInstrumentations returns the correct type
        finalInstrumentations = [
          ...finalInstrumentations,
          ...(autoInstrumentations as NodeSDKConfiguration['instrumentations']),
        ];
      }
    } catch (error) {
      logger.warn(
        {},
        `[autotel] Failed to configure auto-instrumentations: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const sdkOptions: Partial<NodeSDKConfiguration> = {
    resource,
    instrumentations: finalInstrumentations,
  };

  if (spanProcessors.length > 0) {
    sdkOptions.spanProcessors = spanProcessors;
  }

  if (metricReaders.length > 0) {
    sdkOptions.metricReaders = metricReaders;
  }

  if (logRecordProcessors && logRecordProcessors.length > 0) {
    sdkOptions.logRecordProcessors = logRecordProcessors;
  }

  sdk = mergedConfig.sdkFactory
    ? mergedConfig.sdkFactory(sdkOptions)
    : new NodeSDK(sdkOptions);

  if (!sdk) {
    throw new Error('[autotel] sdkFactory must return a NodeSDK instance');
  }

  sdk.start();

  // Initialize OpenLLMetry if enabled (after SDK starts to reuse tracer provider)
  if (mergedConfig.openllmetry?.enabled) {
    const traceloop = safeRequire<{
      initialize?: (options?: Record<string, unknown>) => void;
    }>('@traceloop/node-server-sdk');

    if (traceloop) {
      const initOptions: Record<string, unknown> = {
        ...mergedConfig.openllmetry.options,
      };

      // Reuse autotel's tracer provider
      try {
        // Type assertion needed as getTracerProvider is not in the public NodeSDK interface
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tracerProvider = (sdk as any).getTracerProvider();
        initOptions.tracerProvider = tracerProvider;
      } catch {
        // Ignore if tracer provider not available
      }

      // Pass span exporter to OpenLLMetry if provided
      if (mergedConfig.spanExporters?.[0]) {
        initOptions.exporter = mergedConfig.spanExporters[0];
      }

      if (typeof traceloop.initialize === 'function') {
        traceloop.initialize(initOptions);
        logger.info({}, '[autotel] OpenLLMetry initialized successfully');
      } else {
        logger.warn(
          {},
          '[autotel] OpenLLMetry initialize function not found. Check @traceloop/node-server-sdk version.',
        );
      }
    } else {
      logger.warn(
        {},
        '[autotel] OpenLLMetry enabled but @traceloop/node-server-sdk is not installed. ' +
          'Install it as a peer dependency to use OpenLLMetry integration.',
      );
    }
  }

  initialized = true;
}

/**
 * Extract instrumentation class names from instrumentation instances
 * Used to detect duplicates between manual and auto instrumentations
 */
function getInstrumentationNames(
  instrumentations: NodeSDKConfiguration['instrumentations'],
): Set<string> {
  const names = new Set<string>();

  if (!instrumentations) return names;

  for (const instrumentation of instrumentations) {
    if (instrumentation && typeof instrumentation === 'object') {
      names.add(instrumentation.constructor.name);
    }
  }

  return names;
}

/**
 * Map common instrumentation class names to their package names
 * Used to disable auto-instrumentations when user provides manual configs
 */
const INSTRUMENTATION_CLASS_TO_PACKAGE: Record<string, string> = {
  HttpInstrumentation: '@opentelemetry/instrumentation-http',
  HttpsInstrumentation: '@opentelemetry/instrumentation-http',
  ExpressInstrumentation: '@opentelemetry/instrumentation-express',
  FastifyInstrumentation: '@opentelemetry/instrumentation-fastify',
  MongoDBInstrumentation: '@opentelemetry/instrumentation-mongodb',
  MongooseInstrumentation: '@opentelemetry/instrumentation-mongoose',
  PrismaInstrumentation: '@opentelemetry/instrumentation-prisma',
  PinoInstrumentation: '@opentelemetry/instrumentation-pino',
  WinstonInstrumentation: '@opentelemetry/instrumentation-winston',
  RedisInstrumentation: '@opentelemetry/instrumentation-redis',
  GraphQLInstrumentation: '@opentelemetry/instrumentation-graphql',
  GrpcInstrumentation: '@opentelemetry/instrumentation-grpc',
  IORedisInstrumentation: '@opentelemetry/instrumentation-ioredis',
  KnexInstrumentation: '@opentelemetry/instrumentation-knex',
  NestJsInstrumentation: '@opentelemetry/instrumentation-nestjs-core',
  PgInstrumentation: '@opentelemetry/instrumentation-pg',
  MySQLInstrumentation: '@opentelemetry/instrumentation-mysql',
  MySQL2Instrumentation: '@opentelemetry/instrumentation-mysql2',
};

/**
 * Type for the auto-instrumentations loader function
 * @internal Used for testing injection
 */
export type AutoInstrumentationsLoader = (
  config?: Record<string, { enabled?: boolean }>,
) => unknown[];

/**
 * Detect if we're running in ESM mode
 */
function isESMMode(): boolean {
  // Check if we're in an ESM context by looking for common ESM indicators
  try {
    // In ESM, module.exports doesn't exist in the global scope the same way
    // Also check if the package.json type is "module"
    const fs = requireModule<typeof import('node:fs')>('node:fs');
    try {
      const pkg = JSON.parse(
        fs.readFileSync(`${process.cwd()}/package.json`, 'utf8'),
      );
      return pkg.type === 'module';
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

/**
 * Lazy-load auto-instrumentations (optional peer dependency)
 * Only loads when integrations config is truthy, avoiding ~40+ package imports at startup.
 */
function loadNodeAutoInstrumentations(): AutoInstrumentationsLoader {
  try {
    const mod = requireModule<{
      getNodeAutoInstrumentations: AutoInstrumentationsLoader;
    }>('@opentelemetry/auto-instrumentations-node');
    return mod.getNodeAutoInstrumentations;
  } catch {
    const isESM = isESMMode();
    const baseMessage = '@opentelemetry/auto-instrumentations-node not found.';

    if (isESM) {
      throw new Error(
        `${baseMessage}\n\n` +
          'ESM Setup Required:\n' +
          '1. Install as a direct dependency: pnpm add @opentelemetry/auto-instrumentations-node\n' +
          '2. Create instrumentation.mjs with:\n' +
          "   import 'autotel/register';  // MUST be first!\n" +
          "   import { init } from 'autotel';\n" +
          "   import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';\n" +
          '   init({ service: "my-app", instrumentations: getNodeAutoInstrumentations() });\n' +
          '3. Run with: tsx --import ./instrumentation.mjs src/index.ts\n\n' +
          'See: https://github.com/jagreehal/autotel#esm-setup',
      );
    }

    throw new Error(
      `${baseMessage} Install it: pnpm add @opentelemetry/auto-instrumentations-node`,
    );
  }
}

/**
 * Injectable loader for testing. Set to override the default loader.
 * @internal
 */
let _autoInstrumentationsLoader: (() => AutoInstrumentationsLoader) | null =
  null;

/**
 * @internal Set custom loader (for testing)
 */
export function _setAutoInstrumentationsLoader(
  loader: (() => AutoInstrumentationsLoader) | null,
): void {
  _autoInstrumentationsLoader = loader;
}

/**
 * @internal Reset loader to default (for testing cleanup)
 */
export function _resetAutoInstrumentationsLoader(): void {
  _autoInstrumentationsLoader = null;
}

/**
 * Get auto-instrumentations based on simple integration names
 * Excludes instrumentations that are manually provided to avoid conflicts
 */
function getAutoInstrumentations(
  integrations: string[] | boolean | Record<string, { enabled?: boolean }>,
  manualInstrumentationNames: Set<string> = new Set(),
): unknown[] {
  if (integrations === false) {
    return [];
  }

  // Use injected loader if set (for testing), otherwise lazy-load
  const getNodeAutoInstrumentations = _autoInstrumentationsLoader
    ? _autoInstrumentationsLoader()
    : loadNodeAutoInstrumentations();

  // Build exclusion config for manual instrumentations
  const exclusionConfig: Record<string, { enabled: boolean }> = {};
  for (const className of manualInstrumentationNames) {
    const packageName = INSTRUMENTATION_CLASS_TO_PACKAGE[className];
    if (packageName) {
      exclusionConfig[packageName] = { enabled: false };
    }
  }

  if (integrations === true) {
    // If exclusions exist, pass them to getNodeAutoInstrumentations
    if (Object.keys(exclusionConfig).length > 0) {
      return getNodeAutoInstrumentations(exclusionConfig);
    }
    return getNodeAutoInstrumentations();
  }

  if (Array.isArray(integrations)) {
    const config: Record<string, { enabled: boolean }> = { ...exclusionConfig };
    for (const name of integrations) {
      const packageName = `@opentelemetry/instrumentation-${name}`;
      // Don't override exclusions
      if (!exclusionConfig[packageName]) {
        config[packageName] = { enabled: true };
      }
    }
    return getNodeAutoInstrumentations(config);
  }

  const config: Record<string, { enabled?: boolean }> = {
    ...exclusionConfig,
    ...integrations,
  };

  // Override any integrations that conflict with manual instrumentations
  for (const packageName of Object.keys(exclusionConfig)) {
    const integrationsKey = Object.keys(integrations).find((key) =>
      packageName.includes(key),
    );
    if (integrationsKey) {
      // Manual instrumentation takes precedence
      config[packageName] = { enabled: false };
    }
  }

  return getNodeAutoInstrumentations(config);
}

/**
 * Check if autotel has been initialized
 */
export function isInitialized(): boolean {
  return initialized;
}

/**
 * Get current config (internal use)
 */
export function getConfig(): AutotelConfig | null {
  return config;
}

/**
 * Get current logger (internal use)
 */
export function getLogger(): Logger {
  return logger;
}

/**
 * Get validation config (internal use)
 */
export function getValidationConfig(): Partial<ValidationConfig> | null {
  return validationConfig;
}

/**
 * Get events config (internal use)
 */
export function getEventsConfig(): EventsConfig | null {
  return eventsConfig;
}

/**
 * Warn once if not initialized (same behavior in all environments)
 */
export function warnIfNotInitialized(context: string): void {
  if (!initialized && !warnedOnce) {
    logger.warn(
      {},
      `[autotel] ${context} used before init() called. ` +
        'Call init({ service: "..." }) first. See: https://docs.autotel.dev/quickstart',
    );
    warnedOnce = true;
  }
}

/**
 * Get default sampler
 */
export function getDefaultSampler(): Sampler {
  return (
    config?.sampler ||
    new AdaptiveSampler({
      baselineSampleRate: 0.1,
      alwaysSampleErrors: true,
      alwaysSampleSlow: true,
    })
  );
}

/**
 * Auto-detect version from package.json
 */
function detectVersion(): string {
  try {
    // Try to read package.json from cwd using fs
    const fs = requireModule<typeof import('node:fs')>('node:fs');
    const pkg = JSON.parse(
      fs.readFileSync(`${process.cwd()}/package.json`, 'utf8'),
    );
    return pkg.version || '1.0.0';
  } catch {
    return '1.0.0';
  }
}

/**
 * Detect hostname for resource attributes.
 * Supports Datadog conventions (DD_HOSTNAME) and falls back to system hostname.
 *
 * Priority order:
 * 1. DD_HOSTNAME environment variable (Datadog convention)
 * 2. HOSTNAME environment variable (common Unix convention)
 * 3. os.hostname() (system hostname)
 *
 * @returns hostname string or undefined if detection fails
 */
function detectHostname(): string | undefined {
  // Priority 1: DD_HOSTNAME (Datadog convention)
  if (process.env.DD_HOSTNAME) {
    return process.env.DD_HOSTNAME;
  }

  // Priority 2: HOSTNAME (common in containers and Unix systems)
  if (process.env.HOSTNAME) {
    return process.env.HOSTNAME;
  }

  // Priority 3: System hostname
  try {
    const os = requireModule<typeof import('node:os')>('node:os');
    return os.hostname();
  } catch {
    // os module not available (edge runtime, browser, etc.)
    return undefined;
  }
}

/**
 * Get SDK instance (for shutdown)
 */
export function getSdk(): NodeSDK | null {
  return sdk;
}
