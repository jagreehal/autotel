/**
 * ESM instrumentation registration for Node.js 18.19+
 *
 * This module registers the OpenTelemetry ESM loader hook using the modern
 * node:module register() API. This eliminates the need for NODE_OPTIONS or
 * --experimental-loader flags.
 *
 * Usage in instrumentation.mjs:
 * ```typescript
 * import 'autotel/register';  // MUST be first import!
 * import { init } from 'autotel';
 *
 * init({
 *   service: 'my-app',
 *   instrumentations: [...],  // or integrations: ['express', 'http', 'pino']
 * });
 * ```
 *
 * Then run:
 * ```bash
 * node --import ./instrumentation.mjs src/index.js
 * # or with tsx:
 * tsx --import ./instrumentation.mjs src/index.ts
 * ```
 *
 * No NODE_OPTIONS or --experimental-loader needed!
 *
 * @requires Node.js 18.19.0 or later
 * @see https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/esm-support.md
 * @see https://nodejs.org/api/module.html#moduleregisterspecifier-parenturl-options
 */

import { register } from 'node:module';

// Use the official OpenTelemetry instrumentation hook which wraps import-in-the-middle
// This ensures proper integration with OTel's instrumentation system
register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);
