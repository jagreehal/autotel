/**
 * Signal query controller.
 *
 * Owns everything about "what is currently on screen and why": the query text,
 * the time window, the live-tail freeze state, the current page of results, and
 * the in-flight request.
 *
 * Generic over the signal so traces and logs share one implementation. The
 * sequencing and freeze rules below are subtle enough that a second copy would
 * drift — and the drift would be invisible until results started flickering
 * backwards on one tab and not the other.
 *
 * It is a factory rather than a module of globals so tests can drive it with a
 * stubbed client and a fixed clock, and so a second instance (the full-page app
 * alongside an embedded widget) cannot fight over one set of signals.
 *
 * Two behaviours here are load-bearing and easy to lose in a refactor:
 *
 *  - **A superseded request never lands.** Every run carries a sequence number
 *    and an abort signal; a response whose sequence is stale is dropped rather
 *    than rendered. Without this, typing fast makes results flicker backwards.
 *  - **Errors never blank the list.** A failed or invalid query leaves the last
 *    good results on screen and reports the problem alongside them. Clearing
 *    the view on every half-typed expression makes the query bar unusable.
 */

import { Signal } from './signals.svelte';
import { timeWindowSignal } from './store.svelte';
import {
  queryLogs,
  queryTraces,
  type QueryClientDeps,
  type QueryTracesArgs,
} from './query-client';
import type { QueryError } from '../query/ast';
import type { LogData, TraceData } from './types';
import {
  isUnbounded,
  resolveWindow,
  toQueryWindow,
  type WindowSelection,
} from './timeWindow';
import {
  initialTail,
  isLive,
  pendingCount,
  reduceTail,
  type TailAction,
  type TailState,
} from './liveTail';

/**
 * One signal's fetch, normalised to a common result shape.
 *
 * The endpoints differ only in their path and the key their rows arrive under,
 * so an adapter is a few lines and keeps the controller signal-agnostic.
 */
export interface SignalAdapter<TRow> {
  run: (
    args: QueryTracesArgs,
    deps: QueryClientDeps,
  ) => Promise<
    | { status: 'ok'; rows: TRow[]; nextCursor: string | null }
    | { status: 'invalid'; errors: QueryError[] }
    | { status: 'aborted' }
    | { status: 'error'; message: string }
  >;
}

/** Trace rows from `POST /api/query/traces`. */
export const TRACE_ADAPTER: SignalAdapter<TraceData> = {
  run: async (args, deps) => {
    const result = await queryTraces(args, deps);
    return result.status === 'ok'
      ? { status: 'ok', rows: result.traces, nextCursor: result.nextCursor }
      : result;
  },
};

/** Log rows from `POST /api/query/logs`. */
export const LOG_ADAPTER: SignalAdapter<LogData> = {
  run: async (args, deps) => {
    const result = await queryLogs(args, deps);
    return result.status === 'ok'
      ? { status: 'ok', rows: result.logs, nextCursor: result.nextCursor }
      : result;
  },
};

export interface TraceQueryDeps {
  /** Injected so tests need no network and an embedder can retarget the host. */
  client: {
    fetch: typeof fetch;
    /** Resolve lazily because an embedded widget learns its server after mount. */
    baseUrl: string | (() => string);
  };
  /** Injected so preset windows resolve against a fixed clock under test. */
  now?: () => number;
  /** Debounce for typing, in ms. Zero runs synchronously (tests use this). */
  debounceMs?: number;
  pageSize?: number;
}

const DEFAULT_DEBOUNCE_MS = 200;
const DEFAULT_PAGE_SIZE = 100;

