<script lang="ts">
  /**
   * Cohort comparison: what separates these spans from those.
   *
   * The question this answers is the one you actually have when something is
   * slow or failing — not "what happened" but "what is different about the
   * ones that broke". A ranked list of field/value pairs gets there in one
   * step, where reading traces one at a time gets there eventually or not
   * at all.
   *
   * Two ways in, and they are the same comparison underneath:
   *
   * - **By query**, when you can describe the bad ones (`duration > 500`).
   * - **By mark**, when you cannot. Mark the moment, change something, and
   *   compare after against before. That is the loop a developer is in, and
   *   it is why the marker is a first-class control rather than something you
   *   reconstruct by typing timestamps.
   *
   * The ranking comes from `compareCohorts` in `autotel/analysis`, which the
   * server borrows. It is a hypothesis: confirm it against individual traces
   * before believing it, which is what the query links are for.
   */
  import { Play, Flag, X } from '@lucide/svelte';
  import {
    compareCohorts,
    type CompareResult,
    type CohortSide,
  } from '../compare-client';
  import { connectionUrlSignal, timeWindowSignal } from '../store.svelte';
  import { httpBaseFromWsUrl } from '../source-client';
  import { resolveWindow } from '../timeWindow';
  import { cn } from '../utils/cn';

  let outlierQuery = $state('duration > 500');
  let baselineQuery = $state('');
  /** Epoch ms of the marked moment, or null when comparing by query. */
  let mark = $state<number | null>(null);
  let running = $state(false);
  let result = $state<CompareResult | null>(null);

  const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

  function sides(): { outlier: CohortSide; baseline: CohortSide } {
    if (mark === null) {
      return {
        outlier: { query: outlierQuery },
        baseline: { query: baselineQuery },
      };
    }
    // Same query on both sides, split by the marker: whatever differs is the
    // change, not the filter.
    const bounds = resolveWindow(timeWindowSignal.value, Date.now());
    return {
      outlier: {
        query: baselineQuery,
        window: { start: mark, end: Date.now() },
      },
      baseline: {
        query: baselineQuery,
        window: { start: bounds?.start ?? 0, end: mark },
      },
    };
  }

  async function run(): Promise<void> {
    const wsUrl = connectionUrlSignal.value;
    const baseUrl = wsUrl === null ? null : httpBaseFromWsUrl(wsUrl);
    if (baseUrl === null) {
      result = {
        status: 'error',
        message: 'The telemetry receiver is not connected.',
      };
      return;
    }

    running = true;
    try {
      result = await compareCohorts(sides(), {
        fetch: globalThis.fetch.bind(globalThis),
        baseUrl,
      });
    } finally {
      running = false;
    }
  }
</script>

<div class="flex h-full flex-col overflow-hidden">
  <div class="border-b border-line px-4 py-3">
    <div class="mb-2 flex items-center gap-2">
      <button
        type="button"
        onclick={() => (mark = mark === null ? Date.now() : null)}
        class={cn(
          'flex items-center gap-1 rounded px-2 py-1 text-xs',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          mark === null
            ? 'border border-line text-fg-muted hover:text-fg'
            : 'bg-accent text-white',
        )}
      >
        {#if mark === null}
          <Flag size={12} /> Mark now
        {:else}
          <X size={12} /> Comparing since mark
        {/if}
      </button>
      <button
        type="button"
        onclick={run}
        disabled={running}
        class="flex items-center gap-1 rounded bg-accent px-2 py-1 text-xs text-white hover:opacity-90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Play size={12} />
        {running ? 'Comparing…' : 'Compare'}
      </button>
    </div>

    {#if mark === null}
      <label class="mb-1 block text-[11px] text-fg-muted">
        Investigating
        <input
          bind:value={outlierQuery}
          placeholder="duration > 500"
          class="mt-0.5 w-full rounded border border-line bg-subtle px-2 py-1 font-mono text-xs text-fg focus:border-accent focus:outline-none"
        />
      </label>
    {:else}
      <p class="mb-1 text-[11px] text-fg-subtle">
        Comparing spans since the mark against those before it, within the
        current time window.
      </p>
    {/if}
    <label class="block text-[11px] text-fg-muted">
      {mark === null ? 'Compared with' : 'Restricted to'}
      <input
        bind:value={baselineQuery}
        placeholder="everything else"
        class="mt-0.5 w-full rounded border border-line bg-subtle px-2 py-1 font-mono text-xs text-fg focus:border-accent focus:outline-none"
      />
    </label>
  </div>

  <div class="flex-1 overflow-auto px-4 py-3">
    {#if !result}
      <p class="text-xs text-fg-subtle">
        Describe the spans you are investigating, or mark a moment and compare
        what came after it. The result ranks the attributes that tell the two
        groups apart.
      </p>
    {:else if result.status === 'unavailable' || result.status === 'invalid' || result.status === 'error'}
      <p class="text-xs text-danger">{result.message}</p>
    {:else if result.status === 'empty'}
      <p class="text-xs text-fg-muted">
        Nothing to compare: {result.outlierCount} against {result.baselineCount}
        spans. A share of zero events says nothing about either group.
      </p>
    {:else if result.status === 'ok'}
      {#if result.differences.length === 0}
        <p class="text-xs text-fg-muted">
          No attribute separates these {result.outlierCount} spans from the
          {result.baselineCount} they were compared with.
        </p>
      {:else}
        <p class="mb-2 text-[11px] text-fg-subtle">
          {result.outlierCount} spans against {result.baselineCount}. A
          hypothesis to check against individual traces, not a conclusion.
        </p>
        <table class="w-full text-left text-xs">
          <thead class="text-[11px] uppercase tracking-wide text-fg-muted">
            <tr>
              <th class="py-1 pr-2 font-medium">Attribute</th>
              <th class="py-1 pr-2 font-medium">These</th>
              <th class="py-1 pr-2 font-medium">Those</th>
            </tr>
          </thead>
          <tbody>
            {#each result.differences as row (`${row.field}=${row.value}`)}
              <tr class="border-t border-line-subtle">
                <td class="py-1 pr-2 font-mono">
                  {row.field}<span class="text-fg-subtle">=</span>{row.value}
                </td>
                <td class="py-1 pr-2 tabular-nums">
                  {percent(row.outlierFraction)}
                </td>
                <td class="py-1 pr-2 tabular-nums text-fg-muted">
                  {percent(row.baselineFraction)}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    {/if}
  </div>
</div>
