/**
 * Google Cloud preset for autotel
 *
 * Sends traces (and optionally metrics) to Google Cloud Observability via the
 * Telemetry (OTLP) API. Uses Application Default Credentials (ADC) for auth.
 *
 * @example Direct export to GCP (with google-auth-library)
 * ```typescript
 * import { init } from 'autotel';
 * import { createGoogleCloudConfig } from 'autotel-backends/google-cloud';
 *
 * init(createGoogleCloudConfig({
 *   projectId: process.env.GOOGLE_CLOUD_PROJECT!,
 *   service: 'my-app',
 * }));
 * ```
 *
 * @example Via OpenTelemetry Collector (no auth in app)
 * ```typescript
 * init(createGoogleCloudConfig({
 *   projectId: process.env.GOOGLE_CLOUD_PROJECT!,
 *   service: 'my-app',
 *   useCollector: true,
 *   collectorEndpoint: 'http://localhost:4318',
 * }));
 * ```
 */

import { createRequire } from 'node:module';
import type { AutotelConfig } from 'autotel';

/** Minimal SpanExporter-compatible interface (avoids @opentelemetry/sdk-trace-base peer at build time). */
interface SpanExporterLike {
  export(
    spans: unknown[],
    resultCallback: (result: { code: number; error?: Error }) => void,
  ): void | Promise<void>;
  forceFlush?(): Promise<void>;
  shutdown?(): Promise<void>;
}

/** Default Telemetry API base URL (OTLP). */
const DEFAULT_ENDPOINT = 'https://telemetry.googleapis.com';

/**
 * Configuration options for Google Cloud preset
 */
export interface GoogleCloudPresetConfig {
  /**
   * Google Cloud project ID (required for direct export).
   * Used for quota and resource attribution. Set GOOGLE_CLOUD_PROJECT or
   * GOOGLE_APPLICATION_CREDENTIALS for ADC.
   *
   * @default process.env.GOOGLE_CLOUD_PROJECT
   */
  projectId: string;

  /**
   * Service name (required).
   * Appears as service.name in Cloud Trace and Monitoring.
   */
  service: string;

  /**
   * Deployment environment (e.g., 'production', 'staging').
   *
   * @default process.env.NODE_ENV || 'development'
   */
  environment?: string;

  /**
   * Service version for deployment tracking.
   *
   * @default process.env.GCP_VERSION || process.env.VERSION
   */
  version?: string;

  /**
   * Use an OpenTelemetry Collector instead of exporting directly to GCP.
   * When true, the app sends OTLP to collectorEndpoint; the Collector
   * handles authentication to the Telemetry API. No google-auth-library needed.
   *
   * @default false
   */
  useCollector?: boolean;

  /**
   * Collector OTLP endpoint (when useCollector is true).
   *
   * @default 'http://localhost:4318'
   */
  collectorEndpoint?: string;

  /**
   * Telemetry API base URL (when useCollector is false).
   * Only override for testing or special endpoints.
   *
   * @default 'https://telemetry.googleapis.com'
   */
  endpoint?: string;
}

/**
 * Create an autotel configuration for Google Cloud Observability (Telemetry API).
 *
 * - With useCollector: false (default), exports directly to the Telemetry API
 *   using Application Default Credentials. Requires optional peer dependency
 *   google-auth-library for auth. Install: pnpm add google-auth-library
 *
 * - With useCollector: true, sends OTLP to a local Collector; the Collector
 *   forwards to GCP with ADC. No google-auth-library needed in the app.
 *
 * @param config - Google Cloud preset options
 * @returns AutotelConfig ready to pass to init()
 */
export function createGoogleCloudConfig(
  config: GoogleCloudPresetConfig,
): AutotelConfig {
  const {
    projectId,
    service,
    environment,
    version,
    useCollector = false,
    collectorEndpoint = 'http://localhost:4318',
    endpoint = DEFAULT_ENDPOINT,
  } = config;

  if (!projectId) {
    throw new Error(
      'Google Cloud projectId is required. Set it or use process.env.GOOGLE_CLOUD_PROJECT.',
    );
  }

  const baseConfig: AutotelConfig = {
    service,
    environment,
    version,
  };

  if (useCollector) {
    return {
      ...baseConfig,
      endpoint: collectorEndpoint,
      // x-goog-user-project for quota when Collector forwards to GCP
      headers: { 'x-goog-user-project': projectId },
    };
  }

  // Direct export: need ADC via google-auth-library
  try {
    const userRequire = createRequire(process.cwd() + '/package.json');
    const { GoogleAuth } = userRequire('google-auth-library');
    const { OTLPTraceExporter } = userRequire(
      '@opentelemetry/exporter-trace-otlp-http',
    );

    const tracesUrl = `${endpoint}/v1/traces`;
    const auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });

    const gcpTraceExporter = createGcpAuthTraceExporter(
      tracesUrl,
      projectId,
      auth,
      OTLPTraceExporter,
    );

    return {
      ...baseConfig,
      // Structurally compatible with SpanExporter from @opentelemetry/sdk-trace-base
      spanExporters: [
        gcpTraceExporter as NonNullable<AutotelConfig['spanExporters']>[number],
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('google-auth-library') ||
      message.includes('Cannot find module')
    ) {
      throw new Error(
        'Direct export to Google Cloud requires google-auth-library. ' +
          'Install it: pnpm add google-auth-library. ' +
          'Or use useCollector: true and run an OpenTelemetry Collector with GCP auth.',
        { cause: error },
      );
    }
    throw error;
  }
}

/** Minimal auth client: getClient() returns a client with getAccessToken(). */
interface GoogleAuthLike {
  getClient(): Promise<{ getAccessToken(): Promise<{ token: string | null }> }>;
}

type OTLPTraceExporterCtor = new (config: {
  url: string;
  headers?: Record<string, string>;
}) => SpanExporterLike;

function createGcpAuthTraceExporter(
  url: string,
  projectId: string,
  auth: GoogleAuthLike,
  OTLPTraceExporterCtor: OTLPTraceExporterCtor,
): SpanExporterLike {
  return new GcpAuthSpanExporter(url, projectId, auth, OTLPTraceExporterCtor);
}

class GcpAuthSpanExporter implements SpanExporterLike {
  constructor(
    private readonly url: string,
    private readonly projectId: string,
    private readonly auth: GoogleAuthLike,
    private readonly OTLPTraceExporterCtor: OTLPTraceExporterCtor,
  ) {}

  async export(
    spans: unknown[],
    resultCallback: (result: { code: number; error?: Error }) => void,
  ): Promise<void> {
    try {
      const client = await this.auth.getClient();
      const tokenResponse = await client.getAccessToken();
      const token = tokenResponse.token;
      if (!token) {
        resultCallback({
          code: 1,
          error: new Error('No access token from ADC'),
        });
        return;
      }
      const exporter = new this.OTLPTraceExporterCtor({
        url: this.url,
        headers: {
          Authorization: `Bearer ${token}`,
          'x-goog-user-project': this.projectId,
        },
      });
      exporter.export(spans, resultCallback);
    } catch (error) {
      resultCallback({
        code: 1,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  forceFlush(): Promise<void> {
    return Promise.resolve();
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
