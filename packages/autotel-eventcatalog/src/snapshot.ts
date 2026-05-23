// Re-export the snapshot types from autotel-subscribers and provide a
// convenience loader. Keeping the types defined in one place makes the
// contract between subscriber and generator unambiguous.

import { readFile } from 'node:fs/promises';

export type {
  ArchitectureSnapshot,
  EventObservation,
} from 'autotel-subscribers/architecture-snapshot';

import type { ArchitectureSnapshot } from 'autotel-subscribers/architecture-snapshot';

export async function loadSnapshot(
  path: string,
): Promise<ArchitectureSnapshot> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as ArchitectureSnapshot;
  if (!parsed?.spec?.startsWith('autotel-architecture/')) {
    throw new Error(
      `Not an autotel architecture snapshot (missing spec marker): ${path}`,
    );
  }
  return parsed;
}
