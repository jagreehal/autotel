// Source-map a stack trace back to the code you wrote.
//
// Bundled output (wrangler, Vite, esbuild) throws from `index.js:9192:27`,
// which groups badly and tells a fixer nothing. Node ships a source-map
// decoder (`node:module` SourceMap), so no dependency is needed: find the map
// for a frame's file, ask it for the origin, rewrite the frame.
//
// Where the map comes from, in order:
// 1. The frame's file on disk (inside a configured root): its trailing
//    `//# sourceMappingURL=` comment (a file path or a data: URI), else
//    `<file>.map` beside it. Covers `wrangler dev`, `vite dev`, local builds.
// 2. `<mapsDir>/<basename>.map`: maps copied out of a production build, for
//    bundles whose files only exist on the host that ran them.

import { readFileSync, statSync } from 'node:fs';
import { SourceMap } from 'node:module';
import path from 'node:path';
import { resolveWithinRoot } from './source-file';

export interface SourceMapResolverOptions {
  /** Directories frame files may be read from. Defaults to none. */
  roots?: string[];
  /** Directory of uploaded `.map` files, matched by the frame file's basename. */
  mapsDir?: string;
}

interface LoadedMap {
  map: SourceMap;
  /** Directory relative source paths in the map resolve against. */
  dir: string;
}

const MAX_BYTES = 50_000_000;

function readIfSmall(file: string): string | undefined {
  try {
    const stat = statSync(file);
    if (!stat.isFile() || stat.size > MAX_BYTES) return undefined;
    return readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
}

function parseMap(
  text: string | undefined,
  dir: string,
): LoadedMap | undefined {
  if (!text) return undefined;
  try {
    return { map: new SourceMap(JSON.parse(text)), dir };
  } catch {
    return undefined;
  }
}

function fromFile(file: string): LoadedMap | undefined {
  const source = readIfSmall(file);
  if (source === undefined) return undefined;
  const dir = path.dirname(file);
  const comment = /\/\/[#@] sourceMappingURL=(\S+)\s*$/.exec(
    source.slice(-4096),
  );
  if (comment) {
    const url = comment[1]!;
    const inline =
      /^data:application\/json(?:;charset=[^;,]+)?;base64,(.+)$/.exec(url);
    if (inline) {
      return parseMap(Buffer.from(inline[1]!, 'base64').toString('utf8'), dir);
    }
    // Only a sibling path: a map URL must not walk the reader out of the root.
    if (!url.includes('/') && !url.includes('\\')) {
      const mapped = parseMap(readIfSmall(path.join(dir, url)), dir);
      if (mapped) return mapped;
    }
  }
  return parseMap(readIfSmall(`${file}.map`), dir);
}

/** `file:///a/b.js` → `/a/b.js`. */
function toPath(specifier: string): string {
  if (!specifier.startsWith('file://')) return specifier;
  try {
    return decodeURIComponent(new URL(specifier).pathname);
  } catch {
    return specifier;
  }
}

function originalPath(source: string, dir: string): string {
  if (/^[a-z][\w+.-]*:/i.test(source) && !source.startsWith('file:')) {
    // `webpack://app/./src/x.ts` and friends: keep the path part.
    return source
      .replace(/^[a-z][\w+.-]*:\/\/[^/]*\/?/i, '')
      .replace(/^\.\//, '');
  }
  return path.resolve(dir, toPath(source));
}

const NAMED = /^(\s*at\s+(?:async\s+)?)(.+?)\s+\((.+?):(\d+):(\d+)\)$/;
const ANON = /^(\s*at\s+(?:async\s+)?)(.+?):(\d+):(\d+)$/;

export interface SourceMapResolver {
  /** Rewrite every mappable frame; unmappable lines pass through unchanged. */
  resolveStack(stack: string): string;
}

export function createSourceMapResolver(
  options: SourceMapResolverOptions = {},
): SourceMapResolver {
  const roots = options.roots ?? [];
  const cache = new Map<string, LoadedMap | null>();

  function load(file: string): LoadedMap | undefined {
    const cached = cache.get(file);
    if (cached !== undefined) return cached ?? undefined;
    let loaded: LoadedMap | undefined;
    for (const root of roots) {
      const inside = resolveWithinRoot(root, file);
      if (inside) {
        loaded = fromFile(inside);
        if (loaded) break;
      }
    }
    if (!loaded && options.mapsDir) {
      const candidate = path.join(
        options.mapsDir,
        `${path.basename(file)}.map`,
      );
      loaded = parseMap(readIfSmall(candidate), options.mapsDir);
    }
    // Bounded: a long-lived receiver sees many distinct bundle paths.
    if (cache.size > 500) cache.clear();
    cache.set(file, loaded ?? null);
    return loaded;
  }

  function origin(file: string, line: number, column: number) {
    const loaded = load(toPath(file));
    if (!loaded) return undefined;
    const found = loaded.map.findOrigin(line, column) as {
      fileName?: string;
      lineNumber?: number;
      columnNumber?: number;
    };
    if (!found.fileName || found.lineNumber === undefined) return undefined;
    return {
      file: originalPath(found.fileName, loaded.dir),
      line: found.lineNumber,
      column: found.columnNumber ?? 1,
    };
  }

  return {
    resolveStack(stack) {
      if (roots.length === 0 && !options.mapsDir) return stack;
      return stack
        .split('\n')
        .map((line) => {
          const named = NAMED.exec(line);
          if (named) {
            const [, prefix, fn, file, row, col] = named;
            const hit = origin(file!, Number(row), Number(col));
            return hit
              ? `${prefix}${fn} (${hit.file}:${hit.line}:${hit.column})`
              : line;
          }
          const anon = ANON.exec(line);
          if (anon) {
            const [, prefix, file, row, col] = anon;
            const hit = origin(file!, Number(row), Number(col));
            // Not `hit.name`: that is the identifier at the position (often
            // the error class), not the enclosing function.
            return hit
              ? `${prefix}${hit.file}:${hit.line}:${hit.column}`
              : line;
          }
          return line;
        })
        .join('\n');
    },
  };
}