export function createSignalQuery<TRow>(
  deps: TraceQueryDeps,
  adapter: SignalAdapter<TRow>,
) {
  const now = deps.now ?? (() => Date.now());
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;

  const text = new Signal<string>('');
  // The window is *shared*, not per-controller: two tabs showing different
  // ranges while presenting one control is the drift this replaced.
  const window = timeWindowSignal;
  const results = new Signal<TRow[]>([]);
  const errors = new Signal<QueryError[]>([]);
  const failure = new Signal<string | null>(null);
  const loading = new Signal<boolean>(false);
  const ready = new Signal<boolean>(false);
  const nextCursor = new Signal<string | null>(null);
  const tail = new Signal<TailState>(initialTail());

  /** Monotonic id of the newest request; older responses are ignored. */
  let sequence = 0;
  let inFlight: AbortController | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function dispatch(action: TailAction): void {
    tail.value = reduceTail(tail.value, action);
  }

  async function run(options: { append?: boolean } = {}): Promise<void> {
    const mySequence = ++sequence;
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;

    loading.value = true;
    const resolved = resolveWindow(window.value, now());

    const result = await adapter.run(
      {
        query: text.value,
        window: toQueryWindow(resolved),
        limit: pageSize,
        cursor: options.append ? (nextCursor.value ?? undefined) : undefined,
      },
      {
        fetch: deps.client.fetch,
        baseUrl:
          typeof deps.client.baseUrl === 'function'
            ? deps.client.baseUrl()
            : deps.client.baseUrl,
        signal: controller.signal,
      },
    );

    // A newer request has already been issued: this response is stale, and
    // rendering it would show results for a query the user has moved past.
    if (mySequence !== sequence) return;
    loading.value = false;

    switch (result.status) {
      case 'ok':
        results.value = options.append
          ? [...results.value, ...result.rows]
          : result.rows;
        nextCursor.value = result.nextCursor;
        errors.value = [];
        failure.value = null;
        ready.value = true;
        return;

      case 'invalid':
        // Keep the previous results: the user is mid-edit, and emptying the
        // list on every keystroke is worse than showing slightly stale rows.
        errors.value = result.errors;
        failure.value = null;
        return;

      case 'error':
        errors.value = [];
        failure.value = result.message;
        return;

      case 'aborted':
        // Superseded, not failed. The newer request owns the loading state,
        // so do not touch it here.
        return;
    }
  }

  function scheduleRun(): void {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (debounceMs <= 0) {
      void run();
      return;
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void run();
    }, debounceMs);
  }

  return {
    // Reactive reads
    text,
    window,
    results,
    errors,
    failure,
    loading,
    ready,
    nextCursor,
    tail,
    get live() {
      return isLive(tail.value);
    },
    get pending() {
      return pendingCount(tail.value);
    },

    /** Typing: updates the tail state and schedules a debounced run. */
    setText(next: string): void {
      text.value = next;
      dispatch({ type: 'query-changed', query: next });
      scheduleRun();
    },

    /** Explicit submit (Enter): runs immediately, skipping the debounce. */
    submit(): void {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      void run();
    },

    /** Fetch immediately and expose completion to initial-load callers. */
    refresh(): Promise<void> {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      return run();
    },

    setWindow(next: WindowSelection): void {
      window.value = next;
      dispatch({
        type: 'window-changed',
        bounded: !isUnbounded(resolveWindow(next, now())),
      });
      void run();
    },

    setScrolledToTop(atTop: boolean): void {
      dispatch({ type: 'scrolled', atTop });
    },

    setSelected(selected: boolean): void {
      dispatch(
        selected ? { type: 'row-selected' } : { type: 'row-deselected' },
      );
    },

    /** New matches arrived over the live stream. */
    arrived(count: number): void {
      dispatch({ type: 'arrived', count });
      // While live the list should reflect them immediately; while frozen the
      // pill counts them and the list is deliberately left alone.
      if (isLive(tail.value)) void run();
    },

    /** The pill: clear every freeze reason and fetch the newest matches. */
    resume(): void {
      dispatch({ type: 'resumed' });
      text.value = '';
      void run();
    },

    /** Fetch the next page and append it. */
    loadMore(): void {
      if (!nextCursor.value || loading.value) return;
      void run({ append: true });
    },

    /** Remove rows already deleted through a side-effecting endpoint. */
    removeRows(predicate: (row: TRow) => boolean): void {
      results.value = results.value.filter((row) => !predicate(row));
    },

    /** Cancel anything in flight. Call on unmount. */
    dispose(): void {
      if (debounceTimer) clearTimeout(debounceTimer);
      inFlight?.abort();
    },
  };
}

/** Trace-specific controller — the common case, so it keeps a name. */
export function createTraceQuery(deps: TraceQueryDeps) {
  return createSignalQuery<TraceData>(deps, TRACE_ADAPTER);
}

/** Log-specific controller. */
export function createLogQuery(deps: TraceQueryDeps) {
  return createSignalQuery<LogData>(deps, LOG_ADAPTER);
}

export type TraceQueryController = ReturnType<typeof createTraceQuery>;
export type LogQueryController = ReturnType<typeof createLogQuery>;
