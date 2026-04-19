import { parse as parseYaml } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  isOfflineMode,
  readBundledJson,
  readBundledText,
  readCachedJson,
  readCachedText,
  writeCachedJson,
  writeCachedText,
} from './upstream-cache';

export type CollectorComponentKind =
  | 'receiver'
  | 'processor'
  | 'exporter'
  | 'connector'
  | 'extension';

export interface CollectorValidationResult {
  valid: boolean;
  summary: string;
  issues?: string[];
}

interface GitHubContentDirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
}

const API_ROOT =
  'https://api.github.com/repos/pavolloffay/opentelemetry-mcp-server/contents/modules/collectorschema/schemas';
const RAW_ROOT =
  'https://raw.githubusercontent.com/pavolloffay/opentelemetry-mcp-server/main/modules/collectorschema/schemas';

const versionsCache = new Map<string, string[]>();
const componentsCache = new Map<
  string,
  Record<CollectorComponentKind, string[]>
>();
const schemaCache = new Map<string, object>();
const readmeCache = new Map<string, string>();

const VERSION_RE = /^\d+\.\d+\.\d+$/;
const FILE_RE =
  /^(receiver|processor|exporter|connector|extension)_([a-zA-Z0-9_-]+)\.(yaml|md)$/;
const SNAPSHOT_VERSION = '0.147.0';

function cmpVersionDesc(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function githubGetJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'autotel-mcp',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  return (await response.json()) as T;
}

export async function listCollectorVersions(
  forceRefresh = false,
): Promise<string[]> {
  const key = 'versions';
  if (!forceRefresh && versionsCache.has(key)) {
    return versionsCache.get(key)!;
  }
  let versions: string[] | undefined;

  if (!isOfflineMode()) {
    try {
      const entries =
        await githubGetJson<GitHubContentDirectoryEntry[]>(API_ROOT);
      versions = entries
        .filter((entry) => entry.type === 'dir' && VERSION_RE.test(entry.name))
        .map((entry) => entry.name)
        .sort(cmpVersionDesc);
      await writeCachedJson('collector/versions.json', versions);
    } catch {
      versions = undefined;
    }
  }

  if (!versions) {
    versions = await readCachedJson<string[]>('collector/versions.json');
  }
  if (!versions) {
    versions = await readBundledJson<string[]>('collector/versions.json');
  }
  if (!versions || versions.length === 0) {
    throw new Error(
      'No collector schema versions available from upstream or local snapshots.',
    );
  }

  versionsCache.set(key, versions);
  return versions;
}

export async function resolveCollectorVersion(
  version?: string,
): Promise<string> {
  if (version) return version;
  const versions = await listCollectorVersions();
  if (versions.length === 0) {
    throw new Error('No collector schema versions available from upstream.');
  }
  return versions[0]!;
}

export async function listCollectorComponents(
  version?: string,
  forceRefresh = false,
): Promise<Record<CollectorComponentKind, string[]>> {
  const resolved = await resolveCollectorVersion(version);
  if (!forceRefresh && componentsCache.has(resolved)) {
    return componentsCache.get(resolved)!;
  }

  let normalized: Record<CollectorComponentKind, string[]> | undefined;
  if (!isOfflineMode()) {
    try {
      const entries = await githubGetJson<GitHubContentDirectoryEntry[]>(
        `${API_ROOT}/${resolved}`,
      );

      const out: Record<CollectorComponentKind, Set<string>> = {
        receiver: new Set(),
        processor: new Set(),
        exporter: new Set(),
        connector: new Set(),
        extension: new Set(),
      };

      for (const entry of entries) {
        if (entry.type !== 'file') continue;
        const match = FILE_RE.exec(entry.name);
        if (!match) continue;
        const kind = match[1] as CollectorComponentKind;
        const name = match[2]!;
        out[kind].add(name);
      }

      normalized = {
        receiver: [...out.receiver].sort(),
        processor: [...out.processor].sort(),
        exporter: [...out.exporter].sort(),
        connector: [...out.connector].sort(),
        extension: [...out.extension].sort(),
      };
      await writeCachedJson(
        `collector/components/${resolved}.json`,
        normalized,
      );
    } catch {
      normalized = undefined;
    }
  }

  if (!normalized) {
    normalized = await readCachedJson<Record<CollectorComponentKind, string[]>>(
      `collector/components/${resolved}.json`,
    );
  }
  if (!normalized) {
    normalized = await readBundledJson<
      Record<CollectorComponentKind, string[]>
    >(`collector/components/${resolved}.json`);
  }
  if (!normalized) {
    normalized = await readBundledJson<
      Record<CollectorComponentKind, string[]>
    >(`collector/components/${SNAPSHOT_VERSION}.json`);
  }
  if (!normalized) {
    throw new Error(
      `No collector component catalog available for version ${resolved}.`,
    );
  }

  componentsCache.set(resolved, normalized);
  return normalized;
}

