// Re-export the snapshot types from autotel-subscribers and provide a
// convenience loader. Keeping the types defined in one place makes the
// contract between subscriber and generator unambiguous.

import { readFile } from 'node:fs/promises';

export type {
  ArchitectureSnapshot,
  EventObservation,
} from 'autotel-subscribers/architecture-snapshot';

import type { ArchitectureSnapshot } from 'autotel-subscribers/architecture-snapshot';

const EXPECTED_SPEC_PREFIX = 'autotel-architecture/';

/**
 * Loads and validates an autotel architecture snapshot from disk.
 *
 * Throws a descriptive error when the file is missing, contains invalid
 * JSON, or is not recognisable as an autotel snapshot, so the CLI surfaces
 * an actionable message rather than a raw `ENOENT` or `SyntaxError`.
 */
export async function loadSnapshot(
  path: string,
): Promise<ArchitectureSnapshot> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (isNodeFsError(err) && err.code === 'ENOENT') {
      throw new Error(`Snapshot not found: ${path}`);
    }
    if (isNodeFsError(err) && err.code === 'EISDIR') {
      throw new Error(`Snapshot path is a directory, not a file: ${path}`);
    }
    throw new Error(
      `Could not read snapshot at ${path}: ${(err as Error).message}`,
    );
  }

  if (raw.trim().length === 0) {
    throw new Error(`Snapshot is empty: ${path}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Snapshot is not valid JSON: ${path} (${(err as Error).message})`,
    );
  }

  return validateSnapshot(parsed, path);
}

/**
 * Type guard that narrows `unknown` to `ArchitectureSnapshot` after checking
 * every required field. Replaces the previous `as ArchitectureSnapshot` cast
 * so the type story matches the runtime story: anything reaching the return
 * has been structurally verified.
 */
function validateSnapshot(parsed: unknown, path: string): ArchitectureSnapshot {
  if (!isJsonObject(parsed)) {
    throw new Error(
      `Snapshot must be a JSON object: ${path} (got ${describe(parsed)})`,
    );
  }

  const { spec } = parsed;
  if (typeof spec !== 'string' || !spec.startsWith(EXPECTED_SPEC_PREFIX)) {
    const found =
      spec === undefined ? 'no `spec` field' : `spec=${describe(spec)}`;
    throw new Error(
      `Not an autotel architecture snapshot: ${path} (expected spec to start with "${EXPECTED_SPEC_PREFIX}", got ${found})`,
    );
  }

  // Order matters: the existing CLI surfaces "missing events" before
  // any other field-level errors, so users see the most useful diagnostic
  // first. The optional-required checks come after, only if events parsed.
  if (!isJsonObject(parsed.events)) {
    throw new Error(`Snapshot is missing required \`events\` map: ${path}`);
  }

  if (typeof parsed.service !== 'string' || parsed.service.length === 0) {
    throw new Error(`Snapshot is missing required \`service\` name: ${path}`);
  }

  if (typeof parsed.generatedAt !== 'string') {
    throw new Error(
      `Snapshot is missing required \`generatedAt\` (ISO 8601 string): ${path}`,
    );
  }

  for (const [name, observation] of Object.entries(parsed.events)) {
    if (!isJsonObject(observation)) {
      throw new Error(
        `Snapshot event "${name}" must be an object: ${path} (got ${describe(observation)})`,
      );
    }
    if (typeof observation.observedCount !== 'number') {
      throw new Error(
        `Snapshot event "${name}" is missing required \`observedCount\`: ${path}`,
      );
    }
  }

  return parsed as unknown as ArchitectureSnapshot;
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeFsError(err: unknown): err is NodeJS.ErrnoException {
  return (
    err instanceof Error &&
    typeof (err as NodeJS.ErrnoException).code === 'string'
  );
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value === 'string' ? JSON.stringify(value) : typeof value;
}
