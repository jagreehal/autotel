/**
 * OTLP exporter construction: protocol resolution, endpoint shaping, and the
 * lazy loading of the gRPC and protobuf exporters, which are optional peer
 * dependencies rather than hard ones.
 *
 * Split out of init.ts, which has no other reason to know how an exporter is
 * built. Nothing here reads autotel's configuration state.
 */

import type { SpanExporter } from '@opentelemetry/sdk-trace-base';
import type { PushMetricExporter } from '@opentelemetry/sdk-metrics';
import type { LogRecordExporter } from '@opentelemetry/sdk-logs';
import { OTLPMetricExporter as OTLPMetricExporterHTTP } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter as OTLPTraceExporterHTTP } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPLogExporter as OTLPLogExporterHTTP } from '@opentelemetry/exporter-logs-otlp-http';
import { requireModule } from './node-require';

/** The shape every OTLP exporter constructor accepts. */
export type OTLPExporterConfig = {
  url?: string;
  headers?: Record<string, string>;
  timeoutMillis?: number;
  concurrencyLimit?: number;
};

export type OtlpSignal = 'traces' | 'metrics' | 'logs';

export interface OtlpDestinationConfig {
  /**
   * Base OTLP endpoint for this destination.
   * HTTP destinations may omit `/v1/{signal}`; autotel appends it automatically.
   * gRPC destinations should point at the collector host:port.
   */
  endpoint: string;

  /**
   * Headers for this destination. Falls back to top-level `headers`.
   */
  headers?: Record<string, string> | string;

  /**
   * Protocol for this destination. Falls back to top-level `protocol`.
   */
  protocol?: AutotelProtocol;

  /**
   * Signals to send to this destination.
   * Defaults to all signals supported by the current init() config.
   */
  signals?: OtlpSignal[];
}

// Lazy-load gRPC exporters (optional peer dependencies)
/**
 * OTLP wire protocols.
 *
 * `http` is OTLP/HTTP with a JSON body; `http/protobuf` is OTLP/HTTP with a
 * protobuf body. They are not interchangeable: several vendors (Pydantic
 * Logfire, PostHog) accept protobuf only and drop JSON silently, which looks
 * exactly like emitting no telemetry at all.
 */
export type AutotelProtocol = 'http' | 'http/protobuf' | 'grpc';

let OTLPTraceExporterPROTO:
  (new (config: OTLPExporterConfig) => SpanExporter) | undefined;
let OTLPMetricExporterPROTO:
  (new (config: OTLPExporterConfig) => PushMetricExporter) | undefined;
let OTLPLogExporterPROTO:
  (new (config: OTLPExporterConfig) => LogRecordExporter) | undefined;

let OTLPTraceExporterGRPC:
  (new (config: OTLPExporterConfig) => SpanExporter) | undefined;
let OTLPMetricExporterGRPC:
  (new (config: OTLPExporterConfig) => PushMetricExporter) | undefined;
let OTLPLogExporterGRPC:
  (new (config: OTLPExporterConfig) => LogRecordExporter) | undefined;

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
      'gRPC trace exporter not found. Install @opentelemetry/exporter-trace-otlp-grpc.' +
        ' It is an optional peer dependency, and bundlers (Vercel, Nitro, esbuild) do not follow the lazy require that loads it, so add it as a direct dependency of your application, not just of autotel.',
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
      'gRPC metric exporter not found. Install @opentelemetry/exporter-metrics-otlp-grpc.' +
        ' It is an optional peer dependency, and bundlers (Vercel, Nitro, esbuild) do not follow the lazy require that loads it, so add it as a direct dependency of your application, not just of autotel.',
    );
  }
}

/**
 * Helper: Lazy-load protobuf trace exporter
 */
function loadProtoTraceExporter(): new (
  config: OTLPExporterConfig,
) => SpanExporter {
  if (OTLPTraceExporterPROTO) return OTLPTraceExporterPROTO;

  try {
    const protoModule = requireModule<{
      OTLPTraceExporter: new (config: OTLPExporterConfig) => SpanExporter;
    }>('@opentelemetry/exporter-trace-otlp-proto');
    OTLPTraceExporterPROTO = protoModule.OTLPTraceExporter;
    return OTLPTraceExporterPROTO;
  } catch {
    throw new Error(
      'Protobuf trace exporter not found. Install @opentelemetry/exporter-trace-otlp-proto.' +
        ' It is an optional peer dependency, and bundlers (Vercel, Nitro, esbuild) do not follow the lazy require that loads it, so add it as a direct dependency of your application, not just of autotel. Or drop `protocol` to use the default JSON exporter, which ships with autotel and is accepted by Grafana Cloud, Honeycomb and the other hosted OTLP gateways.',
    );
  }
}

/**
 * Helper: Create trace exporter based on protocol
 */
export function createTraceExporter(
  protocol: AutotelProtocol,
  config: OTLPExporterConfig,
): SpanExporter {
  if (protocol === 'grpc') {
    const Exporter = loadGRPCTraceExporter();
    return new Exporter(config);
  }

  if (protocol === 'http/protobuf') {
    const Exporter = loadProtoTraceExporter();
    return new Exporter(config);
  }

  // Default: HTTP with a JSON body
  return new OTLPTraceExporterHTTP(config);
}

