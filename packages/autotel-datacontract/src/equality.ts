import { decimalOf, decimalText } from './decimal.js';

/**
 * One structural equality for every "same value" decision: duplicate rows,
 * unique items, and comparing contract parts in a diff. Key order does not
 * matter; type does ('1' is not 1); a number and a bigint of one value are
 * equal (as JSON Schema reads numbers), and so are 1 and 1.0.
 */
export function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'bigint' || typeof value === 'number') {
    const d = decimalOf(value);
    return d ? `n:${decimalText(d)}` : `n:${String(value)}`;
  }
  if (typeof value === 'string') return `s:${JSON.stringify(value)}`;
  if (typeof value === 'boolean') return `b:${value}`;
  if (value instanceof Date) return `d:${dateText(value)}`;
  if (Array.isArray(value))
    return `[${value.map((v) => canonical(v)).join(',')}]`;
  if (typeof value === 'object')
    return `{${Object.keys(value)
      .toSorted()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(',')}}`;
  return `${typeof value}:${String(value)}`;
}

/**
 * As `canonical`, reading numeric text as the number it states: for a
 * numeric property read leniently from a driver ('1.00' and 1 are one value,
 * as SQL compares a DECIMAL column).
 */
export function canonicalNumeric(value: unknown): string {
  if (typeof value === 'string') {
    const d = decimalOf(value);
    if (d) return `n:${decimalText(d)}`;
  }
  return canonical(value);
}

export const sameStructure = (a: unknown, b: unknown): boolean =>
  canonical(a) === canonical(b);

/** A Date as ISO text; an invalid Date (toISOString throws) as 'Invalid Date'. */
export function dateText(d: Date): string {
  return Number.isNaN(d.getTime()) ? 'Invalid Date' : d.toISOString();
}
