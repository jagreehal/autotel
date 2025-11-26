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
import { resolveConfigFromEnv } from './env-config';
import { loadYamlConfig } from './yaml-config.js';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { WinstonInstrumentation } from '@opentelemetry/instrumentation-winston';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';

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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const grpcModule = require('@opentelemetry/exporter-trace-otlp-grpc');
    OTLPTraceExporterGRPC = grpcModule.OTLPTraceExporter as new (
      config: OTLPExporterConfig,
    ) => SpanExporter;
    return OTLPTraceExporterGRPC;
  } catch {
    throw new Error(
      'gRPC trace exporter not found. Install with: pnpm add @opentelemetry/exporter-trace-otlp-grpc',
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const grpcModule = require('@opentelemetry/exporter-metrics-otlp-grpc');
    OTLPMetricExporterGRPC = grpcModule.OTLPMetricExporter as new (
      config: OTLPExporterConfig,
    ) => PushMetricExporter;
    return OTLPMetricExporterGRPC;
  } catch {
    throw new Error(
      'gRPC metric exporter not found. Install with: pnpm add @opentelemetry/exporter-metrics-otlp-grpc',
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

/**
 * Default silent logger (no-op) when user doesn't provide one
 */
const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

export interface AutotelConfig {
  /** Service name (required) */
  service: string;

  /** Event subscribers - bring your own (PostHog, Mixpanel, etc.) */
  subscribers?: EventSubscriber[];

  /**
   * Additional OpenTelemetry instrumentations to register.
   * Useful when you want HTTP/Prisma/etc auto instrumentation alongside
   * the functional helpers.
   *
   * **Important:** If you need custom instrumentation configs (like `requireParentSpan: false`),
   * use EITHER manual instrumentations OR integrations, not both for the same library.
   * Manual instrumentations always take precedence over auto-instrumentations.
   *
   * @example Manual instrumentations with custom config
   * ```typescript
   * import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb'
   *
   * init({
   *   service: 'my-app',
   *   integrations: false,  // Disable auto-instrumentations
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
   *   integrations: ['http', 'express'],  // Auto for these
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
   * Simple integration names for auto-instrumentation.
   * Uses @opentelemetry/auto-instrumentations-node (peer dependency).
   *
   * **Important:** If you provide manual instrumentations for the same library,
   * the manual config takes precedence and auto-instrumentation for that library is disabled.
   *
   * @example Enable all integrations (simple approach)
   * ```typescript
   * init({
   *   service: 'my-app',
   *   integrations: true  // Enable all with defaults
   * })
   * ```
   *
   * @example Enable specific integrations
   * ```typescript
   * init({
   *   service: 'my-app',
   *   integrations: ['express', 'pino', 'http']
   * })
   * ```
   *
   * @example Configure specific integrations
   * ```typescript
   * init({
   *   service: 'my-app',
   *   integrations: {
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
   *   integrations: false,  // Use manual control
   *   instrumentations: [
   *     new MongoDBInstrumentation({
   *       requireParentSpan: false  // Custom config not available with auto
   *     })
   *   ]
   * })
   * ```
   */
  integrations?: string[] | boolean | Record<string, { enabled?: boolean }>;

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
   * Headers for default OTLP exporters. Accepts either an object map or
   * a "key=value" comma separated string.
   */
  otlpHeaders?: Record<string, string> | string;

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
   * Can be overridden with AUTOTELEMETRY_METRICS=on|off env var
   */
  metrics?: boolean | 'auto';

  /** Sampling strategy (default: AdaptiveSampler with 10% baseline) */
  sampler?: Sampler;

  /** Service version (default: auto-detect from package.json or '1.0.0') */
  version?: string;

  /** Environment (default: process.env.NODE_ENV || 'development') */
  environment?: string;

  /**
   * Logger instance for structured logging with automatic trace correlation
   *
   * **Recommended:** Bring your own Pino or Winston instance
   *
   * Autotel automatically instruments Pino and Winston loggers to:
   * - Inject trace context (traceId, spanId) into every log record
   * - Record errors in the active OpenTelemetry span
   * - Bridge logs to the OpenTelemetry Logs API for OTLP export to Grafana, Datadog, etc.
   *
   * Supports any logger with 4 methods: info/warn/error/debug
   * Default: silent logger (no-op)
   *
   * @example Using Pino (recommended)
   * ```typescript
   * import pino from 'pino'  // npm install pino
   * import { init } from 'autotel'
   *
   * const logger = pino({ level: 'info' })
   * init({ service: 'my-app', logger })
   *
   * // Logs automatically include traceId/spanId and export via OTLP!
   * logger.info('User created', { userId: '123' })
   * ```
   *
   * @example Using Winston
   * ```typescript
   * import winston from 'winston'  // npm install winston
   * import { init } from 'autotel'
   *
   * const logger = winston.createLogger({
   *   level: 'info',
   *   format: winston.format.json()
   * })
   * init({ service: 'my-app', logger })
   * ```
   *
   * @example Custom logger (any logger with 4 methods)
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
   * Automatically flush events queue when root spans end
   * - true: Auto-flush on root span completion (default)
   * - false: Use batching (events flush every 10 seconds automatically)
   *
   * Only flushes on root spans to avoid excessive network calls.
   * Default is true for serverless/short-lived processes. Set to false
   * for long-running services where batching is more efficient.
   */
  autoFlushEvents?: boolean;

  /**
   * Include OpenTelemetry span flushing in auto-flush (default: false)
   *
   * When enabled, spans are force-flushed along with events events on root
   * span completion. This is useful for serverless/short-lived processes where
   * spans may not export before the process ends.
   *
   * - true: Force-flush spans on root span completion (~50-200ms latency)
   * - false: Spans export via normal batch processor (default behavior)
   *
   * Only applies when autoFlushEvents is also enabled.
   *
   * Note: For edge runtimes (Cloudflare Workers, Vercel Edge), use the
   * 'autotel-edge' package instead, which handles this automatically.
   *
   * @example Serverless with auto-flush
   * ```typescript
   * init({
   *   service: 'my-lambda',
   *   autoFlushEvents: true,
   *   autoFlush: true, // Force-flush spans
   * });
   * ```
   */
  autoFlush?: boolean;

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
   * Debug mode for local span inspection.
   * Enables console output to help you see spans as they're created.
   *
   * When true: Outputs spans to console AND sends to backend (if endpoint/exporter configured)
   * When false/undefined: Sends to backend only (default behavior)
   *
   * Perfect for progressive development:
   * - Start with debug: true (no endpoint) → console-only, see traces immediately
   * - Add endpoint later → console + backend, verify before choosing provider
   * - Remove debug in production → backend only, clean production config
   *
   * Can be overridden with AUTOLEMETRY_DEBUG environment variable.
   *
   * @example Getting started - see spans immediately
   * ```typescript
   * init({
   *   service: 'my-app',
   *   debug: true  // No endpoint yet - console only!
   * })
   * ```
   *
   * @example Testing with local collector
   * ```typescript
   * init({
   *   service: 'my-app',
   *   debug: true,
   *   endpoint: 'http://localhost:4318'  // Console + OTLP
   * })
   * ```
   *
   * @example Production debugging
   * ```typescript
   * init({
   *   service: 'my-app',
   *   debug: true,  // See what's being sent
   *   endpoint: 'https://api.honeycomb.io'
   * })
   * ```
   *
   * @example Environment variable
   * ```bash
   * AUTOLEMETRY_DEBUG=true node server.js
   * ```
   */
  debug?: boolean;

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
}

// Internal state
let initialized = false;
let config: AutotelConfig | null = null;
let sdk: NodeSDK | null = null;
let warnedOnce = false;
let logger: Logger = silentLogger;
let validationConfig: Partial<ValidationConfig> | null = null;

/**
 * Resolve metrics flag with env var override support
 */
export function resolveMetricsFlag(
  configFlag: boolean | 'auto' = 'auto',
): boolean {
  // 1. Check env var override (highest priority)
  const envFlag = process.env.AUTOTELEMETRY_METRICS;
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
 */
export function resolveDebugFlag(configFlag?: boolean): boolean {
  // 1. Check env var override (highest priority)
  const envFlag = process.env.AUTOLEMETRY_DEBUG;
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

/**
 * Auto-detect logger type and return appropriate instrumentation
 * Detects Pino and Winston loggers based on their unique properties
 */
function createLoggerInstrumentation(
  logger: Logger,
): PinoInstrumentation | WinstonInstrumentation | null {
  // Type guard: check for Pino-specific properties
  // Pino has 'child' and 'bindings' methods
  if (
    'child' in logger &&
    'bindings' in logger &&
    typeof logger.child === 'function'
  ) {
    return new PinoInstrumentation();
  }

  // Type guard: check for Winston-specific properties
  // Winston has 'transports' array or 'defaultMeta' property
  if ('transports' in logger || 'defaultMeta' in logger) {
    return new WinstonInstrumentation();
  }

  // Unknown logger type - no instrumentation
  return null;
}

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
    // Handle otlpHeaders merge (can be string or object)
    otlpHeaders:
      cfg.otlpHeaders ?? yamlConfig.otlpHeaders ?? envConfig.otlpHeaders,
  } as AutotelConfig;

  // Set logger (use provided or default to silent)
  logger = mergedConfig.logger || silentLogger;

  // Warn if re-initializing (same behavior in all environments)
  if (initialized) {
    logger.warn(
      '[autotel] init() called again - last config wins. This may cause unexpected behavior.',
    );
  }

  config = mergedConfig;
  validationConfig = mergedConfig.validation || null;

  // Initialize OpenTelemetry
  // Only use endpoint if explicitly configured (no default fallback)
  const endpoint = mergedConfig.endpoint;
  const otlpHeaders = normalizeOtlpHeaders(mergedConfig.otlpHeaders);
  const version = mergedConfig.version || detectVersion();
  const environment =
    mergedConfig.environment || process.env.NODE_ENV || 'development';
  const metricsEnabled = resolveMetricsFlag(mergedConfig.metrics);

  // Detect hostname for proper Datadog correlation and Service Catalog discovery
  const hostname = detectHostname();

  let resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: cfg.service,
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

  if (cfg.resource) {
    resource = resource.merge(cfg.resource);
  }

  if (cfg.resourceAttributes) {
    resource = resource.merge(resourceFromAttributes(cfg.resourceAttributes));
  }

  // Resolve OTLP protocol (http or grpc)
  const protocol = resolveProtocol(cfg.protocol);

  // Build array of span processors (supports multiple)
  const spanProcessors: SpanProcessor[] = [];

  if (cfg.spanProcessors && cfg.spanProcessors.length > 0) {
    // User provided custom processors (full control)
    spanProcessors.push(...cfg.spanProcessors);
  } else if (cfg.spanExporters && cfg.spanExporters.length > 0) {
    // User provided custom exporters (wrap each with tail sampling)
    for (const exporter of cfg.spanExporters) {
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
  if (cfg.baggage) {
    const prefix =
      typeof cfg.baggage === 'string'
        ? cfg.baggage
          ? `${cfg.baggage}.`
          : ''
        : 'baggage.';
    spanProcessors.push(new BaggageSpanProcessor({ prefix }));
  }

  // Apply debug mode configuration
  const debugMode = resolveDebugFlag(cfg.debug);

  if (debugMode) {
    // Debug enabled: add console processor
    spanProcessors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
  }

  // Build array of metric readers (supports multiple)
  const metricReaders: MetricReader[] = [];

  if (cfg.metricReaders && cfg.metricReaders.length > 0) {
    // User provided custom metric readers
    metricReaders.push(...cfg.metricReaders);
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
  if (cfg.logRecordProcessors && cfg.logRecordProcessors.length > 0) {
    logRecordProcessors = [...cfg.logRecordProcessors];
  }

  // Handle instrumentations: merge manual instrumentations with auto-integrations
  let finalInstrumentations: NodeSDKConfiguration['instrumentations'] =
    cfg.instrumentations ? [...cfg.instrumentations] : [];

  // Auto-enable logger instrumentation if a logger is provided
  if (cfg.logger) {
    const loggerInstrumentation = createLoggerInstrumentation(cfg.logger);
    if (loggerInstrumentation) {
      finalInstrumentations = [...finalInstrumentations, loggerInstrumentation];
      logger.debug(
        `[autotel] Auto-enabled ${loggerInstrumentation.constructor.name} for logger`,
      );
    }
  }

  if (cfg.integrations !== undefined) {
    try {
      // Detect manual instrumentations to avoid conflicts
      const manualInstrumentationNames = getInstrumentationNames(
        cfg.instrumentations ?? [],
      );

      // Warn if both integrations and manual instrumentations are provided
      if (
        manualInstrumentationNames.size > 0 &&
        cfg.integrations !== false &&
        cfg.integrations !== undefined
      ) {
        const manualNames = [...manualInstrumentationNames].join(', ');
        logger.info(
          `[autotel] Detected manual instrumentations (${manualNames}). ` +
            'These will take precedence over auto-instrumentations. ' +
            'Tip: Set integrations:false if you want full manual control, or remove manual configs to use auto-instrumentations.',
        );
      }

      const autoInstrumentations = getAutoInstrumentations(
        cfg.integrations,
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

  sdk = cfg.sdkFactory ? cfg.sdkFactory(sdkOptions) : new NodeSDK(sdkOptions);

  if (!sdk) {
    throw new Error('[autotel] sdkFactory must return a NodeSDK instance');
  }

  sdk.start();

  // Initialize OpenLLMetry if enabled (after SDK starts to reuse tracer provider)
  if (cfg.openllmetry?.enabled) {
    // Try synchronous initialization first (for require-based modules)
    let initializedSync = false;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const traceloop = require('@traceloop/node-server-sdk');
      const initOptions: Record<string, unknown> = {
        ...cfg.openllmetry.options,
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

      if (typeof traceloop.initialize === 'function') {
        traceloop.initialize(initOptions);
        logger.info('[autotel] OpenLLMetry initialized successfully');
        initializedSync = true;
      }
    } catch (error) {
      // If require fails, try async import (for ESM modules or when module not found)
      if (
        error instanceof Error &&
        (error.message.includes('Cannot find module') ||
          error.message.includes('Module not found') ||
          error.message.includes('Cannot resolve module') ||
          error.message.includes('Dynamic require'))
      ) {
        // Try async import as fallback - this will work with ESM/tsx and mocks in tests
        initializeOpenLLMetry(
          cfg.openllmetry.options,
          sdk,
          cfg.spanExporters?.[0], // Pass first exporter if available
        ).catch((error_) => {
          logger.warn(
            `[autotel] OpenLLMetry initialization error: ${error_ instanceof Error ? error_.message : String(error_)}`,
          );
        });
      } else if (!initializedSync) {
        logger.warn(
          `[autotel] Failed to initialize OpenLLMetry: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  initialized = true;
}

/**
 * Initialize OpenLLMetry integration
 * Dynamically imports @traceloop/node-server-sdk and initializes it
 * Returns a promise but can be called without awaiting (fire-and-forget)
 */
async function initializeOpenLLMetry(
  options?: Record<string, unknown>,
  sdkInstance?: NodeSDK,
  spanExporter?: SpanExporter,
): Promise<void> {
  try {
    // Try synchronous require first (for testing/mocking), then fall back to dynamic import
    let traceloop: {
      initialize?: (options?: Record<string, unknown>) => void;
      instrumentations?: unknown[];
    };

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      traceloop = require('@traceloop/node-server-sdk');
    } catch {
      // Fall back to dynamic import if require fails (ESM modules)
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - optional peer dependency
      traceloop = await import('@traceloop/node-server-sdk');
    }

    // Prepare initialization options
    const initOptions: Record<string, unknown> = {
      ...options,
    };

    // Pass span exporter to OpenLLMetry if provided
    // This ensures OpenLLMetry uses the same exporter as autotel
    if (spanExporter) {
      initOptions.exporter = spanExporter;
    }

    // Reuse autotel's tracer provider if SDK is available
    if (sdkInstance) {
      try {
        // Type assertion needed as getTracerProvider is not in the public NodeSDK interface
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tracerProvider = (sdkInstance as any).getTracerProvider();
        initOptions.tracerProvider = tracerProvider;
      } catch (error) {
        logger.debug(
          `[autotel] Could not get tracer provider for OpenLLMetry: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Initialize OpenLLMetry
    if (typeof traceloop.initialize === 'function') {
      traceloop.initialize(initOptions);
      logger.info('[autotel] OpenLLMetry initialized successfully');
    } else {
      logger.warn(
        '[autotel] OpenLLMetry initialize function not found. Check @traceloop/node-server-sdk version.',
      );
    }
  } catch (error) {
    // Gracefully handle missing dependency
    if (
      error instanceof Error &&
      (error.message.includes('Cannot find module') ||
        error.message.includes('Module not found') ||
        error.message.includes('Cannot resolve module'))
    ) {
      logger.warn(
        '[autotel] OpenLLMetry enabled but @traceloop/node-server-sdk is not installed. ' +
          'Install it as a peer dependency to use OpenLLMetry integration.',
      );
    } else {
      logger.warn(
        `[autotel] Failed to initialize OpenLLMetry: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
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
 * Warn once if not initialized (same behavior in all environments)
 */
export function warnIfNotInitialized(context: string): void {
  if (!initialized && !warnedOnce) {
    logger.warn(
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs');
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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const os = require('node:os') as typeof import('node:os');
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
