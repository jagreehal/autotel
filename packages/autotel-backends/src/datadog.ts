/**
 * Datadog preset for autotel
 *
 * Provides a simplified configuration helper for Datadog integration
 * with best practices built-in.
 *
 * @example Direct cloud ingestion (serverless, edge)
 * ```typescript
 * import { init } from 'autotel';
 * import { createDatadogConfig } from 'autotel-backends/datadog';
 *
 * init(createDatadogConfig({
 *   apiKey: process.env.DATADOG_API_KEY!,
 *   service: 'my-lambda',
 *   enableLogs: true,
 * }));
 * ```
 *
 * @example Local Datadog Agent (long-running services, Kubernetes)
 * ```typescript
 * import { init } from 'autotel';
 * import { createDatadogConfig } from 'autotel-backends/datadog';
 *
 * init(createDatadogConfig({
 *   service: 'my-api',
 *   useAgent: true,  // No API key needed - Agent handles it
 * }));
 * ```
 */

import { createRequire } from 'node:module';
import type { AutotelConfig } from 'autotel';
import type { LogRecordProcessor } from '@opentelemetry/sdk-logs';

/**
 * Datadog site regions
 */
export type DatadogSite =
  | 'datadoghq.com' // US1 (default)
  | 'datadoghq.eu' // EU
  | 'us3.datadoghq.com' // US3
  | 'us5.datadoghq.com' // US5
  | 'ap1.datadoghq.com' // AP1
  | 'ddog-gov.com'; // US1-FED

/**
 * Configuration options for Datadog preset
 */
export interface DatadogPresetConfig {
  /**
   * Datadog API key (required for direct cloud ingestion).
   * Not needed if using local Datadog Agent (useAgent: true).
   *
   * Get your API key from:
   * https://app.datadoghq.com/organization-settings/api-keys
   */
  apiKey?: string;

  /**
   * Datadog site/region.
   * Determines which Datadog intake endpoint to use.
   *
   * @default 'datadoghq.com' (US1)
   */
  site?: DatadogSite;

  /**
   * Service name (required).
   * Appears in Datadog APM, Service Catalog, and all telemetry.
   */
  service: string;

  /**
   * Deployment environment (e.g., 'production', 'staging', 'development').
   * Used for environment filtering in Datadog.
   *
   * @default process.env.DD_ENV || process.env.NODE_ENV || 'development'
   */
  environment?: string;

  /**
   * Service version for deployment tracking.
   * Enables Deployment Tracking in Datadog APM.
   *
   * @default process.env.DD_VERSION || auto-detected from package.json
   */
  version?: string;

  /**
   * Enable log export to Datadog via OTLP.
   *
   * When enabled, this:
   * 1. Sets up OTel Logs SDK with OTLP exporter (for direct OTel logs API usage)
   * 2. Auto-configures OTEL_EXPORTER_OTLP_LOGS_* env vars for pino-opentelemetry-transport
   *
   * For Pino users: Just add pino-opentelemetry-transport to your logger config:
   * ```typescript
   * const logger = pino({
   *   transport: {
   *     targets: [
   *       { target: 'pino-pretty' },
   *       { target: 'pino-opentelemetry-transport' }, // Auto-configured!
   *     ],
   *   },
   * });
   * ```
   *
   * Requires peer dependencies: @opentelemetry/sdk-logs, @opentelemetry/exporter-logs-otlp-http
   *
   * @default false
   */
  enableLogs?: boolean;

  /**
   * Use local Datadog Agent instead of direct cloud ingestion.
   *
   * Benefits:
   * - Lower egress costs (Agent aggregates locally)
   * - Advanced features: trace-log correlation, multi-line logs, data scrubbing
   * - 500+ integrations for enrichment
   * - Infrastructure metrics collection
   *
   * Requires: Datadog Agent 7.35+ with OTLP enabled
   *
   * @default false
   */
  useAgent?: boolean;

  /**
   * Datadog Agent hostname (when useAgent: true).
   *
   * @default 'localhost'
   */
  agentHost?: string;

  /**
   * Datadog Agent OTLP port (when useAgent: true).
   *
   * @default 4318 (OTLP HTTP)
   */
  agentPort?: number;

  /**
   * Custom log record processors (advanced).
   * Overrides the default log processor if enableLogs is true.
   */
  logRecordProcessors?: LogRecordProcessor[];
}

/**
 * Create an autotel configuration optimized for Datadog.
 *
 * This preset handles:
 * - Proper OTLP endpoint configuration (Agent vs direct ingestion)
 *   - Direct: https://otlp.{site} → SDK appends /v1/traces, /v1/metrics, /v1/logs
 *   - Agent: http://localhost:4318 (default)
 * - Datadog API key authentication headers (direct ingestion only)
 * - Unified service tagging (service, env, version)
 * - Resource attribute best practices
 * - Optional log export configuration
 *
 * @param config - Datadog-specific configuration options
 * @returns AutotelConfig ready to pass to init()
 *
 * @example Simple cloud ingestion
 * ```typescript
 * init(createDatadogConfig({
 *   apiKey: process.env.DATADOG_API_KEY!,
 *   service: 'my-app',
 * }));
 * ```
 *
 * @example With logs and custom environment
 * ```typescript
 * init(createDatadogConfig({
 *   apiKey: process.env.DATADOG_API_KEY!,
 *   service: 'my-app',
 *   environment: 'production',
 *   version: '2.1.0',
 *   enableLogs: true,
 * }));
 * ```
 *
 * @example Using local Datadog Agent
 * ```typescript
 * init(createDatadogConfig({
 *   service: 'my-api',
 *   useAgent: true,
 *   agentHost: 'datadog-agent.default.svc.cluster.local', // Kubernetes
 * }));
 * ```
 */
