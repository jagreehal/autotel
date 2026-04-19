import { parse as parseYaml } from 'yaml';
import {
  isOfflineMode,
  readBundledJson,
  readCachedJson,
  writeCachedJson,
} from './upstream-cache';

export interface SemanticConvention {
  id: string;
  brief?: string;
  note?: string;
}

export interface SemanticConventionFile {
  namespace: string;
  version: string;
  conventions: SemanticConvention[];
}

interface GitHubContentDirectoryEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
}

const API_ROOT =
  'https://api.github.com/repos/open-telemetry/semantic-conventions/contents/model';
const RAW_ROOT =
  'https://raw.githubusercontent.com/open-telemetry/semantic-conventions/main/model';

const namespacesCache = new Map<string, string[]>();
const fileCache = new Map<string, SemanticConventionFile>();

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

export async function listSemanticConventionNamespaces(
  forceRefresh = false,
): Promise<string[]> {
  const key = 'namespaces';
  if (!forceRefresh && namespacesCache.has(key)) {
    return namespacesCache.get(key)!;
  }
  let files: string[] | undefined;
  if (!isOfflineMode()) {
    try {
      const entries =
        await githubGetJson<GitHubContentDirectoryEntry[]>(API_ROOT);
      files = entries
        .filter(
          (entry) => entry.type === 'file' && entry.name.endsWith('.yaml'),
        )
        .map((entry) => entry.name.replace(/\.yaml$/, ''))
        .sort();
      await writeCachedJson('semantic/namespaces.json', files);
    } catch {
      files = undefined;
    }
  }
  if (!files)
    files = await readCachedJson<string[]>('semantic/namespaces.json');
  if (!files)
    files = await readBundledJson<string[]>('semantic/namespaces.json');
  if (!files || files.length === 0) {
    throw new Error(
      'No semantic convention namespaces available from upstream or local snapshots.',
    );
  }

  namespacesCache.set(key, files);
  return files;
}

export async function getSemanticConventionNamespace(
  namespace: string,
): Promise<SemanticConventionFile> {
  const key = namespace;
  if (fileCache.has(key)) return fileCache.get(key)!;
  let parsed: SemanticConventionFile | undefined;

  if (!isOfflineMode()) {
    try {
      const response = await fetch(`${RAW_ROOT}/${namespace}.yaml`, {
        headers: { 'user-agent': 'autotel-mcp' },
      });
      if (!response.ok) {
        throw new Error(
          `Unable to fetch semantic convention namespace: ${namespace}`,
        );
      }

      const text = await response.text();
      const doc = parseYaml(text) as {
        groups?: Array<{ id?: string; brief?: string; note?: string }>;
      };

      const conventions: SemanticConvention[] = (doc.groups ?? [])
        .map((group) => ({
          id: group.id ?? 'unknown',
          brief: group.brief,
          note: group.note,
        }))
        .filter((item) => item.id !== 'unknown');

      parsed = {
        namespace,
        version: 'main',
        conventions,
      };
      await writeCachedJson(`semantic/namespace/${namespace}.json`, parsed);
    } catch {
      parsed = undefined;
    }
  }
  if (!parsed) {
    parsed = await readCachedJson<SemanticConventionFile>(
      `semantic/namespace/${namespace}.json`,
    );
  }
  if (!parsed) {
    parsed = await readBundledJson<SemanticConventionFile>(
      `semantic/namespace/${namespace}.json`,
    );
  }
  if (!parsed) {
    throw new Error(
      `Semantic convention namespace not found: ${namespace}. Run online once to warm cache or provide bundled snapshot.`,
    );
  }

  fileCache.set(key, parsed);
  return parsed;
}

export function clearSemanticConventionCache(): void {
  namespacesCache.clear();
  fileCache.clear();
}
