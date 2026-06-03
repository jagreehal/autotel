/**
 * Case-insensitive substring search shared by the list/graph views, which each
 * grew the same `field?.toLowerCase().includes(needle)` chain. The views differ
 * on how they normalise the query (some `trim()`, some don't), so the caller
 * lower-cases the `needle` and this only ORs it across the fields.
 *
 * An empty `needle` matches everything. Nullish fields are skipped and numbers
 * are stringified, so multi-valued fields can be spread straight in:
 *   matchesNeedle(needle, [trace.service, ...trace.spans.map((s) => s.name)])
 */
export function matchesNeedle(
  needle: string,
  fields: Array<string | number | null | undefined>,
): boolean {
  if (!needle) return true;
  return fields.some(
    (field) => field != null && String(field).toLowerCase().includes(needle),
  );
}
