/**
 * The store-backed working set: the traces and errors every derived view reads.
 *
 * Service Map, Flow, Security, Resources, GenAI and Errors are all *derived*
 * from traces rather than queried directly. Until now they folded over the live
 * tail — the last hundred traces the process happened to receive — so they
 * described a window of a few minutes regardless of what the toolbar said, and
 * lost everything on restart. This fetches the same traces from the store, for
 * the window the user actually chose.
 *
 * Kept out of `store.svelte.ts` to avoid a cycle: the store owns the signals,
 * this owns the fetching and writes into them.
 *
 * Two behaviours matter and are easy to lose:
 *
 *  - **The fallback is the live tail, not emptiness.** If the server is
 *    unreachable, showing the traces already in the browser beats showing
 *    nothing — those views worked that way before and should keep working.
 *  - **A superseded response never lands.** The window can change faster than a
 *    fetch completes, and rendering a stale answer would show a map of the
 *    wrong period.
 */

import {
  storeTracesSignal,
  storeErrorGroupsSignal,
  workingSetStatusSignal,
  timeWindowSignal,
  tracesSignal,
  connectionUrlSignal,
} from './store.svelte';
import { queryErrors, queryTraces, type QueryClientDeps } from './query-client';
import { resolveWindow, toQueryWindow } from './timeWindow';
import { httpBaseFromWsUrl } from './source-client';
import type { TraceData } from './types';

export interface WorkingSetDeps {
  fetch?: typeof fetch;
  baseUrl?: string;
  now?: () => number;
  /** Coalescing delay for bursts of arrivals, in ms. Zero runs immediately. */
  debounceMs?: number;
  /**
   * Traces to fetch.
   *
   * Large, because these views aggregate: a service map built from a page of
   * traces silently omits edges, which reads as "those services do not talk"
   * rather than as a truncation.
   */
  limit?: number;
}

const DEFAULT_DEBOUNCE_MS = 250;
const DEFAULT_LIMIT = 5_000;

/**
 * Start keeping the working set in step with the window and with new arrivals.
 *
 * Returns a disposer; call it on unmount.
 */
export function createWorkingSet(deps: WorkingSetDeps = {}) {
  const now = deps.now ?? (() => Date.now());
  const debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const limit = deps.limit ?? DEFAULT_LIMIT;

  let sequence = 0;
  let inFlight: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  function client(): QueryClientDeps {
    const wsUrl = connectionUrlSignal.value;
    const baseUrl =
      deps.baseUrl ??
      (wsUrl ? httpBaseFromWsUrl(wsUrl) : null) ??
      globalThis.location?.origin ??
      '';
    return { fetch: deps.fetch ?? globalThis.fetch.bind(globalThis), baseUrl };
  }

  async function run(): Promise<void> {
    if (disposed) return;
    const mySequence = ++sequence;
    inFlight?.abort();
    const controller = new AbortController();
    inFlight = controller;

    const window = toQueryWindow(resolveWindow(timeWindowSignal.value, now()));
    const args = { query: '', window, limit };
    const deps_ = { ...client(), signal: controller.signal };

    const [traces, errors] = await Promise.all([
      queryEveryTracePage(args, deps_),
      queryErrors(args, deps_),
    ]);

    // A newer request has been issued: this answer describes a window the user
    // has already moved past.
    if (mySequence !== sequence || disposed) return;

    if (traces.status === 'ok') {
      storeTracesSignal.value = traces.traces;
      workingSetStatusSignal.value = 'ready';
    } else if (traces.status === 'error') {
      // Fall back to the live tail rather than blanking every derived view.
      workingSetStatusSignal.value = 'unavailable';
    }

    if (errors.status === 'ok') {
      storeErrorGroupsSignal.value = errors.errors;
    }
  }

  function schedule(): void {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    if (debounceMs <= 0) {
      void run();
      return;
    }
    // Coalesce: traces stream in continuously, and one refetch per arriving
    // trace would hammer the server for a view nobody is looking at yet.
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, debounceMs);
  }

  return {
    /** Refetch now, skipping the debounce — used when the window changes. */
    refresh: run,
    /** Something arrived; refresh soon. */
    invalidate: schedule,
    dispose(): void {
      disposed = true;
      if (timer) clearTimeout(timer);
      inFlight?.abort();
    },
  };
}

/** Read a complete aggregate input, following the store's keyset cursors. */
async function queryEveryTracePage(
  args: Parameters<typeof queryTraces>[0],
  deps: QueryClientDeps,
): Promise<Awaited<ReturnType<typeof queryTraces>>> {
  const traces: TraceData[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const page = await queryTraces({ ...args, cursor }, deps);
    if (page.status !== 'ok') return page;
    traces.push(...page.traces);
    cursor = page.nextCursor ?? undefined;
    if (cursor && seenCursors.has(cursor)) {
      return {
        status: 'error',
        message: 'The trace query returned a repeated pagination cursor.',
      };
    }
    if (cursor) seenCursors.add(cursor);
  } while (cursor);

  return { status: 'ok', traces, nextCursor: null };
}

export type WorkingSet = ReturnType<typeof createWorkingSet>;

/**
 * Traces the derived views should fold over.
 *
 * Exported as a function rather than a signal so `store.svelte.ts` can own the
 * signal definitions without importing this module — see the cycle note above.
 */
export function resolveWorkingTraces(): typeof tracesSignal.value {
  return workingSetStatusSignal.value === 'ready'
    ? storeTracesSignal.value
    : tracesSignal.value;
}
