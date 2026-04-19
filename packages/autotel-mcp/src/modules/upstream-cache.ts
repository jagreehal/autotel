import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export function isOfflineMode(): boolean {
  const value = env('AUTOTEL_OFFLINE_MODE');
  if (!value) return false;
  return TRUTHY.has(value.toLowerCase());
}

export function getUpstreamCacheDir(): string {
  return (
    env('AUTOTEL_UPSTREAM_CACHE_DIR') ??
    path.resolve(process.cwd(), '.autotel-cache')
  );
}

async function readUtf8(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

export async function readCachedJson<T>(
  relativePath: string,
): Promise<T | undefined> {
  const filePath = path.join(getUpstreamCacheDir(), relativePath);
  const text = await readUtf8(filePath);
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

export async function writeCachedJson(
  relativePath: string,
  value: unknown,
): Promise<void> {
  const filePath = path.join(getUpstreamCacheDir(), relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

export async function readCachedText(
  relativePath: string,
): Promise<string | undefined> {
  const filePath = path.join(getUpstreamCacheDir(), relativePath);
  return readUtf8(filePath);
}

export async function writeCachedText(
  relativePath: string,
  value: string,
): Promise<void> {
  const filePath = path.join(getUpstreamCacheDir(), relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value, 'utf8');
}

export async function readBundledJson<T>(
  relativePath: string,
): Promise<T | undefined> {
  const filePath = fileURLToPath(
    new URL(`../../fixtures/upstream/${relativePath}`, import.meta.url),
  );
  const text = await readUtf8(filePath);
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

export async function readBundledText(
  relativePath: string,
): Promise<string | undefined> {
  const filePath = fileURLToPath(
    new URL(`../../fixtures/upstream/${relativePath}`, import.meta.url),
  );
  return readUtf8(filePath);
}
