/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-unsafe-dictionary-type, anti-slop/no-known-value-widening, anti-slop/no-runtime-typeof -- boundary: whatever the driver or application passed */
/** What an insert, update or batch of them leaves in a statement. */
import {
  elementsOf,
  isPlainObject,
  mapFields,
  withoutValues,
} from './statement';

/** How an updated field reads: its shape, or only that it was there. */
export type Strip = (value: unknown) => unknown;

/**
 * An update's operators (sorted, so order does not split a hash), or its
 * pipeline's stages in order. No operators: a replacement document.
 */
export function updateWithoutValues(
  update: unknown,
  strip: Strip = (value) => withoutValues(value),
): unknown {
  if (Array.isArray(update)) {
    return elementsOf(update).map((stage) =>
      isPlainObject(stage) ? mapFields(stage, (value) => strip(value)) : '?',
    );
  }
  if (!isPlainObject(update)) return '?';
  const operators = Object.entries(update)
    .filter(([key]) => key.startsWith('$'))
    .toSorted(([a], [b]) => (a < b ? -1 : 1));
  if (operators.length === 0) return '?';
  return mapFields(Object.fromEntries(operators), (value) => strip(value));
}

/** One entry per distinct shape, so a batch of 3 and one of 3000 match. */
export function batchWithoutValues(
  batch: unknown,
  strip: (entry: Record<string, unknown>) => unknown,
): unknown {
  const seen = new Map<string, unknown>();
  for (const entry of entriesOf(batch)) {
    const stripped = isPlainObject(entry) ? strip(entry) : '?';
    seen.set(JSON.stringify(stripped), stripped);
  }
  return [...seen.values()];
}

/** A batch's entries: an array, or the driver's `DocumentSequence` of them. */
export function entriesOf(batch: unknown): unknown[] {
  if (Array.isArray(batch)) return elementsOf(batch);
  if (typeof batch !== 'object' || batch === null) return [];
  // Read as a data property, so a getter stays unread.
  const documents: unknown = Object.getOwnPropertyDescriptor(
    batch,
    'documents',
  )?.value;
  return Array.isArray(documents) ? elementsOf(documents) : [];
}

/** A write's text grows with the fields it sets and the writes it batches. */
const WRITE_TEXT_MAX_LENGTH = 512;

export function capped(text: string): string {
  return text.length > WRITE_TEXT_MAX_LENGTH
    ? `${text.slice(0, WRITE_TEXT_MAX_LENGTH)}…`
    : text;
}
