/**
 * Cross-format require() helper for CJS and ESM compatibility
 *
 * Provides a synchronous `require()` function that works in both:
 * - CJS builds: Uses native `require`
 * - ESM builds: Uses `createRequire(import.meta.url)`
 *
 * This allows optional peer dependencies and dynamic module loading
 * to work synchronously in both module formats.
 */

import { createRequire } from 'node:module';

// Use native `require` in CJS, `createRequire` in ESM.
// tsup will compile this appropriately for each format.
// Type is ReturnType<typeof createRequire> which is a function that loads modules.
const nodeRequire =
  typeof require === 'undefined' ? createRequire(import.meta.url) : require;

/**
 * Synchronously require a module (works in both CJS and ESM)
 *
 * @param id - Module ID to require
 * @returns The required module
 * @throws Error if module cannot be loaded
 *
 * @example
 * ```typescript
 * import { safeRequire } from './node-require';
 *
 * const traceloop = safeRequire('@traceloop/node-server-sdk');
 * if (traceloop) {
 *   traceloop.initialize({ ... });
 * }
 * ```
 */
export function safeRequire<T = unknown>(id: string): T | undefined {
  try {
    return nodeRequire(id) as T;
  } catch (error) {
    if (error && (error as NodeJS.ErrnoException).code === 'MODULE_NOT_FOUND') {
      // Optional dependency missing – return undefined
      return undefined;
    }
    // Any other error is a real bug: rethrow
    throw error;
  }
}

/**
 * Synchronously require a module (throws if not found)
 *
 * Use this when the module is required (not optional).
 *
 * @param id - Module ID to require
 * @returns The required module
 * @throws Error if module cannot be loaded
 *
 * @example
 * ```typescript
 * import { requireModule } from './node-require';
 *
 * const fs = requireModule<typeof import('node:fs')>('node:fs');
 * const content = fs.readFileSync('file.txt', 'utf8');
 * ```
 */
export function requireModule<T = unknown>(id: string): T {
  return nodeRequire(id) as T;
}

/**
 * Direct access to the nodeRequire function (for advanced use cases)
 */
export { nodeRequire };
