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

// Build the Node `require` lazily on first use. Calling `createRequire`
// eagerly at module load crashes in runtimes where neither `__filename` nor
// `import.meta.url` resolves to a path — e.g. Cloudflare Workers / workerd,
// where the bundle has no module path and `createRequire(undefined)` throws
// synchronously at import. Deferring the call keeps merely importing this
// module (and therefore anything that re-exports it, such as `track`)
// side-effect-free; Node/CJS/ESM still get a real `require` on first call.
let cachedRequire: NodeRequire | undefined;

function getNodeRequire(): NodeRequire {
  if (cachedRequire) return cachedRequire;
  const base = typeof __filename === 'string' ? __filename : import.meta.url;
  if (!base) {
    // No module path in this runtime. Surface as a missing-module error so
    // optional lookups via `safeRequire()` degrade gracefully to `undefined`.
    throw Object.assign(
      new Error('node require() is unavailable in this runtime'),
      { code: 'MODULE_NOT_FOUND' },
    );
  }
  cachedRequire = createRequire(base);
  return cachedRequire;
}

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
    return getNodeRequire()(id) as T;
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
  return getNodeRequire()(id) as T;
}

/**
 * Direct access to the nodeRequire function (for advanced use cases).
 *
 * Lazily resolves the underlying Node `require` on first call, so importing
 * this binding never triggers `createRequire` in runtimes that lack a module
 * path (e.g. Cloudflare Workers).
 *
 * Only the call signature and `resolve` (including `resolve.paths`) are
 * forwarded. The live, mutable members of a real `require` — `.cache`,
 * `.main`, `.extensions` — are intentionally NOT exposed: a lazy wrapper
 * can't mirror that shared state without resolving eagerly, which would
 * reintroduce the workerd crash. Use `createRequire` directly if you need
 * them.
 */
const nodeRequire = ((id: string) => getNodeRequire()(id)) as NodeRequire;
const lazyResolve = ((id: string, options?: { paths?: string[] }) =>
  getNodeRequire().resolve(id, options)) as NodeRequire['resolve'];
lazyResolve.paths = (request: string) => getNodeRequire().resolve.paths(request);
nodeRequire.resolve = lazyResolve;

export { nodeRequire };
