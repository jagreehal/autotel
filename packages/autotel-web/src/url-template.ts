/**
 * Path segments that are ids rather than names: a MongoDB ObjectId, a UUID, a
 * number. Each is replaced with `:id`, so `/clients/507f1f77bcf86cd799439011`
 * and every other client share the name `/clients/:id`.
 */
const ID_SEGMENTS = [
  /^[0-9a-f]{24}$/i,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^\d+$/,
];

/**
 * A low-cardinality `url.template` for a request path. Each segment is tested
 * whole against the built-in id patterns, then `extra`. A `g` or `y` pattern
 * is copied without the flag: those resume from the last match, so a second
 * id in the same path would be missed.
 */
export function urlTemplate(path: string, extra: RegExp[] = []): string {
  const patterns = [
    ...ID_SEGMENTS,
    ...extra.map((pattern) =>
      pattern.global || pattern.sticky
        ? new RegExp(pattern.source, pattern.flags.replaceAll(/[gy]/g, ''))
        : pattern,
    ),
  ];
  return path
    .split('/')
    .map((segment) =>
      segment && patterns.some((pattern) => pattern.test(segment))
        ? ':id'
        : segment,
    )
    .join('/');
}
