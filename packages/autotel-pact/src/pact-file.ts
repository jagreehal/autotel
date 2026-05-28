import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { PactFile, PactInteractionKey } from './types.js';

/**
 * Walk a directory and return absolute paths of all *.json pact files.
 */
export function listPactFiles(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listPactFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      out.push(full);
    }
  }
  return out;
}

export function extractInteractionId(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  if (!metadata) return undefined;
  const id = metadata.interactionId ?? metadata.interaction_id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * Extract interaction tuples declared in a pact file.
 */
export function interactionsFromPactFile(pact: PactFile): PactInteractionKey[] {
  const consumer = pact.consumer?.name;
  const provider = pact.provider?.name;
  if (!consumer || !provider) return [];
  const keys: PactInteractionKey[] = [];
  for (const m of pact.messages ?? []) {
    keys.push({
      consumer,
      provider,
      interaction: m.description,
      kind: 'message',
      interactionId: extractInteractionId(m.metadata),
    });
  }
  for (const i of pact.interactions ?? []) {
    keys.push({
      consumer,
      provider,
      interaction: i.description,
      kind: 'http',
      interactionId: extractInteractionId(i.metadata),
    });
  }
  return keys;
}

export function parsePactFile(filePath: string): PactFile | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as PactFile;
  } catch {
    return null;
  }
}
