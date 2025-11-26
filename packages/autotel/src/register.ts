/**
 * ESM instrumentation registration for Node.js 20.6+
 *
 * This module registers the OpenTelemetry ESM loader hook using the modern
 * node:module register() API. This eliminates the need for NODE_OPTIONS.
 *
 * Usage in instrumentation.ts:
 * ```typescript
 * import 'autotel/register';
 * import { init } from 'autotel';
 *
 * init({
 *   service: 'my-app',
 *   integrations: ['express', 'http', 'pino'],
 * });
 * ```
 *
 * Then run:
 * ```bash
 * tsx --import ./instrumentation.ts src/index.ts
 * ```
 *
 * No NODE_OPTIONS needed!
 *
 * @requires Node.js 20.6.0 or later
 * @see https://nodejs.org/api/module.html#moduleregisterspecifier-parenturl-options
 */

import { register } from 'node:module';
import { createAddHookMessageChannel } from 'import-in-the-middle';

const { registerOptions, waitForAllMessagesAcknowledged } =
  createAddHookMessageChannel();

register('import-in-the-middle/hook.mjs', import.meta.url, registerOptions);

/**
 * Wait for all hook messages to be acknowledged.
 * Useful for ensuring all instrumentation is properly registered before proceeding.
 */
export { waitForAllMessagesAcknowledged };