/**
 * Helper: Create metric exporter based on protocol
 */
export function createMetricExporter(
  protocol: AutotelProtocol,
  config: OTLPExporterConfig,
): PushMetricExporter {
  if (protocol === 'grpc') {
    const Exporter = loadGRPCMetricExporter();
    return new Exporter(config);
  }

  if (protocol === 'http/protobuf') {
    if (!OTLPMetricExporterPROTO) {
      try {
        OTLPMetricExporterPROTO = requireModule<{
          OTLPMetricExporter: new (
            config: OTLPExporterConfig,
          ) => PushMetricExporter;
        }>('@opentelemetry/exporter-metrics-otlp-proto').OTLPMetricExporter;
      } catch {
        throw new Error(
          'Protobuf metric exporter not found. Install @opentelemetry/exporter-metrics-otlp-proto.' +
            ' It is an optional peer dependency, and bundlers (Vercel, Nitro, esbuild) do not follow the lazy require that loads it, so add it as a direct dependency of your application, not just of autotel. Or drop `protocol` to use the default JSON exporter, which ships with autotel and is accepted by Grafana Cloud, Honeycomb and the other hosted OTLP gateways.',
        );
      }
    }
    return new OTLPMetricExporterPROTO(config);
  }

  // Default: HTTP with a JSON body
  return new OTLPMetricExporterHTTP(config);
}

/**
 * Helper: Lazy-load gRPC log exporter
 */
function loadGRPCLogExporter(): new (
  config: OTLPExporterConfig,
) => LogRecordExporter {
  if (OTLPLogExporterGRPC) return OTLPLogExporterGRPC;

  try {
    const grpcModule = requireModule<{
      OTLPLogExporter: new (config: OTLPExporterConfig) => LogRecordExporter;
    }>('@opentelemetry/exporter-logs-otlp-grpc');
    OTLPLogExporterGRPC = grpcModule.OTLPLogExporter;
    return OTLPLogExporterGRPC;
  } catch {
    throw new Error(
      'gRPC log exporter not found. Install @opentelemetry/exporter-logs-otlp-grpc.' +
        ' It is an optional peer dependency, and bundlers (Vercel, Nitro, esbuild) do not follow the lazy require that loads it, so add it as a direct dependency of your application, not just of autotel.',
    );
  }
}

/**
 * Helper: Create log exporter based on protocol
 */
export function createLogExporter(
  protocol: AutotelProtocol,
  config: OTLPExporterConfig,
): LogRecordExporter {
  if (protocol === 'grpc') {
    const Exporter = loadGRPCLogExporter();
    return new Exporter(config);
  }

  if (protocol === 'http/protobuf') {
    if (!OTLPLogExporterPROTO) {
      try {
        OTLPLogExporterPROTO = requireModule<{
          OTLPLogExporter: new (
            config: OTLPExporterConfig,
          ) => LogRecordExporter;
        }>('@opentelemetry/exporter-logs-otlp-proto').OTLPLogExporter;
      } catch {
        throw new Error(
          'Protobuf log exporter not found. Install @opentelemetry/exporter-logs-otlp-proto.' +
            ' It is an optional peer dependency, and bundlers (Vercel, Nitro, esbuild) do not follow the lazy require that loads it, so add it as a direct dependency of your application, not just of autotel. Or drop `protocol` to use the default JSON exporter, which ships with autotel and is accepted by Grafana Cloud, Honeycomb and the other hosted OTLP gateways.',
        );
      }
    }
    return new OTLPLogExporterPROTO(config);
  }

  // Default: HTTP with a JSON body
  return new OTLPLogExporterHTTP(config);
}

/**
 * Helper: Resolve protocol from config and environment
 */
export function resolveProtocol(
  configProtocol?: AutotelProtocol,
): AutotelProtocol {
  // 1. Check config parameter (highest priority)
  if (
    configProtocol === 'grpc' ||
    configProtocol === 'http' ||
    configProtocol === 'http/protobuf'
  ) {
    return configProtocol;
  }

  // 2. Check OTEL_EXPORTER_OTLP_PROTOCOL env var
  // The spec's values are `grpc`, `http/protobuf` and `http/json`. Mapping
  // `http/protobuf` onto the JSON exporter, as this used to, silently gave
  // anyone setting the standard variable the encoding they didn't ask for.
  const envProtocol = process.env.OTEL_EXPORTER_OTLP_PROTOCOL;
  if (envProtocol === 'grpc') return 'grpc';
  if (envProtocol === 'http/protobuf') return 'http/protobuf';
  if (envProtocol === 'http/json' || envProtocol === 'http') return 'http';

  // 3. Default to HTTP
  return 'http';
}

/**
 * Helper: Adjust endpoint URL for protocol
 * gRPC exporters don't need the /v1/traces or /v1/metrics path
 * HTTP exporters need the full path
 */
export function formatEndpointUrl(
  endpoint: string,
  signal: 'traces' | 'metrics' | 'logs',
  protocol: AutotelProtocol,
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
