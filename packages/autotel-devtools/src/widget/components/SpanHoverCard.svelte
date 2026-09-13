<script lang="ts">
  /**
   * Hover card for a waterfall row: the full span name (the column truncates)
   * plus what you would otherwise click through to the detail panel for.
   */
  import { AlertCircle } from '@lucide/svelte';
  import { formatDuration } from '../utils';
  import { keyAttributes } from '../utils/keyAttributes';
  import type { SpanNode, TraceData } from '../types';
  import { countDescendants } from './WaterfallRow.svelte';

  interface Props {
    node: SpanNode;
    trace: TraceData;
  }
  let { node, trace }: Props = $props();

  const span = $derived(node.span);
  const percent = $derived(
    trace.duration > 0 ? (span.duration / trace.duration) * 100 : 0,
  );
  const descendants = $derived(countDescendants(node));
  const attrs = $derived(keyAttributes(span.attributes ?? {}));
</script>

<div
  role="tooltip"
  class="w-max max-w-[420px] bg-surface border border-line rounded-md shadow-lg p-2.5 text-left text-xs at-modal-in"
>
  <div class="font-medium text-fg break-all mb-1.5">
    {span.name || 'unknown'}
  </div>
  <div
    class="flex flex-wrap gap-x-3 gap-y-0.5 text-fg-muted font-mono tabular-nums"
  >
    <span>{formatDuration(span.duration)}</span>
    <span>{percent.toFixed(percent < 10 ? 1 : 0)}% of trace</span>
    <span>+{formatDuration(span.startTime - trace.startTime)}</span>
    <span>{span.kind}</span>
  </div>
  {#if descendants > 0 || (span.events?.length ?? 0) > 0}
    <div class="text-fg-subtle mt-0.5">
      {#if descendants > 0}{descendants} child{descendants === 1
          ? ''
          : 'ren'}{/if}
      {#if descendants > 0 && (span.events?.length ?? 0) > 0}
        ·
      {/if}
      {#if (span.events?.length ?? 0) > 0}{span.events!.length} event{span
          .events!.length === 1
          ? ''
          : 's'}{/if}
    </div>
  {/if}
  {#if span.status.code === 'ERROR'}
    <div class="flex items-start gap-1 mt-1.5 text-danger">
      <AlertCircle size={12} class="shrink-0 mt-px" />
      <span class="break-all">{span.status.message || 'Error'}</span>
    </div>
  {/if}
  {#if attrs.length > 0}
    <div
      class="mt-1.5 pt-1.5 border-t border-line-subtle font-mono text-[11px] grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5"
    >
      {#each attrs as [key, value] (key)}
        <span class="text-fg-subtle">{key}</span>
        <span class="text-fg break-all">{value}</span>
      {/each}
    </div>
  {/if}
</div>
