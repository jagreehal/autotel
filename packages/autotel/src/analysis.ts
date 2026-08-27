/**
 * Core Analysis Loop
 *
 * Debugging from first principles: take the events you care about, take a
 * comparable normal population, and ask which recorded field separates them.
 * The loop is mechanical, so run it in code instead of clicking through a
 * dashboard.
 *
 * `compareCohorts()` scores every field/value pair by how much more often it
 * appears in the outlier group than in the baseline. The top result names the
 * cohort behind a regression, which is the hypothesis you then verify against
 * individual traces.
 *
 * The input is any array of flat records: wide events from
 * `getRequestLogger()`, `TestSpan.attributes` from `autotel/testing`, or rows
 * returned by a backend query.
 *
 * @example Find the cohort behind a latency regression
 * ```typescript
 * import { compareCohorts } from 'autotel/analysis'
 *
 * const slow = events.filter((event) => event['duration_ms'] >= 800)
 * const normal = events.filter((event) => event['duration_ms'] < 800)
 *
 * const [top] = compareCohorts({ outlier: slow, baseline: normal })
 * // { field: 'payment.provider', value: 'bank-beta', difference: 0.94, ... }
 * ```
 */

/** A flat telemetry record. Span attributes and wide events both satisfy it. */
export type AnalysisEvent = Record<string, unknown>;

/** How strongly one field/value pair separates the outlier group from the baseline. */
export interface CohortDifference {
  /** Attribute name, such as `payment.provider`. */
  field: string;
  /** The value, rendered as a string for display and grouping. */
  value: string;
  /** Share of outlier events carrying this value, 0-1. */
  outlierFraction: number;
  /** Share of baseline events carrying this value, 0-1. */
  baselineFraction: number;
  /** `outlierFraction - baselineFraction`. Positive means over-represented in the outliers. */
  difference: number;
  outlierCount: number;
  baselineCount: number;
}

export interface CompareCohortsOptions {
  /** The events you are investigating: the errors, the slow requests, the failed checkouts. */
  outlier: readonly AnalysisEvent[];
  /** A comparable normal population from the same time range. */
  baseline: readonly AnalysisEvent[];
  /** Restrict the scan to these fields. Defaults to every field seen in either group. */
  fields?: readonly string[];
  /** Fields to skip, such as identifiers you already know are unique. */
  ignoreFields?: readonly string[];
  /**
   * Skip a field once it holds more distinct values than this across both
   * groups. Default 50.
   */
  maxValuesPerField?: number;
  /**
   * Skip a field whose distinct values outnumber this share of the combined
   * events. A request id or a raw duration takes a near-unique value per
   * event, so its values never repeat and it cannot describe a cohort. The
   * ratio catches those fields in small populations, where an absolute cap
   * does not. Bucket numeric fields at instrumentation time if you want them
   * ranked. Default 0.5.
   */
  maxUniqueRatio?: number;
  /** Drop pairs whose absolute difference falls below this. Default 0.1. */
  minDifference?: number;
  /** Maximum results to return, strongest first. Default 20. */
  limit?: number;
}

const DEFAULT_MAX_VALUES_PER_FIELD = 50;
const DEFAULT_MAX_UNIQUE_RATIO = 0.5;
const DEFAULT_MIN_DIFFERENCE = 0.1;
const DEFAULT_LIMIT = 20;

/**
 * Render a value as a grouping key.
 *
 * Objects and arrays return undefined: a nested structure does not name a
 * cohort, and stringifying it produces noise rather than a testable split.
 */
function valueKey(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const kind = typeof value;
  if (
    kind === 'string' ||
    kind === 'number' ||
    kind === 'boolean' ||
    kind === 'bigint'
  ) {
    return String(value);
  }
  return undefined;
}

/** Occurrences of one value, split by the group it appeared in. */
interface ValueCounts {
  outlier: number;
  baseline: number;
}

/** field -> value -> counts */
type FieldTally = Map<string, Map<string, ValueCounts>>;

/**
 * Fold one group's events into the shared tally.
 *
 * Both groups accumulate into the same structure, so the caller never builds a
 * combined array or revisits an event once per candidate field.
 */
