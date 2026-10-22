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
 *   instrumentations: [...],  // or autoInstrumentations: ['express', 'http', 'pino']
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

// namespace import for browser-bundler compat — see node-require.ts
import * as nodeModule from 'node:module';

/**
 * Never wrap the app's own files: any `file:` URL outside `node_modules`.
 *
 * Instrumentations hook packages and Node builtins, never application code, so
 * wrapping it bought nothing and cost a lot: every module rewritten at start-up,
 * `failed to wrap` warnings for barrels, and changed evaluation order turning a
 * latent import cycle into a `Cannot access 'x' before initialization` crash.
 *
 * Excluding app code rather than including only hooked modules keeps `init()`
 * free to run anywhere. A hooked-only loader cannot wrap a module whose `Hook()`
 * arrives after it loads, and ESM loads the whole static graph before running
 * any of it, so an `init()` inside the app's own graph would patch nothing.
 * Yarn PnP serves packages from `.yarn/` zips rather than `node_modules`, so
 * PnP support means widening this pattern.
 */
const APP_CODE = /^file:(?!.*\/node_modules\/)/;

// The OpenTelemetry hook, not `import-in-the-middle/hook.mjs` directly: the
// instrumentations call `Hook()` from the copy `@opentelemetry/instrumentation`
// depends on, and only that copy's loader reports wrapped modules to them.
nodeModule.register(
  '@opentelemetry/instrumentation/hook.mjs',
  import.meta.url,
  {
    data: { exclude: [APP_CODE] },
  },
);
// Read by init() to skip its "no ESM hook" warning. Symbol.for, not an import,
// so this file stays standalone.
(globalThis as Record<symbol, unknown>)[Symbol.for('autotel.register')] = true;
