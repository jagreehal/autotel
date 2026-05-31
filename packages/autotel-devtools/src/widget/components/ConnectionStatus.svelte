<script lang="ts">
  // Live receiver connection state. Tracked in the store but, until now, never
  // shown — so users couldn't tell "no data yet" from "not connected". Reused by
  // both surfaces (full-page sidebar + embedded panel header).
  import { connectionStatusSignal } from '../store.svelte';
  import { cn } from '../utils/cn';

  interface Props {
    /** Dot only (for tight headers); otherwise dot + label. */
    compact?: boolean;
  }
  let { compact = false }: Props = $props();

  const status = $derived(connectionStatusSignal.value);
  const meta = $derived(
    status === 'connected'
      ? { dot: 'bg-emerald-500', label: 'Connected', text: 'text-emerald-700' }
      : status === 'connecting'
        ? {
            dot: 'bg-amber-500 animate-pulse',
            label: 'Connecting…',
            text: 'text-amber-700',
          }
        : { dot: 'bg-red-500', label: 'Disconnected', text: 'text-red-600' },
  );
</script>

<div
  class={cn('flex items-center gap-1.5', !compact && 'px-3 py-2')}
  title={`OTLP receiver: ${meta.label}`}
>
  <span class={cn('inline-block w-2 h-2 rounded-full shrink-0', meta.dot)}></span>
  {#if !compact}
    <span class={cn('text-xs font-medium', meta.text)}>{meta.label}</span>
  {/if}
</div>