async function fetchRawText(path: string): Promise<string> {
  const response = await fetch(`${RAW_ROOT}/${path}`, {
    headers: { 'user-agent': 'autotel-mcp' },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${RAW_ROOT}/${path}`);
  }
  return response.text();
}

export async function getCollectorComponentSchema(
  kind: CollectorComponentKind,
  name: string,
  version?: string,
): Promise<object> {
  const resolved = await resolveCollectorVersion(version);
  const key = `${resolved}:${kind}:${name}`;
  if (schemaCache.has(key)) return schemaCache.get(key)!;

  const cachePath = `collector/schema/${resolved}/${kind}_${name}.json`;
  let parsed: object | undefined;

  if (!isOfflineMode()) {
    try {
      const text = await fetchRawText(`${resolved}/${kind}_${name}.yaml`);
      parsed = parseYaml(text) as object;
      await writeCachedJson(cachePath, parsed);
    } catch {
      parsed = undefined;
    }
  }

  if (!parsed) parsed = await readCachedJson<object>(cachePath);
  if (!parsed) parsed = await readBundledJson<object>(cachePath);
  if (!parsed && resolved !== SNAPSHOT_VERSION) {
    parsed = await readBundledJson<object>(
      `collector/schema/${SNAPSHOT_VERSION}/${kind}_${name}.json`,
    );
  }
  if (!parsed) {
    throw new Error(
      `Schema not found for ${kind} ${name} (${resolved}) in upstream or local caches.`,
    );
  }

  schemaCache.set(key, parsed);
  return parsed;
}

export async function getCollectorComponentReadme(
  kind: CollectorComponentKind,
  name: string,
  version?: string,
): Promise<string> {
  const resolved = await resolveCollectorVersion(version);
  const key = `${resolved}:${kind}:${name}`;
  if (readmeCache.has(key)) return readmeCache.get(key)!;

  const cachePath = `collector/readme/${resolved}/${kind}_${name}.md`;
  let text: string | undefined;
  if (!isOfflineMode()) {
    try {
      text = await fetchRawText(`${resolved}/${kind}_${name}.md`);
      await writeCachedText(cachePath, text);
    } catch {
      text = undefined;
    }
  }
  if (!text) text = await readCachedText(cachePath);
  if (!text) text = await readBundledText(cachePath);
  if (!text && resolved !== SNAPSHOT_VERSION) {
    text = await readBundledText(
      `collector/readme/${SNAPSHOT_VERSION}/${kind}_${name}.md`,
    );
  }
  if (!text) {
    throw new Error(
      `README not found for ${kind} ${name} (${resolved}) in upstream or local caches.`,
    );
  }
  readmeCache.set(key, text);
  return text;
}

export async function validateCollectorComponentConfig(params: {
  kind: CollectorComponentKind;
  name: string;
  version?: string;
  config: unknown;
}): Promise<CollectorValidationResult> {
  try {
    const schema = await getCollectorComponentSchema(
      params.kind,
      params.name,
      params.version,
    );

    const ajv = new Ajv2020({
      allErrors: true,
      strict: false,
      allowUnionTypes: true,
      validateFormats: false,
    });
    const validate = ajv.compile(schema);
    const valid = validate(params.config);
    if (valid) {
      return {
        valid: true,
        summary: `Config is valid for ${params.kind} ${params.name}`,
      };
    }

    return {
      valid: false,
      summary: `Config is invalid for ${params.kind} ${params.name}`,
      issues: (validate.errors ?? []).map((error) => {
        const path = error.instancePath || '/';
        return `${path} ${error.message ?? 'validation error'}`.trim();
      }),
    };
  } catch (error) {
    return {
      valid: false,
      summary: `Validation failed for ${params.kind} ${params.name}`,
      issues: [error instanceof Error ? error.message : String(error)],
    };
  }
}

export async function refreshCollectorCatalog(): Promise<{
  versions: number;
  latestVersion: string | null;
  components: Record<CollectorComponentKind, number>;
}> {
  versionsCache.clear();
  componentsCache.clear();
  schemaCache.clear();
  readmeCache.clear();

  const versions = await listCollectorVersions(true);
  const latest = versions[0] ?? null;
  if (!latest) {
    return {
      versions: 0,
      latestVersion: null,
      components: {
        receiver: 0,
        processor: 0,
        exporter: 0,
        connector: 0,
        extension: 0,
      },
    };
  }

  const components = await listCollectorComponents(latest, true);
  return {
    versions: versions.length,
    latestVersion: latest,
    components: {
      receiver: components.receiver.length,
      processor: components.processor.length,
      exporter: components.exporter.length,
      connector: components.connector.length,
      extension: components.extension.length,
    },
  };
}

export function clearCollectorCatalogCache(): void {
  versionsCache.clear();
  componentsCache.clear();
  schemaCache.clear();
  readmeCache.clear();
}
