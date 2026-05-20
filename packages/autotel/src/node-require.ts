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

// `__filename` is provided by CJS and by esbuild's CJS output wrapper, but
// is undefined under pure ESM. `import.meta.url` is provided by ESM. Pick
// whichever is available so the helper works in:
//   - native CJS (autotel's published `.cjs`)
//   - native ESM (autotel's published `.js`)
//   - ESM-bundled-into-CJS by a downstream consumer (e.g. CDK's
//     `aws-lambda-nodejs` → esbuild with `format: cjs`). esbuild rewrites
//     `import.meta` to `{}` in this case, so `createRequire(import.meta.url)`
//     alone collapses to `createRequire(undefined)` and crashes at load.
// `typeof __filename` does NOT throw when the identifier is undeclared, so
// the ESM build evaluates the conditional safely.
declare const __filename: string | undefined;
const nodeRequire = createRequire(
  typeof __filename === 'string' ? __filename : import.meta.url,
);

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
