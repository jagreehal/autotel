/**
 * Grafana Cloud preset for autotel
 *
 * Provides a simplified configuration helper for sending traces, metrics,
 * and logs to Grafana Cloud via the OTLP gateway.
 *
 * Get your endpoint and headers from:
 * Grafana Cloud Portal → your stack → Connections → OpenTelemetry → Configure
 *
 * @example
 * ```typescript
 * import { init } from 'autotel';
 * import { createGrafanaConfig } from 'autotel-backends/grafana';
 *
 * init(createGrafanaConfig({
 *   endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT!,
 *   headers: process.env.OTEL_EXPORTER_OTLP_HEADERS,
 *   service: 'my-app',
 *   enableLogs: true,
 * }));
 * ```
 */

import { createRequire } from 'node:module';
import type { AutotelConfig } from 'autotel';
import type { LogRecordProcessor } from '@opentelemetry/sdk-logs';

/**
 * Configuration options for Grafana Cloud preset
 */
export interface GrafanaPresetConfig {
  /**
   * OTLP gateway endpoint (required).
   * From Grafana Cloud: Stack → Connections → OpenTelemetry → Configure.
   * Example: https://otlp-gateway-prod-gb-south-1.grafana.net/otlp
   */
  endpoint: string;

  /**
   * OTLP authentication headers.
   * From the same Configure tile; usually Basic auth.
   * Example: "Authorization=Basic%20BASE64_INSTANCE_ID_AND_TOKEN"
   * or object: { Authorization: 'Basic ...' }
   */
  headers?: string | Record<string, string>;

  /**
   * Service name (required).
   * Appears in Tempo, Mimir, and Loki as service_name.
   */
  service: string;

  /**
   * Deployment environment (e.g. 'production', 'staging').
   *
   * @default process.env.NODE_ENV || 'development'
   */
  environment?: string;

  /**
   * Service version for deployment tracking.
   *
   * @default process.env.OTEL_SERVICE_VERSION
   */
  version?: string;

  /**
   * Enable log export to Grafana Cloud (Loki) via OTLP.
   * When true, configures logRecordProcessors so OTel Logs API records are exported.
   *
   * @default true
   */
  enableLogs?: boolean;

  /**
   * Custom log record processors (advanced).
   * Overrides the default OTLP log processor when enableLogs is true.
   */
  logRecordProcessors?: LogRecordProcessor[];
}

function normalizeHeaders(
  headers: string | Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  if (typeof headers === 'object') return headers;
  const out: Record<string, string> = {};
  for (const pair of headers.split(',')) {
    const [key, ...valueParts] = pair.split('=');
    if (key && valueParts.length > 0) {
      let value = valueParts.join('=').trim();
      value = value.replaceAll('%20', ' ');
      out[key.trim()] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Create an autotel configuration for Grafana Cloud OTLP.
 *
 * Sends traces (Tempo), metrics (Mimir), and optionally logs (Loki) to the
 * Grafana Cloud OTLP gateway. Endpoint and headers come from the stack's
 * Connections → OpenTelemetry → Configure tile.
 *
 * @param config - Grafana Cloud configuration options
 * @returns AutotelConfig ready to pass to init()
 */
export function createGrafanaConfig(
  config: GrafanaPresetConfig,
): AutotelConfig {
  const {
    endpoint,
    headers: headersInput,
    service,
    environment,
    version,
    enableLogs = true,
    logRecordProcessors,
  } = config;

  if (!endpoint) {
    throw new Error(
      'Grafana Cloud endpoint is required. Get it from: Grafana Cloud → your stack → Connections → OpenTelemetry → Configure',
    );
  }

  const headers = normalizeHeaders(headersInput);
  const base = endpoint.replace(/\/v1\/(traces|metrics|logs)$/, '');
  const logsUrl = `${base}${base.endsWith('/') ? '' : '/'}v1/logs`;

  const result: AutotelConfig = {
    service,
    environment,
    version,
    endpoint,
    headers,
    metrics: true,
  };

  if (enableLogs) {
    if (logRecordProcessors) {
      result.logRecordProcessors = logRecordProcessors;
    } else {
      try {
        const pkgRequire = createRequire(import.meta.url);
        const { BatchLogRecordProcessor } = pkgRequire(
          '@opentelemetry/sdk-logs',
        );
        const { OTLPLogExporter } = pkgRequire(
          '@opentelemetry/exporter-logs-otlp-http',
        );
        result.logRecordProcessors = [
          new BatchLogRecordProcessor(
            new OTLPLogExporter({
              url: logsUrl,
              headers,
            }),
          ),
        ];
      } catch {
        throw new Error(
          'Log export requires @opentelemetry/sdk-logs and @opentelemetry/exporter-logs-otlp-http. ' +
            'Install them or set enableLogs: false.',
        );
      }
    }
  }

  return result;
}
