/**
 * Whether `autotel.map.json` still describes the source. A route added after
 * the last `autotel map` run is in neither the map nor the telemetry, so the
 * coverage view would list everything as accounted for while it sits dark.
 *
 * Generated directories are skipped: a build writing `dist/` says nothing about
 * whether the authored source changed, and counting it would mark every map
 * stale after the first build.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const GENERATED = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  '.turbo',
  '.vercel',
  '.wrangler',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'vendor',
]);

const SOURCE = /\.(?:[cm]?[jt]sx?|svelte|vue|astro)$/;

// A bounded walk: a tree past the cap reports `unknown` rather than holding
// up the request.
const MAX_ENTRIES = 50_000;

export interface MapFreshness {
  status: 'fresh' | 'stale' | 'unknown';
  /** When the map was written (epoch ms). */
  mapWrittenAt: number;
  /** A source file changed after the map, repo-relative; set when `stale`. */
  newerFile?: string;
}

export function mapFreshness(
  sourceRoot: string,
  mapPath: string,
): MapFreshness {
  const mapWrittenAt = statSync(mapPath).mtimeMs;
  const pending = [sourceRoot];
  let seen = 0;
  while (pending.length > 0) {
    const dir = pending.pop()!;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unreadable directory: not evidence either way
    }
    for (const entry of entries) {
      if (++seen > MAX_ENTRIES) return { status: 'unknown', mapWrittenAt };
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!GENERATED.has(entry.name)) pending.push(path);
      } else if (
        SOURCE.test(entry.name) &&
        statSync(path).mtimeMs > mapWrittenAt
      ) {
        return {
          status: 'stale',
          mapWrittenAt,
          newerFile: relative(sourceRoot, path),
        };
      }
    }
  }
  return { status: 'fresh', mapWrittenAt };
}
