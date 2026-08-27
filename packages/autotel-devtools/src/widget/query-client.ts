/**
 * Browser client for the server-side query API.
 *
 * `fetch` and the base URL are injected rather than reached for, so the widget
 * stays testable without a network and an embedder can point it at a devtools
 * server on another port.
 *
 * The result is a discriminated union, and the distinctions in it are the
 * point. "Your query has a syntax error at column 8", "the server is not
 * running", and "that request was superseded by your next keystroke" are three
 * different things to the person typing, and a query bar that renders them
 * identically stops being trusted. In particular an aborted request is **not**
 * an error: it is the normal outcome of typing another character.
 */

import type { QueryError } from '../query/ast';
import type { ErrorGroup, LogData, TraceData } from './types';

export interface QueryTracesArgs {
  query: string;
  window?: { start: number; end: number };
  limit?: number;
  cursor?: string;
}

export interface QueryClientDeps {
  fetch: typeof fetch;
  /** Origin of the devtools server, e.g. `http://localhost:4318`. */
  baseUrl: string;
  signal?: AbortSignal;
}

export type QueryTracesResult =
  | { status: 'ok'; traces: TraceData[]; nextCursor: string | null }
  /** The query text did not parse. `errors` carry ranges for editor squiggles. */
  | { status: 'invalid'; errors: QueryError[] }
  /** Superseded or cancelled. Not a failure — render nothing. */
  | { status: 'aborted' }
  | { status: 'error'; message: string };

export type QueryErrorsResult =
  | { status: 'ok'; errors: ErrorGroup[] }
  | { status: 'invalid'; errors: QueryError[] }
  | { status: 'aborted' }
  | { status: 'error'; message: string };

export type QueryLogsResult =
  | { status: 'ok'; logs: LogData[]; nextCursor: string | null }
  | { status: 'invalid'; errors: QueryError[] }
  | { status: 'aborted' }
  | { status: 'error'; message: string };

export async function queryFields(
  signal: 'traces' | 'logs',
  deps: QueryClientDeps,
): Promise<string[]> {
  try {
    const response = await deps.fetch(
      `${deps.baseUrl}/api/query/${signal}/fields`,
      { signal: deps.signal },
    );
    if (!response.ok) return [];
    const payload = (await response.json()) as { fields?: string[] };
    return Array.isArray(payload.fields) ? payload.fields : [];
  } catch {
    // Completion is an enhancement; a query remains fully usable without it.
    return [];
  }
}

/**
 * The outcome of one query POST, before the signal-specific payload is read.
 *
 * Extracted so the trace and log endpoints share exactly one implementation of
 * the error taxonomy — the distinctions above are the whole point of this
 * module, and two copies of them would drift.
 */
type PostOutcome =
  | { status: 'ok'; payload: unknown }
  | { status: 'invalid'; errors: QueryError[] }
  | { status: 'aborted' }
  | { status: 'error'; message: string };

async function postQuery(
  url: string,
  args: QueryTracesArgs,
  deps: QueryClientDeps,
): Promise<PostOutcome> {
  // Build the body explicitly rather than spreading `args`: an unbounded window
  // must be *absent*, not `undefined`-valued, and `JSON.stringify` dropping the
  // key is too incidental a mechanism to rely on.
  const body: Record<string, unknown> = { query: args.query };
  if (args.window) body.window = args.window;
  if (args.limit !== undefined) body.limit = args.limit;
  if (args.cursor) body.cursor = args.cursor;

  let response: Response;
  try {
    response = await deps.fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: deps.signal,
    });
  } catch (error) {
    if (isAbort(error)) return { status: 'aborted' };
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
    // A non-JSON body usually means something other than the devtools server
    // is answering on this port — a dev server's index.html, most often.
    return {
      status: 'error',
      message: `Unexpected response from ${deps.baseUrl} (not JSON)`,
    };
  }

  if (response.status === 400) {
    const errors = (payload as { errors?: QueryError[] }).errors;
    if (errors?.length) return { status: 'invalid', errors };
    return { status: 'error', message: 'Invalid query request' };
  }

  if (response.status === 403) {
    return {
      status: 'error',
      message:
        'Forbidden: the devtools server rejected this origin. Open the viewer from the same machine.',
    };
  }

  if (!response.ok) {
    const message =
      (payload as { error?: string }).error ?? response.statusText;
    return { status: 'error', message: `Server error: ${message}` };
  }

  return { status: 'ok', payload };
}

export async function queryTraces(
  args: QueryTracesArgs,
  deps: QueryClientDeps,
): Promise<QueryTracesResult> {
  const result = await postQuery(
    `${deps.baseUrl}/api/query/traces`,
    args,
    deps,
  );
  if (result.status !== 'ok') return result;
  const payload = result.payload as {
    traces?: TraceData[];
    nextCursor?: string | null;
  };
  return {
    status: 'ok',
    // No decoding here on purpose: the HTTP API answers with complete traces.
    // Only the WebSocket stream is compact, and `websocket.ts` rehydrates it.
    traces: payload.traces ?? [],
    nextCursor: payload.nextCursor ?? null,
  };
}

/** Both `AbortError` and a pre-aborted signal's `DOMException` land here. */
function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: string }).name === 'AbortError'
  );
}

/**
 * Run a log query.
 *
 * Same contract as `queryTraces` — the two endpoints differ only in their path
 * and the key their results arrive under.
 */
export async function queryLogs(
  args: QueryTracesArgs,
  deps: QueryClientDeps,
): Promise<QueryLogsResult> {
  const result = await postQuery(`${deps.baseUrl}/api/query/logs`, args, deps);
  if (result.status !== 'ok') return result;
  const payload = result.payload as {
    logs?: LogData[];
    nextCursor?: string | null;
  };
  return {
    status: 'ok',
    logs: payload.logs ?? [],
    nextCursor: payload.nextCursor ?? null,
  };
}

/**
 * Aggregate errors from the store for a window and query.
 *
 * Distinct from the WS `errors` full-state broadcast, which describes the live
 * tail and has no window. This asks the server to re-run the aggregator over
 * stored traces, so the Errors tab can answer "what was failing an hour ago" —
 * a question the live path cannot reach.
 */
export async function queryErrors(
  args: QueryTracesArgs,
  deps: QueryClientDeps,
): Promise<QueryErrorsResult> {
  const result = await postQuery(
    `${deps.baseUrl}/api/query/errors`,
    args,
    deps,
  );
  if (result.status !== 'ok') return result;
  const payload = result.payload as { errors?: ErrorGroup[] };
  return { status: 'ok', errors: payload.errors ?? [] };
}
