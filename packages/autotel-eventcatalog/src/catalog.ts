// Read the current state of an EventCatalog by walking its filesystem. We
// avoid taking a dependency on @eventcatalog/sdk so the generator stays lean
// and the read path is deterministic — we look for index.mdx files and parse
// just enough YAML frontmatter to know what events / services / channels
// exist and where their declared schemas live.

import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, basename, sep } from 'node:path';

/**
 * Normalise any OS-native path (forward or back slashes) to a POSIX-style
 * path with forward slashes. Path segment matching in this module then has
 * one canonical separator to reason about, which is correct on every OS
 * including Windows runners.
 */
function toPosix(p: string): string {
  return sep === '/' ? p : p.split(sep).join('/');
}

export type CatalogEvent = {
  id: string;
  version?: string;
  filePath: string;
  /** Field paths declared in the event's JSON Schema (if present). */
  declaredFieldPaths?: string[];
  schemaPath?: string;
};

export type CatalogService = {
  id: string;
  version?: string;
  filePath: string;
};

export type CatalogChannel = {
  id: string;
  version?: string;
  filePath: string;
};

export type CatalogState = {
  events: Map<string, CatalogEvent>;
  services: Map<string, CatalogService>;
  channels: Map<string, CatalogChannel>;
};

export async function readCatalogState(
  catalogPath: string,
): Promise<CatalogState> {
  const state: CatalogState = {
    events: new Map(),
    services: new Map(),
    channels: new Map(),
  };

  for await (const entry of walk(catalogPath)) {
    if (basename(entry) !== 'index.mdx') continue;
    const posixEntry = toPosix(entry);
    if (posixEntry.includes('/.eventcatalog-core/')) continue;
    if (posixEntry.includes('/versioned/')) continue;

    const frontmatter = await readFrontmatter(entry);
    if (!frontmatter?.id) continue;

    const kind = classifyByPath(posixEntry);
    if (!kind) continue;

    if (kind === 'event') {
      state.events.set(frontmatter.id, {
        id: frontmatter.id,
        version: frontmatter.version,
        filePath: entry,
        schemaPath: frontmatter.schemaPath
          ? join(dirname(entry), frontmatter.schemaPath)
          : undefined,
        declaredFieldPaths: frontmatter.schemaPath
          ? await readSchemaFieldPaths(
              join(dirname(entry), frontmatter.schemaPath),
            )
          : undefined,
      });
    } else if (kind === 'service') {
      state.services.set(frontmatter.id, {
        id: frontmatter.id,
        version: frontmatter.version,
        filePath: entry,
      });
    } else if (kind === 'channel') {
      state.channels.set(frontmatter.id, {
        id: frontmatter.id,
        version: frontmatter.version,
        filePath: entry,
      });
    }
  }

  return state;
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (
      name === 'node_modules' ||
      name === '.git' ||
      name === '.eventcatalog-core'
    ) {
      continue;
    }
    const full = join(dir, name);
    const s = await stat(full);
    if (s.isDirectory()) {
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

/** @internal — exported for tests only. */
export const __test = { toPosix, classifyByPath };

/**
 * Classify a path by its enclosing directory segments. Expects a POSIX-style
 * path (forward slashes) — callers must normalise via `toPosix` first.
 * EventCatalog convention is `.../services/<X>/index.mdx`,
 * `.../events/<Y>/index.mdx`, `.../channels/<Z>/index.mdx`.
 */
function classifyByPath(
  filePath: string,
): 'event' | 'service' | 'channel' | null {
  const segs = filePath.split('/').slice(0, -1);
  for (let i = segs.length - 1; i >= 0; i--) {
    if (segs[i] === 'events') return 'event';
    if (segs[i] === 'channels') return 'channel';
    if (segs[i] === 'services' && i === segs.length - 2) return 'service';
  }
  return null;
}

/**
 * Minimal frontmatter parser. We only need a handful of scalar keys (id,
 * version, schemaPath) — taking a YAML dependency for this would be
 * overkill, and being conservative about what we parse keeps surprises low.
 */
type Frontmatter = {
  id?: string;
  version?: string;
  schemaPath?: string;
};

async function readFrontmatter(filePath: string): Promise<Frontmatter | null> {
  const content = await readFile(filePath, 'utf8');
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm: Frontmatter = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim().replace(/^['"]|['"]$/g, '');
    if (key === 'id') fm.id = value;
    else if (key === 'version') fm.version = value;
    else if (key === 'schemaPath') fm.schemaPath = value;
  }
  return fm;
}

async function readSchemaFieldPaths(path: string): Promise<string[]> {
  try {
    const raw = await readFile(path, 'utf8');
    const schema = JSON.parse(raw);
    return extractDeclaredFieldPaths(schema);
  } catch {
    return [];
  }
}

/**
 * Extract field paths from a JSON Schema. Mirrors the dotted-path convention
 * used by the snapshot subscriber: arrays collapse to `[]`, nested objects
 * use `.`. We walk `properties` (objects) and `items` (arrays).
 */
export function extractDeclaredFieldPaths(
  schema: unknown,
  prefix = '',
): string[] {
  const out = new Set<string>();
  walkSchema(schema, prefix, out);
  return [...out].sort();
}

function walkSchema(schema: unknown, prefix: string, out: Set<string>): void {
  if (!schema || typeof schema !== 'object') return;
  const s = schema as Record<string, unknown>;

  if (s.properties && typeof s.properties === 'object') {
    for (const [key, sub] of Object.entries(
      s.properties as Record<string, unknown>,
    )) {
      const path = prefix === '' ? key : `${prefix}.${key}`;
      out.add(path);
      walkSchema(sub, path, out);
    }
  }

  if (s.items) {
    const arrayPrefix = prefix + '[]';
    walkSchema(s.items, arrayPrefix, out);
  }
}
