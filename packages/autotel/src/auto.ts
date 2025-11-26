/**
 * Zero-config ESM instrumentation with auto-init from YAML/environment variables
 *
 * This module provides the simplest possible setup for OpenTelemetry instrumentation.
 * Just import it and everything is configured from autotel.yaml or environment variables.
 *
 * Usage with YAML config (recommended):
 * ```bash
 * # Create autotel.yaml in project root, then:
 * tsx --import autotel/auto src/index.ts
 * ```
 *
 * Usage with environment variables:
 * ```bash
 * OTEL_SERVICE_NAME=my-app tsx --import autotel/auto src/index.ts
 * ```
 *
 * No instrumentation.ts file needed!
 *
 * Configuration Priority (highest to lowest):
 * 1. YAML file (autotel.yaml or AUTOTEL_CONFIG_FILE)
 * 2. Environment variables (OTEL_*, AUTOTEL_*)
 * 3. Built-in defaults
 *
 * Environment Variables:
 * - OTEL_SERVICE_NAME: Service name (required for meaningful traces)
 * - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP collector endpoint (e.g., http://localhost:4318)
 * - OTEL_EXPORTER_OTLP_HEADERS: Auth headers (e.g., x-honeycomb-team=YOUR_KEY)
 * - AUTOTEL_INTEGRATIONS: Comma-separated list or 'true' for all (default: http,express)
 * - AUTOTEL_DEBUG: Set to 'true' to enable console span output
 * - AUTOTEL_CONFIG_FILE: Path to YAML config file (overrides autotel.yaml discovery)
 *
 * @requires Node.js 20.6.0 or later
 */

import { register } from 'node:module';
import { createAddHookMessageChannel } from 'import-in-the-middle';
import { init } from './init.js';
import { loadYamlConfig } from './yaml-config.js';

// Register ESM hooks first (must happen before any instrumented modules load)
const { registerOptions } = createAddHookMessageChannel();
register('import-in-the-middle/hook.mjs', import.meta.url, registerOptions);

// Load YAML config if present (init.ts will also load it, but we need values here)
const yamlConfig = loadYamlConfig();

// Parse integrations from environment variable (fallback if not in YAML)
const integrationsEnv = process.env.AUTOTEL_INTEGRATIONS;
const integrations: string[] | boolean | Record<string, { enabled?: boolean }> =
  integrationsEnv === 'true'
    ? true // Enable all integrations
    : integrationsEnv
      ? integrationsEnv.split(',').map((s) => s.trim())
      : (yamlConfig?.integrations ?? ['http', 'express']); // YAML > default

// Auto-initialize with YAML config merged with env var defaults
// init() will load YAML again and merge properly, but we pass overrides here
init({
  service:
    yamlConfig?.service ?? process.env.OTEL_SERVICE_NAME ?? 'unknown-service',
  debug: yamlConfig?.debug ?? process.env.AUTOTEL_DEBUG === 'true',
  integrations,
});
