// Stamp an architecture snapshot into a catalog's event mdx files.
//
// For each event in the snapshot that matches an event in the catalog (by
// normalised name), the stamp command writes an evidence block between
// `<!-- autotel:stamp-start -->` and `<!-- autotel:stamp-end -->` markers.
// Subsequent runs replace the content between the markers idempotently, so
// re-stamping is safe to run on every commit / in CI.
//
// If the markers do not yet exist in a file, they are inserted at the most
// natural place: just before the `<Footer />` component if present, else
// just before the closing `</...>` tag of the last visible content, else
// appended to the file.

import { readFile, writeFile } from 'node:fs/promises';
import type { ArchitectureSnapshot, EventObservation } from './snapshot';
import { readCatalogState } from './catalog';

export const STAMP_START = '<!-- autotel:stamp-start -->';
export const STAMP_END = '<!-- autotel:stamp-end -->';

export interface StampOptions {
  /** Loaded snapshot, OR pass `loadSnapshot(path)` from the caller. */
  snapshot: ArchitectureSnapshot;
  /** Catalog root (the directory containing eventcatalog.config.*). */
  catalogPath: string;
  /** If true, do not write files — just return the diff plan. */
  dryRun?: boolean;
  /** Override "now" for deterministic tests. */
  now?: () => Date;
}

export type StampUpdate = {
  /** Catalog event id, e.g. `OrderPlaced`. */
  catalogId: string;
  /** Snapshot event name, e.g. `order.placed`. */
  snapshotName: string;
  /** Absolute path to the mdx file that was (or would be) updated. */
  filePath: string;
  /** Was this an insert (no prior markers) or a replace? */
  action: 'insert' | 'replace';
  /**
   * True if the proposed content differs from what's on disk. False when a
   * replace would write byte-identical content — meaning no real change.
   * Used by `--summary-output` so CI can answer "did this PR need stamping?"
   * without diffing files.
   */
  changed: boolean;
};

export type StampSkip = {
  snapshotName: string;
  reason: 'no-catalog-match';
};

export type StampResult = {
  updates: StampUpdate[];
  skips: StampSkip[];
};

export async function stampCatalog(opts: StampOptions): Promise<StampResult> {
  const { snapshot, catalogPath, dryRun = false } = opts;
  const catalog = await readCatalogState(catalogPath);

  const catalogByNormalised = new Map<
    string,
    { id: string; filePath: string }
  >();
  for (const [id, ev] of catalog.events) {
    catalogByNormalised.set(normaliseEventId(id), {
      id,
      filePath: ev.filePath,
    });
  }

  const updates: StampUpdate[] = [];
  const skips: StampSkip[] = [];

  for (const [name, obs] of Object.entries(snapshot.events)) {
    const match = catalogByNormalised.get(normaliseEventId(name));
    if (!match) {
      skips.push({ snapshotName: name, reason: 'no-catalog-match' });
      continue;
    }

    const block = buildStampBlock(obs);
    const { action, changed } = await stampFile(match.filePath, block, dryRun);

    updates.push({
      catalogId: match.id,
      snapshotName: name,
      filePath: match.filePath,
      action,
      changed,
    });
  }

  return { updates, skips };
}

/**
 * Render the evidence block. Designed to be readable in raw mdx AND visually
 * distinct when rendered by EventCatalog (uses the existing
 * `.evidence-callout` class, plus a small header label).
 */
export function buildStampBlock(obs: EventObservation): string {
  const lines: string[] = [];
  lines.push(STAMP_START);
  lines.push('');
  lines.push('<div class="evidence-callout">');
  lines.push('<strong>Observed in autotel snapshot</strong>');
  lines.push('');
  const facts: string[] = [];
  facts.push(`**Volume**: ${obs.observedCount.toLocaleString()} events`);
  facts.push(`**Last seen**: ${formatTimestamp(obs.lastSeen)}`);
  if (obs.producer) facts.push(`**Producer**: ${obs.producer}`);
  if (obs.channel) facts.push(`**Channel**: \`${obs.channel}\``);
  lines.push(facts.join(' · '));
  if (obs.fieldPaths.length > 0) {
    lines.push('');
    lines.push(
      `**Field paths observed**: ${obs.fieldPaths.map((p) => `\`${p}\``).join(', ')}`,
    );
  }
  if (obs.sampleTraceIds.length > 0) {
    lines.push('');
    lines.push(
      `**Sample traces**: ${obs.sampleTraceIds.map((t) => `\`${t}\``).join(', ')}`,
    );
  }
  lines.push('</div>');
  lines.push('');
  lines.push(STAMP_END);

  return lines.join('\n');
}

async function stampFile(
  filePath: string,
  block: string,
  dryRun: boolean,
): Promise<{ action: 'insert' | 'replace'; changed: boolean }> {
  const content = await readFile(filePath, 'utf8');

  const startIdx = content.indexOf(STAMP_START);
  const endIdx = content.indexOf(STAMP_END);

  let next: string;
  let action: 'insert' | 'replace';

  if (startIdx >= 0 && endIdx > startIdx) {
    // Replace existing block (including markers).
    const before = content.slice(0, startIdx);
    const after = content.slice(endIdx + STAMP_END.length);
    next = before + block + after;
    action = 'replace';
  } else {
    // Insert. Prefer just before <Footer /> if present, else append.
    const footerIdx = content.search(/<Footer\s*\/>/);
    const insertion = '\n\n' + block + '\n';
    if (footerIdx >= 0) {
      next =
        content.slice(0, footerIdx) +
        insertion +
        '\n' +
        content.slice(footerIdx);
    } else {
      next = content.replace(/\s*$/, '') + insertion;
    }
    action = 'insert';
  }

  const changed = next !== content;
  if (!dryRun && changed) {
    await writeFile(filePath, next, 'utf8');
  }
  return { action, changed };
}

/** Versioned identifier for the stamp summary JSON file. */
export const STAMP_SUMMARY_SPEC =
  'autotel-eventcatalog-stamp-summary/v0.1.0' as const;

export type StampSummary = {
  spec: typeof STAMP_SUMMARY_SPEC;
  dryRun: boolean;
  /** Total snapshot events the stamp run considered (matched + skipped). */
  attempted: number;
  /** Skipped events (no catalog match). */
  skipped: number;
  /** Matched events that resulted in an insert action. */
  inserts: number;
  /** Matched events that resulted in a replace action. */
  replaces: number;
  /** Number of files whose content actually changed (or would change in dry-run). */
  changedFiles: number;
  /**
   * True when the run produced (or would produce) any real change. CI can
   * gate on this: "if the committed catalog is stamped, this should be
   * false after running stamp; if not, the PR forgot to re-stamp."
   */
  hadChanges: boolean;
};

export function buildStampSummary(
  result: StampResult,
  dryRun: boolean,
): StampSummary {
  const inserts = result.updates.filter((u) => u.action === 'insert').length;
  const replaces = result.updates.filter((u) => u.action === 'replace').length;
  const changedFiles = result.updates.filter((u) => u.changed).length;
  return {
    spec: STAMP_SUMMARY_SPEC,
    dryRun,
    attempted: result.updates.length + result.skips.length,
    skipped: result.skips.length,
    inserts,
    replaces,
    changedFiles,
    hadChanges: changedFiles > 0,
  };
}

function normaliseEventId(id: string): string {
  return id.toLowerCase().replace(/[._\-\s]/g, '');
}

function formatTimestamp(iso: string): string {
  // 2026-05-22T05:23:50.024Z → 2026-05-22 05:23 UTC
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}
