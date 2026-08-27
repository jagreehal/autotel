/**
 * Browser client for the metrics endpoints.
 *
 * Mirrors `query-client.ts`: injected `fetch` and base URL, and a result union
 * that keeps "the server is unreachable" distinct from "there are no metrics",
 * because a viewer that renders both as an empty list is lying about one of them.
 */

import type { MetricCatalogEntry, MetricSeries } from '../server/store/store';

export interface MetricsClientDeps {
  fetch: typeof fetch;
  baseUrl: string;
  signal?: AbortSignal;
}

export type MetricsResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'aborted' }
  | { status: 'error'; message: string };

/** The metric catalogue: every metric name held, with kind and series count. */
export async function listMetrics(
  deps: MetricsClientDeps,
  query = '',
): Promise<MetricsResult<MetricCatalogEntry[]>> {
  const suffix = query ? `?q=${encodeURIComponent(query)}` : '';
  return request<MetricCatalogEntry[]>(
    `${deps.baseUrl}/api/metrics${suffix}`,
    { method: 'GET', signal: deps.signal },
    deps,
    (payload) => (payload as { metrics?: MetricCatalogEntry[] }).metrics ?? [],
  );
}

/** The series for one metric, clipped to an optional window. */
export async function fetchMetricSeries(
  args: {
    name: string;
    window?: { start: number; end: number };
    maxPoints?: number;
  },
  deps: MetricsClientDeps,
): Promise<MetricsResult<MetricSeries[]>> {
  const body: Record<string, unknown> = { name: args.name };
  if (args.window) body.window = args.window;
  body.maxPoints = args.maxPoints ?? 1_500;

  return request<MetricSeries[]>(
    `${deps.baseUrl}/api/query/metrics`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: deps.signal,
    },
    deps,
    (payload) => (payload as { series?: MetricSeries[] }).series ?? [],
  );
}

export async function deleteMetric(
  name: string,
  deps: MetricsClientDeps,
): Promise<MetricsResult<number>> {
  return request<number>(
    `${deps.baseUrl}/api/metrics?name=${encodeURIComponent(name)}`,
    { method: 'DELETE', signal: deps.signal },
    deps,
    (payload) => (payload as { deletedSeries?: number }).deletedSeries ?? 0,
  );
}

async function request<T>(
  url: string,
  init: RequestInit,
  deps: MetricsClientDeps,
  extract: (payload: unknown) => T,
): Promise<MetricsResult<T>> {
  let response: Response;
  try {
    response = await deps.fetch(url, init);
  } catch (error) {
    // A superseded request is the normal result of switching metrics quickly;
    // rendering it as a failure would flash errors during ordinary use.
    if (isAbort(error)) return { status: 'aborted' };
    return {
      status: 'error',
      message:
        error instanceof Error
          ? `Network error: ${error.message}`
          : 'Network error',
    };
  }

  if (response.status === 403) {
    return {
      status: 'error',
      message:
        'Forbidden: the devtools server rejected this origin. Open the viewer from the same machine.',
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return {
      status: 'error',
      message: `Unexpected response from ${deps.baseUrl} (not JSON)`,
    };
  }

  if (!response.ok) {
    const message =
      (payload as { error?: string }).error ?? response.statusText;
    return { status: 'error', message: `Server error: ${message}` };
  }

  return { status: 'ok', data: extract(payload) };
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: string }).name === 'AbortError'
  );
}
