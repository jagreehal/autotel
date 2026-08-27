import type {
  MetricKind,
  MetricPoint,
  MetricTemporality,
} from './metric-streams';

const DEFAULT_MAX_EXEMPLARS = 32;

/** Reduce a metric series to a chart-sized result before it crosses the wire. */
export function reduceMetricPoints(
  points: MetricPoint[],
  kind: MetricKind,
  maxPoints: number,
  options: {
    maxExemplars?: number;
    temporality?: MetricTemporality;
  } = {},
): MetricPoint[] {
  const maxExemplars = options.maxExemplars ?? DEFAULT_MAX_EXEMPLARS;
  const limit = Math.max(4, Math.floor(maxPoints));
  if (points.length <= limit) return capExemplars(points, maxExemplars);
  if (
    kind === 'histogram' ||
    kind === 'exponentialHistogram' ||
    kind === 'summary'
  ) {
    if (options.temporality === 'cumulative') {
      return sampleCumulativeSnapshots(points, limit, maxExemplars);
    }
    return mergeDistributionBuckets(points, limit, maxExemplars);
  }
  return capExemplars(m4(points, limit), maxExemplars);
}

/** Cumulative points are complete snapshots; summing them double-counts. */
function sampleCumulativeSnapshots(
  points: MetricPoint[],
  limit: number,
  maxExemplars: number,
): MetricPoint[] {
  const bucketSize = Math.ceil(points.length / limit);
  const snapshots: MetricPoint[] = [];
  for (let start = 0; start < points.length; start += bucketSize) {
    snapshots.push(points[Math.min(start + bucketSize, points.length) - 1]);
  }
  return capExemplars(snapshots, maxExemplars);
}

/** First/min/max/last sampling preserves spikes and troughs in every time bucket. */
function m4(points: MetricPoint[], limit: number): MetricPoint[] {
  const bucketSize = Math.max(
    1,
    Math.ceil(points.length / Math.max(1, Math.floor(limit / 4))),
  );
  const selected: MetricPoint[] = [];
  for (let start = 0; start < points.length; start += bucketSize) {
    const bucket = points.slice(start, start + bucketSize);
    const byValue = [...bucket].sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
    const candidates = [
      bucket[0],
      byValue[0],
      byValue[byValue.length - 1],
      bucket[bucket.length - 1],
    ];
    const unique = new Map<number, MetricPoint>();
    for (const point of candidates) unique.set(point.timestamp, point);
    selected.push(
      ...[...unique.values()].sort((a, b) => a.timestamp - b.timestamp),
    );
  }
  return selected.slice(0, limit);
}

function mergeDistributionBuckets(
  points: MetricPoint[],
  limit: number,
  maxExemplars: number,
): MetricPoint[] {
  const bucketSize = Math.ceil(points.length / limit);
  const out: MetricPoint[] = [];
  let remainingExemplars = maxExemplars;
  for (let start = 0; start < points.length; start += bucketSize) {
    const merged = mergePoints(
      points.slice(start, start + bucketSize),
      remainingExemplars,
    );
    remainingExemplars -= merged.exemplars?.length ?? 0;
    out.push(merged);
  }
  return out;
}

function mergePoints(points: MetricPoint[], maxExemplars: number): MetricPoint {
  const last = points[points.length - 1];
  const counts = points.map((point) => point.count ?? 0);
  const totalCount = counts.reduce((sum, value) => sum + value, 0);
  const result: MetricPoint = {
    ...last,
    startTimestamp: points[0].startTimestamp,
    count: totalCount,
    sum: sumDefined(points.map((point) => point.sum)),
    min: minDefined(points.map((point) => point.min)),
    max: maxDefined(points.map((point) => point.max)),
    exemplars:
      maxExemplars <= 0
        ? []
        : points.flatMap((point) => point.exemplars ?? []).slice(-maxExemplars),
  };

  if (sameArrays(points.map((point) => point.explicitBounds))) {
    result.bucketCounts = sumArrays(points.map((point) => point.bucketCounts));
  }
  if (points.every((point) => point.scale === last.scale)) {
    result.zeroCount = points.reduce(
      (sum, point) => sum + (point.zeroCount ?? 0),
      0,
    );
    result.positive = mergeExponential(points.map((point) => point.positive));
    result.negative = mergeExponential(points.map((point) => point.negative));
  }
  if (last.quantiles) {
    result.quantiles = last.quantiles.map(({ quantile }) => {
      let weight = 0;
      let value = 0;
      for (let index = 0; index < points.length; index++) {
        const found = points[index].quantiles?.find(
          (item) => item.quantile === quantile,
        );
        if (!found) continue;
        const pointWeight = counts[index] || 1;
        weight += pointWeight;
        value += found.value * pointWeight;
      }
      return { quantile, value: weight === 0 ? 0 : value / weight };
    });
  }
  return result;
}

function mergeExponential(
  values: Array<MetricPoint['positive']>,
): MetricPoint['positive'] {
  const buckets = values.filter((value) => value !== undefined);
  if (buckets.length === 0) return undefined;
  const start = Math.min(...buckets.map((bucket) => bucket.offset));
  const end = Math.max(
    ...buckets.map((bucket) => bucket.offset + bucket.bucketCounts.length),
  );
  const bucketCounts = Array.from({ length: end - start }, () => 0);
  for (const bucket of buckets) {
    for (let index = 0; index < bucket.bucketCounts.length; index++) {
      bucketCounts[bucket.offset - start + index] += bucket.bucketCounts[index];
    }
  }
  return { offset: start, bucketCounts };
}

function sameArrays(values: Array<number[] | undefined>): boolean {
  const first = JSON.stringify(values[0]);
  return values.every((value) => JSON.stringify(value) === first);
}

function sumArrays(values: Array<number[] | undefined>): number[] | undefined {
  if (values.some((value) => value === undefined)) return undefined;
  return values.reduce<number[]>(
    (sum, value) => value!.map((item, index) => item + (sum[index] ?? 0)),
    [],
  );
}

function sumDefined(values: Array<number | undefined>): number | undefined {
  const found = values.filter((value): value is number => value !== undefined);
  return found.length === 0
    ? undefined
    : found.reduce((sum, value) => sum + value, 0);
}

function minDefined(values: Array<number | undefined>): number | undefined {
  const found = values.filter((value): value is number => value !== undefined);
  return found.length === 0 ? undefined : Math.min(...found);
}

function maxDefined(values: Array<number | undefined>): number | undefined {
  const found = values.filter((value): value is number => value !== undefined);
  return found.length === 0 ? undefined : Math.max(...found);
}

function capExemplars(points: MetricPoint[], max: number): MetricPoint[] {
  let remaining = max;
  return points.map((point) => {
    if (!point.exemplars) return point;
    const exemplars = point.exemplars.slice(0, remaining);
    remaining -= exemplars.length;
    return { ...point, exemplars };
  });
}
