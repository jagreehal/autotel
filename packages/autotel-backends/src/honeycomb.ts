/**
 * Honeycomb preset for autotel
 *
 * Provides a simplified configuration helper for Honeycomb integration
 * with best practices built-in.
 *
 * @example Using Honeycomb with API key
 * ```typescript
 * import { init } from 'autotel';
 * import { createHoneycombConfig } from 'autotel-backends/honeycomb';
 *
 * init(createHoneycombConfig({
 *   apiKey: process.env.HONEYCOMB_API_KEY!,
 *   service: 'my-app',
 * }));
 * ```
 *
 * @example With custom dataset
 * ```typescript
 * import { init } from 'autotel';
 * import { createHoneycombConfig } from 'autotel-backends/honeycomb';
 *
 * init(createHoneycombConfig({
 *   apiKey: process.env.HONEYCOMB_API_KEY!,
 *   service: 'my-app',
 *   dataset: 'production',
 * }));
 * ```
 */

import type { AutotelConfig } from 'autotel';

/**
 * Configuration options for Honeycomb preset
 */
export interface HoneycombPresetConfig {
  /**
   * Honeycomb API key (required).
   *
   * Get your API key from:
   * https://ui.honeycomb.io/account
   *
   * For classic environments, use an environment-specific key.
   * For newer environments, use a team-level API key.
   */
  apiKey: string;

  /**
   * Service name (required).
   * Appears as service.name in Honeycomb traces and determines dataset routing.
   */
  service: string;

  /**
   * Dataset name (optional).
   * For classic Honeycomb accounts that use datasets.
   * Modern environments route based on service.name instead.
   *
   * @default service name
   */
  dataset?: string;

  /**
   * Deployment environment (e.g., 'production', 'staging', 'development').
   * Used for environment filtering in Honeycomb.
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
   * Honeycomb API endpoint.
   * Use this to configure for different regions or on-premises installations.
   *
   * @default 'api.honeycomb.io:443'
   */
  endpoint?: string;

  /**
   * Sample rate for traces (1 = 100%, 10 = 10%, 100 = 1%).
   * Honeycomb's head-based sampling rate.
   *
   * Note: Autotel uses tail-based sampling by default.
   * This setting applies additional head-based sampling if specified.
   *
   * @default undefined (no head-based sampling, relies on tail sampling)
   */
  sampleRate?: number;
}

/**
 * Create an autotel configuration optimized for Honeycomb.
 *
 * This preset handles:
 * - gRPC protocol configuration (Honeycomb's preferred protocol)
 * - Proper endpoint and authentication headers
 * - Dataset routing (for classic accounts)
 * - Unified service tagging (service, env, version)
 *
 * Honeycomb uses gRPC by default for better performance and lower overhead.
 * This preset automatically configures the gRPC protocol.
 *
 * @param config - Honeycomb-specific configuration options
 * @returns AutotelConfig ready to pass to init()
 *
 * @example Simple configuration
 * ```typescript
 * init(createHoneycombConfig({
 *   apiKey: process.env.HONEYCOMB_API_KEY!,
 *   service: 'my-app',
 * }));
 * ```
 *
 * @example With custom dataset and environment
 * ```typescript
 * init(createHoneycombConfig({
 *   apiKey: process.env.HONEYCOMB_API_KEY!,
 *   service: 'my-app',
 *   dataset: 'production',
 *   environment: 'production',
 *   version: '2.1.0',
 * }));
 * ```
 *
 * @example With sample rate
 * ```typescript
 * init(createHoneycombConfig({
 *   apiKey: process.env.HONEYCOMB_API_KEY!,
 *   service: 'my-app',
 *   sampleRate: 10, // Sample 10% of traces (head-based sampling)
 * }));
 * ```
 */
export function createHoneycombConfig(
  config: HoneycombPresetConfig,
): AutotelConfig {
  const {
    apiKey,
    service,
    dataset,
    environment,
    version,
    endpoint = 'api.honeycomb.io:443',
    sampleRate,
  } = config;

  // Validation: API key is required
  if (!apiKey) {
    throw new Error(
      'Honeycomb API key is required. Get your API key from: https://ui.honeycomb.io/account',
    );
  }

  // Build headers
  const headers: Record<string, string> = {
    'x-honeycomb-team': apiKey,
  };

  // Add dataset header if specified (for classic Honeycomb accounts)
  if (dataset) {
    headers['x-honeycomb-dataset'] = dataset;
  }

  // Add sample rate header if specified
  if (sampleRate !== undefined) {
    headers['x-honeycomb-samplerate'] = String(sampleRate);
  }

  return {
    service,
    environment,
    version,
    protocol: 'grpc', // Honeycomb uses gRPC for better performance
    endpoint,
    headers,
  };
}
