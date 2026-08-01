/**
 * PostHog preset for autotel
 *
 * PostHog ingests OTLP traces, logs and metrics, so product analytics and
 * distributed traces can share one destination. Note this is the *telemetry*
 * side; `autotel-subscribers/posthog` is the separate path for product events.
 *
 * @example Send traces to PostHog Cloud
 * ```typescript
 * import { init } from 'autotel';
 * import { createPostHogConfig } from 'autotel-backends/posthog';
 *
 * init(createPostHogConfig({
 *   projectToken: process.env.POSTHOG_PROJECT_TOKEN!,
 *   service: 'my-app',
 *   region: 'eu',
 * }));
 * ```
 */

import type { AutotelConfig } from 'autotel';

/** PostHog Cloud regions and their ingest hosts. */
const REGION_HOSTS = {
  us: 'https://us.i.posthog.com',
  eu: 'https://eu.i.posthog.com',
} as const;

export type PostHogRegion = keyof typeof REGION_HOSTS;

/**
 * PostHog serves OTLP under `/i`, not at the host root. autotel appends
 * `/v1/<signal>`, so stopping the endpoint at `/i` yields `/i/v1/traces`,
 * `/i/v1/logs` and `/i/v1/metrics` — the three documented paths.
 */
const OTLP_PATH_PREFIX = '/i';

/**
 * Configuration options for the PostHog preset
 */
export interface PostHogPresetConfig {
  /**
   * PostHog project API key, `phc_...` (required).
   * Found under Project Settings.
   */
  projectToken: string;

  /**
   * Service name (required).
   * Appears as service.name on every span.
   */
  service: string;

  /**
   * PostHog Cloud region.
   *
   * @default 'us'
   */
  region?: PostHogRegion;

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
   * Host of a self-hosted PostHog instance, without the OTLP path.
   * Takes precedence over `region`.
   *
   * @default the host for the selected region
   */
  host?: string;
}

/**
 * Create an autotel configuration for PostHog.
 *
 * This preset handles:
 * - OTLP/HTTP **protobuf** — PostHog's own docs steer away from the JSON
 *   exporter, and a JSON body is dropped rather than rejected
 * - The `/i` path prefix its OTLP receiver lives under
 * - Bearer auth with the project token
 *
 * @param config - PostHog-specific configuration options
 * @returns AutotelConfig ready to pass to init()
 */
export function createPostHogConfig(
  config: PostHogPresetConfig,
): AutotelConfig {
  const { projectToken, service, region = 'us', environment, version } = config;

  if (!projectToken) {
    throw new Error(
      'PostHog project token is required. Find it under Project Settings.',
    );
  }

  const regionHost = REGION_HOSTS[region];
  if (!regionHost) {
    throw new Error(
      `Unknown PostHog region "${region}". Supported regions: ${Object.keys(REGION_HOSTS).join(', ')}.`,
    );
  }

  const root = (config.host ?? regionHost).replace(/\/+$/, '');
  const endpoint = root.endsWith(OTLP_PATH_PREFIX)
    ? root
    : `${root}${OTLP_PATH_PREFIX}`;

  return {
    service,
    environment,
    version,
    // PostHog accepts OTLP over HTTP with a protobuf body; the JSON exporter
    // does not deliver, and gRPC is not offered.
    protocol: 'http/protobuf',
    endpoint,
    headers: { Authorization: `Bearer ${projectToken}` },
  };
}
