import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { TailSamplingSpanProcessor } from './tail-sampling-processor';
import { getLogger } from './init';
import {
  resourceFromAttributes,
  detectResources,
  processDetector,
  hostDetector,
  type Resource,
  type ResourceDetector,
} from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions/incubating';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { requireModule } from './node-require';

/**
 * Parse OTLP headers string into object format
 * @param headersString - Headers as "key1=value1,key2=value2" or "Authorization=Basic ..."
 * @returns Headers object for OTLP exporters
 */
function parseOtlpHeaders(headersString?: string): Record<string, string> {
  if (!headersString) return {};

  const headers: Record<string, string> = {};
  const pairs = headersString.split(',');

  for (const pair of pairs) {
    const [key, ...valueParts] = pair.split('=');
    if (key && valueParts.length > 0) {
      headers[key.trim()] = valueParts.join('=').trim();
    }
  }

  return headers;
}

/**
 * Parse resource attributes string into object format
 * @param attributesString - Attributes as "key1=value1,key2=value2"
 * @returns Resource attributes object
 */
function parseResourceAttributes(
  attributesString?: string,
): Record<string, string> {
  if (!attributesString) return {};

  const attributes: Record<string, string> = {};
  const pairs = attributesString.split(',');

  for (const pair of pairs) {
    const [key, ...valueParts] = pair.split('=');
    if (key && valueParts.length > 0) {
      attributes[key.trim()] = valueParts.join('=').trim();
    }
  }

  return attributes;
}

export interface InstrumentationConfig {
  serviceName: string;
  serviceVersion?: string;
  deploymentEnvironment?: string;
  otlpEndpoint?: string;
  /** Headers for authentication (e.g., Grafana Cloud, Honeycomb) */
  headers?: string;
  /** Resource attributes as comma-separated key=value pairs */
  resourceAttributes?: string;
  /** Enable async resource detection for process/host info (default: false) */
  detectResources?: boolean;
  /**
   * Use selective instrumentation instead of full auto-instrumentation
   * **Default: true** (performance-first)
   *
   * When true, auto-instrumentation is disabled. You can manually add
   * specific instrumentations via the `instrumentations` field.
   * This reduces overhead from ~81% to near-zero based on Platformatic benchmarks.
   *
   * Set to false to enable full auto-instrumentation (not recommended for production).
   *
   * @see https://blogger.platformatic.dev/the-hidden-cost-of-context
   */
  selectiveInstrumentation?: boolean;

