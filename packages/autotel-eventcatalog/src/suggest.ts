// Tell a rename apart from a pair of unrelated findings.
//
// `normaliseEventId` only strips case and `._-`, so `payment.succeeded` does not
// match a catalog `PaymentCaptured`. The drift report then reports two findings:
// one event that ran and is undocumented, one that is documented and never ran.
// They are the same event under two names, and reporting them as separate
// problems is the fastest way for someone to stop believing the tool.
//
// This looks for the pairing and says so. It never rewrites the report: a
// suggestion is a question for a human ("did you rename this?"), not a fact
// about the system, and silently collapsing the two findings would hide a real
// removal on the day one actually happens.

import { normaliseEventId } from './diff.js';
import type { DriftReport } from './diff.js';

export type SuggestionConfidence = 'likely' | 'possible';

export type RenameSuggestion = {
  /** Event name observed at runtime but absent from the catalog. */
  observed: string;
  /** Catalog event id that is declared but was never seen. */
  documented: string;
  /** 0..1, where 1 is an exact match of the normalised forms. */
  similarity: number;
  confidence: SuggestionConfidence;
};

/** Below this, two names are unrelated rather than a typo. */
const POSSIBLE = 0.6;
const LIKELY = 0.8;

/**
 * Levenshtein distance, two rows rather than a full matrix.
 *
 * Event names are short, so this is not worth a dependency; the row-pair form
 * keeps it linear in memory for the pathological case of a very long name.
 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current: number[] = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(
        substitution,
        previous[j]! + 1, // deletion
        current[j - 1]! + 1, // insertion
      );
    }
    [previous, current] = [current, previous];
  }

  return previous[b.length]!;
}

function similarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - editDistance(a, b) / longest;
}

/**
 * Pair each undocumented event with the closest documented-but-unseen one.
 *
 * Compared on the normalised form, so a pairing is never proposed for a
 * difference the matcher would already have absorbed — those events matched and
 * are not in either list to begin with.
 *
 * Each side is used at most once. Two undocumented events competing for the
 * same catalog entry cannot both be that rename, and offering both would send
 * someone to rename one thing twice.
 */
export function suggestRenames(report: DriftReport): RenameSuggestion[] {
  return suggestRenamesBetween(
    report.events.observedButUndocumented,
    report.events.documentedButUnseen,
  );
}

/**
 * The pairing itself, over two plain lists.
 *
 * Exported so the live map can reach the same answer from node liveness without
 * building a `DriftReport` — one rule, so the map and the report can never
 * disagree about whether something is a rename.
 */
export function suggestRenamesBetween(
  observed: string[],
  documented: string[],
): RenameSuggestion[] {
  if (observed.length === 0 || documented.length === 0) return [];

  const scored = observed
    .flatMap((observedName) =>
      documented.map((documentedId) => ({
        observed: observedName,
        documented: documentedId,
        similarity: similarity(
          normaliseEventId(observedName),
          normaliseEventId(documentedId),
        ),
      })),
    )
    .filter((pair) => pair.similarity >= POSSIBLE)
    // Best first, then by name so equal scores do not reorder between runs.
    .toSorted(
      (a, b) =>
        b.similarity - a.similarity ||
        a.observed.localeCompare(b.observed) ||
        a.documented.localeCompare(b.documented),
    );

  const usedObserved = new Set<string>();
  const usedDocumented = new Set<string>();
  const suggestions: RenameSuggestion[] = [];

  for (const pair of scored) {
    if (usedObserved.has(pair.observed)) continue;
    if (usedDocumented.has(pair.documented)) continue;
    usedObserved.add(pair.observed);
    usedDocumented.add(pair.documented);
    suggestions.push({
      observed: pair.observed,
      documented: pair.documented,
      similarity: Number(pair.similarity.toFixed(3)),
      confidence: pair.similarity >= LIKELY ? 'likely' : 'possible',
    });
  }

  return suggestions;
}

/** One line a human can act on, shared by every renderer. */
export function describeSuggestion(suggestion: RenameSuggestion): string {
  const verb = suggestion.confidence === 'likely' ? 'is probably' : 'may be';
  return `\`${suggestion.observed}\` ${verb} \`${suggestion.documented}\` renamed (${Math.round(suggestion.similarity * 100)}% similar) — rename one side, or document it as a new event.`;
}