export function createDatadogConfig(
  config: DatadogPresetConfig,
): AutotelConfig {
  const {
    apiKey,
    site = 'datadoghq.com',
    service,
    environment,
    version,
    enableLogs = false,
    useAgent = false,
    agentHost = 'localhost',
    agentPort = 4318,
    logRecordProcessors,
  } = config;

  // Validation: API key required for direct ingestion
  if (!useAgent && !apiKey) {
    throw new Error(
      'Datadog API key is required for direct cloud ingestion. ' +
        'Either provide apiKey or set useAgent: true to use local Datadog Agent.',
    );
  }

  const baseConfig: AutotelConfig = {
    service,
    environment,
    version,
  };

  // Local Datadog Agent configuration
  if (useAgent) {
    const agentEndpoint = `http://${agentHost}:${agentPort}`;

    // Auto-configure env vars for pino-opentelemetry-transport in agent mode
    if (enableLogs) {
      const logsEndpoint = `http://${agentHost}:${agentPort}/v1/logs`;

      if (!process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT) {
        process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = logsEndpoint;
      }

      if (!process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL) {
        process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL = 'http/protobuf';
      }

      // No API key header needed for agent mode - Agent handles authentication

      const resourceAttrs = [
        `service.name=${service}`,
        environment ? `deployment.environment=${environment}` : null,
        version ? `service.version=${version}` : null,
      ]
        .filter(Boolean)
        .join(',');

      if (!process.env.OTEL_RESOURCE_ATTRIBUTES) {
        process.env.OTEL_RESOURCE_ATTRIBUTES = resourceAttrs;
      }
    }

    return {
      ...baseConfig,
      endpoint: agentEndpoint,
      // No API key or headers needed - Agent handles authentication
    };
  }

  // Direct cloud ingestion configuration
  // Datadog OTLP endpoint: base URL without path (SDK appends /v1/traces, /v1/metrics, /v1/logs)
  const otlpEndpoint = `https://otlp.${site}`;
  const authHeaders = `dd-api-key=${apiKey}`;

  const cloudConfig: AutotelConfig = {
    ...baseConfig,
    endpoint: otlpEndpoint,
    headers: authHeaders,
  };

  // Add log export if enabled
  if (enableLogs) {
    // Auto-configure env vars for pino-opentelemetry-transport and other OTel log transports
    // These are read by pino-opentelemetry-transport, otlp-logger, and similar libraries
    const logsEndpoint = useAgent
      ? `http://${agentHost}:${agentPort}/v1/logs`
      : `https://otlp.${site}/v1/logs`;

    // Only set if not already configured (allow user override)
    if (!process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT) {
      process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = logsEndpoint;
    }

    if (!process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL) {
      process.env.OTEL_EXPORTER_OTLP_LOGS_PROTOCOL = 'http/protobuf';
    }

    // Only set API key header for direct cloud ingestion (not agent mode)
    if (!useAgent && apiKey && !process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS) {
      process.env.OTEL_EXPORTER_OTLP_LOGS_HEADERS = `dd-api-key=${apiKey}`;
    }

    // Set resource attributes for service identification
    const resourceAttrs = [
      `service.name=${service}`,
      environment ? `deployment.environment=${environment}` : null,
      version ? `service.version=${version}` : null,
    ]
      .filter(Boolean)
      .join(',');

    if (!process.env.OTEL_RESOURCE_ATTRIBUTES) {
      process.env.OTEL_RESOURCE_ATTRIBUTES = resourceAttrs;
    }

    if (logRecordProcessors) {
      // Use custom processors if provided
      cloudConfig.logRecordProcessors = logRecordProcessors;
    } else {
      // Create default OTLP log exporter
      try {
        // Lazy-load to preserve optional peer dependencies
        // Use createRequire to resolve from user's project directory
        const userRequire = createRequire(process.cwd() + '/package.json');

        const { BatchLogRecordProcessor } = userRequire(
          '@opentelemetry/sdk-logs',
        );
        const { OTLPLogExporter } = userRequire(
          '@opentelemetry/exporter-logs-otlp-http',
        );

        cloudConfig.logRecordProcessors = [
          new BatchLogRecordProcessor(
            new OTLPLogExporter({
              // Logs use /v1/logs path (SDK appends this to endpoint)
              url: `${otlpEndpoint}/v1/logs`,
              headers: {
                'dd-api-key': apiKey,
              },
            }),
          ),
        ];
      } catch {
        throw new Error(
          'Log export requires peer dependencies: @opentelemetry/sdk-logs and @opentelemetry/exporter-logs-otlp-http. ' +
            'Install them with: npm install @opentelemetry/sdk-logs @opentelemetry/exporter-logs-otlp-http',
        );
      }
    }
  }

  return cloudConfig;
}
