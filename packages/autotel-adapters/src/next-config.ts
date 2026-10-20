/**
 * Next.js config for autotel: one `@opentelemetry/api` for every bundle.
 *
 * When autotel and an instrumentation (`@prisma/instrumentation`) land on
 * different sides of the bundle, they run on two copies of
 * `@opentelemetry/api`. Next bundles every package it is not told to
 * externalize, including a listed one it cannot resolve from the app (a
 * workspace package's dependency, or a workspace link).
 *
 * Externalizing `@opentelemetry/api` itself gives every package the app's one
 * copy at runtime, bundled or not. This module has no runtime dependency, so
 * `next.config.ts` can import it.
 */

import * as path from 'node:path';
import * as fs from 'node:fs';

/** The part of a Next.js config this reads and writes. */
export interface NextConfigLike {
  serverExternalPackages?: string[];
}

export interface AutotelNextConfigOptions {
  /**
   * More packages to keep external, e.g. `['@prisma/instrumentation']`.
   * `@opentelemetry/api` is always included.
   */
  externals?: string[];
  /** The app's directory, for checking each package resolves. Default: cwd. */
  projectDir?: string;
}

/**
 * Add `@opentelemetry/api` (and `externals`) to `serverExternalPackages`.
 *
 * Throws when one is not resolvable from the app, since Next would bundle it.
 *
 * @example
 * ```typescript
 * // next.config.ts
 * import { withAutotelConfig } from 'autotel-adapters/next-config';
 *
 * export default withAutotelConfig(
 *   { reactCompiler: true },
 *   { externals: ['@prisma/instrumentation'] },
 * );
 * ```
 */
export function withAutotelConfig<T extends object>(
  config: T & NextConfigLike,
  options: AutotelNextConfigOptions = {},
): T & { serverExternalPackages: string[] } {
  const projectDir = options.projectDir ?? process.cwd();
  const wanted = ['@opentelemetry/api', ...(options.externals ?? [])];
  const missing = wanted.filter((name) => !resolvableFrom(projectDir, name));
  if (missing.length > 0) {
    throw new Error(
      `[autotel] ${missing.join(', ')} must be resolvable from ${projectDir} for Next.js to keep ` +
        'it external; otherwise Next bundles it without a warning and autotel can end up on a second ' +
        `@opentelemetry/api copy. Add ${missing.length === 1 ? 'it' : 'them'} to the dependencies of this app.`,
    );
  }
  return {
    ...config,
    serverExternalPackages: [
      ...new Set([...(config.serverExternalPackages ?? []), ...wanted]),
    ],
  };
}

/**
 * Whether `name` is installed where a bundler looks from `dir`: a
 * `node_modules/<name>` here or in a parent. `require.resolve` also reads
 * NODE_PATH, which pnpm sets for scripts and Next's resolver ignores.
 */
function resolvableFrom(dir: string, name: string): boolean {
  for (let current = path.resolve(dir); ; current = path.dirname(current)) {
    if (
      fs.existsSync(path.join(current, 'node_modules', name, 'package.json'))
    ) {
      return true;
    }
    if (path.dirname(current) === current) return false;
  }
}
