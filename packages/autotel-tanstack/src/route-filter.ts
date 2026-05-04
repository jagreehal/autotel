import { shouldInstrumentPath } from 'autotel-edge';

/**
 * TanStack historically supported:
 * - glob strings (`/api/internal/*`)
 * - regex values
 * - plain-string prefix matching (`/health` matches `/healthz`)
 *
 * This helper keeps those semantics while delegating glob matching to
 * autotel-edge's shared middleware toolkit.
 */
export function isExcludedPath(
  pathname: string,
  excludePaths: Array<string | RegExp>,
): boolean {
  for (const pattern of excludePaths) {
    if (pattern instanceof RegExp) {
      if (pattern.test(pathname)) return true;
      continue;
    }

    if (pattern.includes('*') || pattern.includes('?')) {
      if (
        !shouldInstrumentPath(pathname, {
          include: undefined,
          exclude: [pattern],
        })
      ) {
        return true;
      }
      continue;
    }

    if (pathname === pattern || pathname.startsWith(pattern)) {
      return true;
    }
  }

  return false;
}
