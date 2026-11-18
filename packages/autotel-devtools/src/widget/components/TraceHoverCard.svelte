<script lang="ts">
  /**
   * Hover card for a trace-list row: what you would otherwise open the trace
   * to learn. Which services it crossed, what failed, where the time went,
   * and the root span's attributes.
   */
  import { AlertCircle } from '@lucide/svelte';
  import { formatDuration } from '../utils';
  import { serviceColor } from '../utils/serviceColor';
  import { summarizeTrace } from '../utils/traceSummary';
  import { appAttributes } from '../utils/keyAttributes';
  import { spanAttributeGrids } from './SpanHoverCard.svelte';
  import type { TraceData } from '../types';

  interface Props {
    trace: TraceData;
  }
  let { trace }: Props = $props();

  const summary = $derived(summarizeTrace(trace));
</script>

<div
  role="tooltip"
  class="w-max min-w-[320px] max-w-[520px] bg-surface border border-line rounded-md shadow-lg p-3 text-left text-xs at-modal-in"
>
  <!-- The row already shows status, duration, span count and time; the card
       adds what it cannot: the full name and what is inside the trace. -->
  <div class="font-medium text-sm text-fg break-all">
    {trace.rootSpan.name || 'unknown'}
  </div>

  {#if summary.services.length > 1}
    <div class="mt-2 flex flex-wrap gap-1">
      {#each summary.services as { name, spans } (name)}
        {@const color = serviceColor(name)}
        <span
          class="px-1.5 rounded text-[11px] font-medium"
          style="background-color: {color.fill}; color: {color.stroke};"
          title={`${spans} spans`}>{name}</span
        >
      {/each}
    </div>
  {/if}

  {#if summary.errorOrigin}
    {@const origin = summary.errorOrigin}
    <div class="mt-2 pt-2 border-t border-line-subtle text-danger">
      <div class="flex items-center gap-1 font-medium">
        <AlertCircle size={12} class="shrink-0" />
        {summary.errors.length} failed
      </div>
      <div class="mt-0.5 break-all">
        <span class="font-mono"
          >{origin.name}{origin.status.message ? ':' : ''}</span
        >
        {origin.status.message ?? ''}
      </div>
    </div>
  {/if}

  {#if summary.slowest.length > 0 && trace.spans.length > 1}
    <div class="mt-2 pt-2 border-t border-line-subtle">
      <div class="text-fg-subtle mb-1">Where the time went (self time)</div>
      <div
        class="grid grid-cols-[minmax(0,auto)_1fr_auto] items-center gap-x-2 gap-y-1 font-mono text-[11px]"
      >
        {#each summary.slowest as { span, selfTime } (span.spanId)}
          <!-- Siblings often share a name; the app's first attribute tells them apart. -->
          {@const [, tag] = appAttributes(span.attributes ?? {})[0] ?? []}
          <span class="truncate text-fg" title={span.name}
            >{span.name}{#if tag}<span class="ml-1.5 text-fg-subtle">{tag}</span
              >{/if}</span
          >
          <span class="h-1.5 rounded bg-subtle overflow-hidden min-w-[60px]">
            <span
              class={span.status.code === 'ERROR'
                ? 'block h-full bg-danger'
                : 'block h-full bg-accent'}
              style="width: {trace.duration > 0
                ? Math.max(2, (selfTime / trace.duration) * 100)
                : 0}%"
            ></span>
          </span>
          <span class="text-fg-muted tabular-nums text-right"
            >{formatDuration(selfTime)}</span
          >
        {/each}
      </div>
    </div>
  {/if}

  {@render spanAttributeGrids(trace.rootSpan.attributes ?? {})}
</div>
