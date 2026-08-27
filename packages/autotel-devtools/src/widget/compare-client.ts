/**
 * Client for the cohort comparison endpoint.
 *
 * Same discipline as `query-client`: the outcomes stay distinct. "Your query
 * is wrong", "nothing matched", "this server cannot compare" and "here is the
 * answer" are four different things to the person reading, and rendering them
 * all as an empty table is how a comparison stops being believed.
 */

import type { QueryClientDeps } from './query-client';

/** One field/value pair that separates the two populations. */
export interface CohortDifference {
  field: string;
  value: string;
  /** Share of the investigated events carrying this value, 0-1. */
  outlierFraction: number;
  /** Share of the normal population carrying this value, 0-1. */
  baselineFraction: number;
  /** Positive means over-represented among the events being investigated. */
  difference: number;
  outlierCount: number;
  baselineCount: number;
}

export interface CohortSide {
  query: string;
  window?: { start: number; end: number };
}

export interface CompareArgs {
  outlier: CohortSide;
  baseline: CohortSide;
  /** Fields to skip, such as an id you already know is unique per event. */
  ignoreFields?: string[];
}

export type CompareResult =
  | {
      status: 'ok';
      differences: CohortDifference[];
      outlierCount: number;
      baselineCount: number;
    }
  /** One side matched nothing, so a fraction over it would mean nothing. */
  | { status: 'empty'; outlierCount: number; baselineCount: number }
  | { status: 'invalid'; message: string }
  /** The server has no `autotel` install to borrow the ranking from. */
  | { status: 'unavailable'; message: string }
  | { status: 'aborted' }
  | { status: 'error'; message: string };

export async function compareCohorts(
  args: CompareArgs,
  deps: QueryClientDeps,
): Promise<CompareResult> {
  let response: Response;
  try {
    response = await deps.fetch(`${deps.baseUrl}/api/analysis/compare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args),
      signal: deps.signal,
    });
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError')
      return { status: 'aborted' };
    return {
      status: 'error',
      message:
        error instanceof Error
          ? `Network error: ${error.message}`
          : 'Network error',
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: 'error', message: 'Unexpected response (not JSON)' };
  }

  const body = payload as {
    differences?: CohortDifference[];
    outlierCount?: number;
    baselineCount?: number;
    error?: string;
    message?: string;
  };

  if (response.status === 501) {
    return {
      status: 'unavailable',
      message: body.message ?? 'Comparison is unavailable on this server.',
    };
  }
  if (response.status === 400) {
    return {
      status: 'invalid',
      message: body.message ?? body.error ?? 'Invalid query',
    };
  }
  if (!response.ok) {
    return { status: 'error', message: body.error ?? response.statusText };
  }

  const outlierCount = body.outlierCount ?? 0;
  const baselineCount = body.baselineCount ?? 0;
  // An empty side is reported as such rather than as "no differences found",
  // which reads as "these populations are alike" and is a different claim.
  if (outlierCount === 0 || baselineCount === 0) {
    return { status: 'empty', outlierCount, baselineCount };
  }

  return {
    status: 'ok',
    differences: body.differences ?? [],
    outlierCount,
    baselineCount,
  };
}
