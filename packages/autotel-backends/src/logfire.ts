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
 * Region ingest endpoints.
 *
 * Verified against the live API: the shared `logfire-api.pydantic.dev` host
 * returns 401 for ingest. Logfire's own SDK resolves the region host from the
 * token client-side rather than relying on server-side routing, so the region
 * has to be named — which is why it is required below rather than defaulted.
 * Guessing it wrong produces a bare 401 that names neither cause.
 */
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
   * Data region the project lives in (required).
   *
   * Both ingest and the query API are region-specific, and a mismatch returns
   * a bare 401, so this is explicit rather than guessed. Ignored when
   * `endpoint` is set for a self-hosted instance.
   */
  region: LogfireRegion;

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
   * @default the named region's endpoint
   */
  endpoint?: string;
}

/**
 * Create an autotel configuration for Pydantic Logfire.
 *
 * This preset handles:
 * - OTLP/HTTP **protobuf** — Logfire accepts neither gRPC nor a JSON body, and
 *   an SDK defaulting to either fails silently
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

  const regionEndpoint = REGION_ENDPOINTS[region];
  if (!regionEndpoint) {
    throw new Error(
      `Unknown Logfire region "${region}". Supported regions: ${Object.keys(REGION_ENDPOINTS).join(', ')}.`,
    );
  }

  return {
    service,
    environment,
    version,
    // Logfire is HTTP-only, and specifically OTLP **protobuf** — a gRPC
    // exporter delivers nothing, and a JSON body is dropped silently, which
    // looks exactly like emitting no telemetry at all.
    // Needs @opentelemetry/exporter-trace-otlp-proto.
    // They are optional peer dependencies loaded lazily, and bundlers (Vercel, Nitro, esbuild) do not follow that require, so a bundled app needs them as direct dependencies even when they resolve locally.
    // The failure surfaces at init(), which in a serverless app means the first traced request in production.
    protocol: 'http/protobuf',
    endpoint: config.endpoint ?? regionEndpoint,
    // Ingest takes the token bare — `Bearer <token>` is only for the query API.
    headers: { Authorization: writeToken },
  };
}