  /**
   * Custom instrumentations to use (only when selectiveInstrumentation is true)
   * @example
   * ```typescript
   * import { HttpInstrumentation } from '@opentelemetry/instrumentation-http'
   *
   * initInstrumentation({
   *   serviceName: 'api',
   *   selectiveInstrumentation: true,
   *   instrumentations: [new HttpInstrumentation()]
   * })
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  instrumentations?: any[];
}

/**
 * Initialize OpenTelemetry instrumentation with OTLP exporters
 *
 * This sets up:
 * - Traces (OTLP HTTP)
 * - Metrics (OTLP HTTP)
 * - Logs (OTLP HTTP)
 * - Auto-instrumentation for common Node.js libraries
 *
 * @example
 * // Call this at the very start of your application
 * import { initInstrumentation } from '@your-org/otel-decorators'
 *
 * initInstrumentation({
 *   serviceName: 'my-service' }
 *   serviceVersion: '1.0.0',
 *   deploymentEnvironment: 'production',
 *   otlpEndpoint: 'http://localhost:4318'
 * })
 *
 * // Or with async resource detection (top-level await required)
 * await initInstrumentation({
 *   serviceName: 'my-service' }
 *   detectResources: true
 * })
 */
// Enables graceful shutdown and prevents SDK leaks on hot-reload
let currentSDK: NodeSDK | null = null;
let shutdownHandlerRegistered = false;

/**
 * Shutdown the OpenTelemetry SDK gracefully
 * Call this before process exit or during hot-reloads
 */
export async function shutdownInstrumentation(sdk?: NodeSDK): Promise<void> {
  const sdkToShutdown = sdk || currentSDK;
  if (!sdkToShutdown) {
    getLogger().warn({}, 'No SDK to shutdown');
    return;
  }

  try {
    await sdkToShutdown.shutdown();
    getLogger().info({}, 'OpenTelemetry terminated successfully');
    if (sdkToShutdown === currentSDK) {
      currentSDK = null;
    }
  } catch (error) {
    getLogger().error(
      {
        err: error instanceof Error ? error : undefined,
      },
      'Error terminating OpenTelemetry',
    );
    throw error;
  }
}

export async function initInstrumentation(
  config: InstrumentationConfig,
): Promise<NodeSDK> {
  // Prevents resource leaks on hot-reload or multiple init calls
  if (currentSDK) {
    getLogger().info(
      {},
      'Shutting down existing OpenTelemetry SDK before reinitializing...',
    );
    await shutdownInstrumentation(currentSDK);
  }

  // Parse headers and resource attributes
  const otlpHeaders = parseOtlpHeaders(config.headers);
  const customResourceAttributes = parseResourceAttributes(
    config.resourceAttributes,
  );

  let resource: Resource;

  // Dynamically load optional resource detectors
  const detectors: ResourceDetector[] = [processDetector, hostDetector];
  try {
    const awsDetectors = await import('@opentelemetry/resource-detector-aws');
    detectors.push(
      awsDetectors.awsEc2Detector,
      awsDetectors.awsEcsDetector,
      awsDetectors.awsEksDetector,
    );
  } catch {
    // ignore
  }
  try {
    const gcpDetectors = await import('@opentelemetry/resource-detector-gcp');
    detectors.push(gcpDetectors.gcpDetector);
  } catch {
    // ignore
  }
  try {
    const containerDetectors =
      await import('@opentelemetry/resource-detector-container');
    detectors.push(containerDetectors.containerDetector);
  } catch {
    // ignore
  }

  if (config.detectResources) {
    const detectedResource = await detectResources({
      detectors,
    });

    resource = detectedResource.merge(
      resourceFromAttributes({
        [ATTR_SERVICE_NAME]: config.serviceName,
        [ATTR_SERVICE_VERSION]: config.serviceVersion || '1.0.0',
        'deployment.environment': config.deploymentEnvironment || 'development',
        ...customResourceAttributes, // Merge custom resource attributes
      }),
    );
  } else {
    resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: config.serviceName,
      [ATTR_SERVICE_VERSION]: config.serviceVersion || '1.0.0',
      'deployment.environment': config.deploymentEnvironment || 'development',
      ...customResourceAttributes, // Merge custom resource attributes
    });
  }

  // Default to selective (near-zero overhead) vs full auto (~81% overhead)
  // Lazy-load to avoid importing ~40+ packages at module evaluation time
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let instrumentations: any[] = config.instrumentations || [];
  if (config.selectiveInstrumentation === false) {
    const mod = requireModule<{
      getNodeAutoInstrumentations: () => unknown[];
    }>('@opentelemetry/auto-instrumentations-node');
    instrumentations = [mod.getNodeAutoInstrumentations()];
  }

  const traceExporter = new OTLPTraceExporter({
    url: `${config.otlpEndpoint || 'http://localhost:4318'}/v1/traces`,
    headers: otlpHeaders,
  });

  // Enables tail sampling via sampling.tail.keep attribute
  const spanProcessor = new TailSamplingSpanProcessor(
    new BatchSpanProcessor(traceExporter),
  );

  const sdk = new NodeSDK({
    resource,
    spanProcessor, // Use our wrapped processor instead of traceExporter directly
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: `${config.otlpEndpoint || 'http://localhost:4318'}/v1/metrics`,
        headers: otlpHeaders,
      }),
    }),
    logRecordProcessors: [
      new BatchLogRecordProcessor(
        new OTLPLogExporter({
          url: `${config.otlpEndpoint || 'http://localhost:4318'}/v1/logs`,
          headers: otlpHeaders,
        }),
      ),
    ],
    instrumentations,
  });

  try {
    await sdk.start();
    getLogger().info({}, 'OpenTelemetry instrumentation started successfully');
  } catch (error) {
    getLogger().error(
      {
        err: error instanceof Error ? error : undefined,
      },
      'Failed to start OpenTelemetry SDK',
    );
    throw error;
  }

  // Track current SDK for shutdown handler
  currentSDK = sdk;

  if (!shutdownHandlerRegistered) {
    shutdownHandlerRegistered = true;

    const shutdownHandler = () => {
      shutdownInstrumentation()
        .then(() => {
          // eslint-disable-next-line unicorn/no-process-exit
          process.exit(0);
        })
        .catch((error) => {
          getLogger().error(
            {
              err: error instanceof Error ? error : undefined,
            },
            'Shutdown error',
          );
          // eslint-disable-next-line unicorn/no-process-exit
          process.exit(1);
        });
    };

    process.on('SIGTERM', shutdownHandler);
    process.on('SIGINT', shutdownHandler);
  }

  return sdk;
}
