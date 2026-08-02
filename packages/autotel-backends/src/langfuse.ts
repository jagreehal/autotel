/**
 * Langfuse preset for autotel
 *
 * Langfuse ingests plain OTLP, so autotel's GenAI spans land without a Langfuse
 * SDK in your app.
 *
 * @example Send traces to Langfuse Cloud
 * ```typescript
 * import { init } from 'autotel';
 * import { createLangfuseConfig } from 'autotel-backends/langfuse';
 *
 * init(createLangfuseConfig({
 *   publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
 *   secretKey: process.env.LANGFUSE_SECRET_KEY!,
 *   service: 'my-app',
 * }));
 * ```
 *
 * @example Self-hosted
 * ```typescript
 * init(createLangfuseConfig({
 *   publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
 *   secretKey: process.env.LANGFUSE_SECRET_KEY!,
 *   service: 'my-app',
 *   baseUrl: 'https://langfuse.internal.example.com',
 * }));
 * ```
 */

import type { AutotelConfig } from 'autotel';

/** Langfuse Cloud regions and their base URLs. */
const REGION_BASE_URLS = {
  eu: 'https://cloud.langfuse.com',
  us: 'https://us.cloud.langfuse.com',
} as const;

export type LangfuseRegion = keyof typeof REGION_BASE_URLS;

/** OTLP receiver path, appended to whichever base URL is in play. */
const OTEL_PATH = '/api/public/otel';

/**
 * Configuration options for the Langfuse preset
 */
export interface LangfusePresetConfig {
  /**
   * Langfuse public key, `pk-lf-...` (required).
   * Found under Settings → API Keys.
   */
  publicKey: string;

  /**
   * Langfuse secret key, `sk-lf-...` (required).
   * Found under Settings → API Keys.
   */
  secretKey: string;

  /**
   * Service name (required).
   * Appears as service.name on every span.
   */
  service: string;

  /**
   * Langfuse Cloud region the project lives in.
   *
   * @default 'eu'
   */
  region?: LangfuseRegion;

  /**
   * Deployment environment (e.g., 'production', 'staging', 'development').
   *
   * @default process.env.NODE_ENV || 'development'
   */
  environment?: string;

  /**
   * Service version for deployment tracking.
   *
   * @default process.env.VERSION || auto-detected from package.json
   */
  version?: string;

  /**
   * Base URL of a self-hosted Langfuse instance, without the OTLP path.
   * Takes precedence over `region`.
   *
   * @default the base URL for the selected region
   */
  baseUrl?: string;
}

/**
 * Create an autotel configuration for Langfuse.
 *
 * This preset handles:
 * - OTLP/HTTP protocol — Langfuse does not support gRPC
 * - The regional (or self-hosted) OTLP receiver URL
 * - Basic auth over the public/secret key pair
 * - Opting into v4 ingestion, which keeps traces queryable promptly
 *
 * @param config - Langfuse-specific configuration options
 * @returns AutotelConfig ready to pass to init()
 */
export function createLangfuseConfig(
  config: LangfusePresetConfig,
): AutotelConfig {
  const {
    publicKey,
    secretKey,
    service,
    region = 'eu',
    environment,
    version,
    baseUrl,
  } = config;

  if (!publicKey) {
    throw new Error(
      'Langfuse public key is required. Find it under Settings → API Keys.',
    );
  }
  if (!secretKey) {
    throw new Error(
      'Langfuse secret key is required. Find it under Settings → API Keys.',
    );
  }

  const regionBaseUrl = REGION_BASE_URLS[region];
  if (!regionBaseUrl) {
    throw new Error(
      `Unknown Langfuse region "${region}". Supported regions: ${Object.keys(REGION_BASE_URLS).join(', ')}.`,
    );
  }

  const root = (baseUrl ?? regionBaseUrl).replace(/\/+$/, '');
  const credentials = Buffer.from(`${publicKey}:${secretKey}`).toString(
    'base64',
  );

  return {
    service,
    environment,
    version,
    // Langfuse accepts OTLP over HTTP only; gRPC is not supported.
    protocol: 'http',
    endpoint: `${root}${OTEL_PATH}`,
    headers: {
      Authorization: `Basic ${credentials}`,
      'x-langfuse-ingestion-version': '4',
    },
  };
}