function accumulate(
  tally: FieldTally,
  events: readonly AnalysisEvent[],
  group: keyof ValueCounts,
  includes: (field: string) => boolean,
): void {
  for (const event of events) {
    for (const [field, raw] of Object.entries(event)) {
      if (!includes(field)) {
        continue;
      }
      const value = valueKey(raw);
      if (value === undefined) {
        continue;
      }
      let values = tally.get(field);
      if (values === undefined) {
        values = new Map<string, ValueCounts>();
        tally.set(field, values);
      }
      const counts = values.get(value) ?? { outlier: 0, baseline: 0 };
      counts[group]++;
      values.set(value, counts);
    }
  }
}

/**
 * Rank the field/value pairs that separate an outlier group from a baseline.
 *
 * Returns an empty array when either group is empty, because a fraction over
 * zero events carries no information.
 *
 * @param options - The two populations and the scan limits
 * @returns Differences sorted by absolute strength, strongest first
 */
export function compareCohorts(
  options: CompareCohortsOptions,
): CohortDifference[] {
  const {
    outlier,
    baseline,
    fields,
    ignoreFields,
    maxValuesPerField = DEFAULT_MAX_VALUES_PER_FIELD,
    maxUniqueRatio = DEFAULT_MAX_UNIQUE_RATIO,
    minDifference = DEFAULT_MIN_DIFFERENCE,
    limit = DEFAULT_LIMIT,
  } = options;

  if (outlier.length === 0 || baseline.length === 0) {
    return [];
  }

  const ignored = new Set(ignoreFields);
  const selected = fields === undefined ? undefined : new Set(fields);
  const includes = (field: string) =>
    !ignored.has(field) && (selected === undefined || selected.has(field));

  const tally: FieldTally = new Map();
  accumulate(tally, outlier, 'outlier', includes);
  accumulate(tally, baseline, 'baseline', includes);

  const results: CohortDifference[] = [];
  const total = outlier.length + baseline.length;

  for (const [field, values] of tally) {
    if (
      values.size > maxValuesPerField ||
      values.size > total * maxUniqueRatio
    ) {
      continue;
    }

    for (const [value, counts] of values) {
      const outlierFraction = counts.outlier / outlier.length;
      const baselineFraction = counts.baseline / baseline.length;
      const difference = outlierFraction - baselineFraction;

      if (Math.abs(difference) < minDifference) {
        continue;
      }

      results.push({
        field,
        value,
        outlierFraction,
        baselineFraction,
        difference,
        outlierCount: counts.outlier,
        baselineCount: counts.baseline,
      });
    }
  }

  // Strongest first. On a tie prefer the over-represented value, because a
  // cohort you can open traces from beats one defined by its absence. Fall
  // back to field and value so repeated runs return the same order.
  results.sort(
    (a, b) =>
      Math.abs(b.difference) - Math.abs(a.difference) ||
      b.difference - a.difference ||
      a.field.localeCompare(b.field) ||
      a.value.localeCompare(b.value),
  );

  return results.slice(0, limit);
}

/**
 * Label a numeric value with the range it falls in.
 *
 * `compareCohorts` skips a field whose values never repeat, which is what a
 * raw duration or byte count does. Bucketing at instrumentation time turns
 * such a field into one that can describe a cohort.
 */
export function bucket(value: number, boundaries: readonly number[]): string {
  // A NaN duration filed under the slowest bucket would invent a cohort that
  // never happened, which is worse than admitting the value is missing.
  if (!Number.isFinite(value) || boundaries.length === 0) return 'unknown';
  // Sorted, so a caller who lists boundaries out of order still gets the
  // ranges they meant rather than a label that overlaps its neighbours.
  const ordered = [...boundaries].sort((a, b) => a - b);
  for (const [index, boundary] of ordered.entries()) {
    if (value < boundary) {
      const lower = ordered[index - 1];
      return lower === undefined ? `<${boundary}` : `${lower}-${boundary}`;
    }
  }
  return `>=${ordered.at(-1)}`;
}
