/**
 * Pydantic Logfire preset for autotel
 *
 * Logfire keeps `gen_ai.*` semantic-convention attributes and W3C trace/span
 * IDs intact on the read path, so traces you send here come back the shape you
 * emitted them — which is why it's a good default for GenAI workloads.
 *
 * @example Send traces to Logfire
 * ```typescript
 * import { init } from 'autotel';
 * import { createLogfireConfig } from 'autotel-backends/logfire';
 *
 * init(createLogfireConfig({
 *   writeToken: process.env.LOGFIRE_WRITE_TOKEN!,
 *   service: 'my-app',
 * }));
 * ```
 *
 * @example EU data region
 * ```typescript
 * init(createLogfireConfig({
 *   writeToken: process.env.LOGFIRE_WRITE_TOKEN!,
 *   service: 'my-app',
 *   region: 'eu',
 * }));
 * ```
 */

import type { AutotelConfig } from 'autotel';

/**
 * Default ingest host. Logfire encodes the data region in the token and routes
 * accordingly, so this works for any project. Pinning a specific region host by
 * default would make a token from the other region fail with a bare 401.
 */
const DEFAULT_ENDPOINT = 'https://logfire-api.pydantic.dev';

/** Region-pinned ingest endpoints, for when you'd rather not rely on routing. */
const REGION_ENDPOINTS = {
  us: 'https://logfire-us.pydantic.dev',
  eu: 'https://logfire-eu.pydantic.dev',
} as const;

export type LogfireRegion = keyof typeof REGION_ENDPOINTS;

/**
 * Configuration options for the Logfire preset
 */
export interface LogfirePresetConfig {
  /**
   * Logfire **write** token (required).
   *
   * Create one under Project Settings → Write Tokens. Note this is a different
   * credential from the read-scope token the query API needs — a write token is
   * rejected for reads, and vice versa.
   */
  writeToken: string;

  /**
   * Service name (required).
   * Appears as service.name on every span.
   */
  service: string;

  /**
   * Pin the data region instead of letting the token route the request.
   * Rarely needed — Logfire infers the region from the token.
   *
   * @default undefined (token-routed)
   */
  region?: LogfireRegion;

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
   * Full OTLP endpoint override, for self-hosted Logfire.
   * Takes precedence over `region`.
   *
   * @default the token-routed ingest host, or the pinned region's endpoint
   */
  endpoint?: string;
}

/**
 * Create an autotel configuration for Pydantic Logfire.
 *
 * This preset handles:
 * - OTLP/HTTP protocol — Logfire does not accept gRPC, and OTel SDKs that
 *   default to it fail silently
 * - The regional ingest endpoint
 * - The bare-token `Authorization` header Logfire's ingest expects
 *
 * @param config - Logfire-specific configuration options
 * @returns AutotelConfig ready to pass to init()
 */
export function createLogfireConfig(
  config: LogfirePresetConfig,
): AutotelConfig {
  const { writeToken, service, region, environment, version } = config;

  if (!writeToken) {
    throw new Error(
      'Logfire write token is required. Create one under Project Settings → Write Tokens.',
    );
  }

  let regionEndpoint = DEFAULT_ENDPOINT;
  if (region !== undefined) {
    const pinned = REGION_ENDPOINTS[region];
    if (!pinned) {
      throw new Error(
        `Unknown Logfire region "${region}". Supported regions: ${Object.keys(REGION_ENDPOINTS).join(', ')}.`,
      );
    }
    regionEndpoint = pinned;
  }

  return {
    service,
    environment,
    version,
    // Logfire is HTTP-only; a gRPC exporter will not deliver anything.
    protocol: 'http',
    endpoint: config.endpoint ?? regionEndpoint,
    // Ingest takes the token bare — `Bearer <token>` is only for the query API.
    headers: { Authorization: writeToken },
  };
}
