/**
 * Parser for existing CLI-owned instrumentation files.
 *
 * The init command writes section markers like `// --- AUTOTEL:BACKEND ---`
 * around regions it owns. On re-run we read the existing file, identify
 * which imports and preset slugs are already wired, and let the caller diff
 * against the new detection result so we only add what's missing.
 *
 * If the file lacks the CLI ownership header (user wrote it by hand), the
 * caller falls back to the existing abort/update/new prompt rather than
 * editing in place. This keeps surgical merging opt-in via the markers.
 */

import { hasCliOwnershipHeader } from './code-builder';

export interface ParsedInstrumentation {
  /** Has the `managed by autotel-cli` header — safe to merge. */
  cliOwned: boolean;
  /** Module specifiers already imported (e.g. 'autotel-sentry'). */
  importedSources: Set<string>;
  /** Logger module if recognised ('pino' | 'winston' | 'bunyan' | null). */
  detectedLogger: 'pino' | 'winston' | 'bunyan' | null;
  /** Strings inside `autoInstrumentations: [...]`, if present. */
  autoInstrumentations: string[];
}

/**
 * Parse an existing instrumentation file. Lightweight regex-based — we only
 * need import specifiers and the autoInstrumentations array. Full AST parse
 * is out of scope and would couple us to ts-morph here.
 */
export function parseInstrumentation(content: string): ParsedInstrumentation {
  const cliOwned = hasCliOwnershipHeader(content);
  const importedSources = collectImportSources(content);
  const detectedLogger = pickLogger(importedSources);
  const autoInstrumentations = parseAutoInstrumentations(content);

  return { cliOwned, importedSources, detectedLogger, autoInstrumentations };
}

function collectImportSources(content: string): Set<string> {
  const out = new Set<string>();
  // Matches both `import 'x';` and `import ... from 'x';` (single or double quotes).
  const re = /import\s+(?:[^'"]*\s+from\s+)?['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    if (match[1] !== undefined) out.add(match[1]);
  }
  return out;
}

function pickLogger(
  imports: Set<string>
): ParsedInstrumentation['detectedLogger'] {
  if (imports.has('pino')) return 'pino';
  if (imports.has('winston')) return 'winston';
  if (imports.has('bunyan')) return 'bunyan';
  return null;
}

function parseAutoInstrumentations(content: string): string[] {
  // Matches `autoInstrumentations: ['x', 'y']` (single quotes only, which
  // is what code-builder emits).
  const re = /autoInstrumentations\s*:\s*\[([^\]]*)\]/;
  const match = re.exec(content);
  if (!match || match[1] === undefined) return [];
  return [...match[1].matchAll(/['"]([^'"]+)['"]/g)]
    .map((m) => m[1])
    .filter((s): s is string => s !== undefined);
}

/**
 * Given the parsed existing file + the new plan's import sources, return
 * the subset of plan imports that are NEW (i.e. need to be added).
 */
export function diffImportSources(
  existing: ParsedInstrumentation,
  planImportSources: string[]
): string[] {
  return planImportSources.filter((s) => !existing.importedSources.has(s));
}

/**
 * Given the parsed existing file + the new plan's autoInstrumentation list,
 * return the entries that are NEW.
 */
export function diffAutoInstrumentations(
  existing: ParsedInstrumentation,
  planEntries: string[]
): string[] {
  return planEntries.filter((e) => !existing.autoInstrumentations.includes(e));
}
