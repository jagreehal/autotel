import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Snapshot storage.
 *
 * A snapshot is just a file you commit: the serialized shape of a message,
 * reviewed once and from then on compared on every run. There is no broker, no
 * registry, no service to start — a format change shows up in a normal diff,
 * reviewed like any other code. This mirrors the "approved file" convention
 * (`<name>.approved.txt`) familiar from approval testing.
 *
 * By default the file lives in a `__contracts__` directory beside the test that
 * created it, resolved from the call stack so you do not have to thread paths
 * around. Override `dir` / `path` when you keep snapshots elsewhere.
 */

/** Set any of these (e.g. `AUTOTEL_CONTRACT_UPDATE=1`) to (re)write approved files. */
const UPDATE_ENV_VARS = [
  'AUTOTEL_CONTRACT_UPDATE',
  'UPDATE_CONTRACTS',
  'UPDATE_SNAPSHOTS',
] as const;

export function isUpdateMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return UPDATE_ENV_VARS.some((name) => {
    const value = env[name];
    return value === '1' || value === 'true';
  });
}

export interface SnapshotLocation {
  /** Directory holding the approved file. */
  dir?: string;
  /** Logical name; the file becomes `<name>.approved.txt`. */
  name: string;
  /** Fully-qualified path; when set, `dir`/`name` are ignored for placement. */
  path?: string;
}

const DEFAULT_DIR_NAME = '__contracts__';
const APPROVED_SUFFIX = '.approved.txt';

/** Resolve the absolute file path for a snapshot. */
export function resolveSnapshotPath(location: SnapshotLocation): string {
  if (location.path) {
    return path.isAbsolute(location.path)
      ? location.path
      : path.resolve(process.cwd(), location.path);
  }
  const dir = location.dir ?? defaultSnapshotDir();
  return path.join(dir, `${sanitize(location.name)}${APPROVED_SUFFIX}`);
}

function sanitize(name: string): string {
  // Keep it filesystem-safe while preserving readable type names.
  return name.replaceAll(/[^\w.@-]+/g, '_');
}

export interface ReadSnapshotResult {
  exists: boolean;
  content?: string;
  path: string;
}

export function readSnapshot(location: SnapshotLocation): ReadSnapshotResult {
  const filePath = resolveSnapshotPath(location);
  if (!existsSync(filePath)) return { exists: false, path: filePath };
  return { exists: true, content: readFileSync(filePath, 'utf8'), path: filePath };
}

export function writeSnapshot(
  location: SnapshotLocation,
  content: string,
): string {
  const filePath = resolveSnapshotPath(location);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

/**
 * Best-effort `__contracts__` directory beside the calling test file, found by
 * walking the stack past this module and the contract internals. Falls back to
 * `<cwd>/__contracts__` when the caller cannot be determined (e.g. bundled).
 */
function defaultSnapshotDir(): string {
  const callerFile = callerOutsidePackage();
  const base = callerFile ? path.dirname(callerFile) : process.cwd();
  return path.join(base, DEFAULT_DIR_NAME);
}

function callerOutsidePackage(): string | undefined {
  const stack = new Error('stack probe').stack;
  if (!stack) return undefined;
  const lines = stack.split('\n').slice(1);
  for (const line of lines) {
    const match = line.match(/\((.*?):\d+:\d+\)/) ?? line.match(/at (.*?):\d+:\d+/);
    const file = match?.[1];
    if (!file) continue;
    if (file.includes('node:')) continue;
    // Skip frames inside this package's own source/dist.
    if (file.includes(`${path.join('autotel-message-contract', 'src')}`)) continue;
    if (file.includes(`${path.join('autotel-message-contract', 'dist')}`)) continue;
    if (file.includes('node_modules')) continue;
    return file.startsWith('file://') ? fileUrlToPath(file) : file;
  }
  return undefined;
}

function fileUrlToPath(url: string): string {
  return decodeURIComponent(url.replace(/^file:\/\//, ''));
}
