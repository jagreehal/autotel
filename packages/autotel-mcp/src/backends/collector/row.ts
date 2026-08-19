/**
 * Reading a column off a libsql row.
 *
 * The driver types every column as its own union of what SQLite can hold; the
 * schema in `schema.ts` says which of those a given column actually is. These
 * readers are where the two meet, so the store's own code reads columns by
 * name and gets the type its schema declares.
 */
import type { Row } from '@libsql/client';
import { asNumber, asString } from '../../lib/values';

/** A text column the schema declares NOT NULL. */
export function text(row: Row, key: string): string {
  return asString(row[key]) ?? '';
}

/** A text column the schema allows to be null. */
export function optionalText(row: Row, key: string): string | undefined {
  const value = asString(row[key]);
  return value === undefined || value === '' ? undefined : value;
}

/** A numeric column. */
export function count(row: Row, key: string): number {
  return asNumber(row[key]) ?? 0;
}

/** A boolean column, stored as 0 or 1. */
export function flag(row: Row, key: string): boolean {
  return count(row, key) === 1;
}

/**
 * A JSON column, parsed back into the shape the store wrote.
 *
 * SAFETY: the same store serialised this column a few methods above, from the
 * type named here. A row hand-edited outside the store reads back as whatever
 * it now holds - which is what the fallback is for when it is not JSON at all.
 */
export function json<TValue>(row: Row, key: string, fallback: TValue): TValue {
  try {
    return (JSON.parse(text(row, key) || 'null') as TValue) ?? fallback;
  } catch {
    return fallback;
  }
}
