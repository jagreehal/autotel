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
      ? { dot: 'bg-success', label: 'Connected', text: 'text-success' }
      : status === 'connecting'
        ? {
            dot: 'bg-warning animate-pulse',
            label: 'Connecting…',
            text: 'text-warning',
          }
        : {
            dot: 'bg-danger',
            label: 'Disconnected',
            text: 'text-fg-subtle',
          },
  );
</script>

<div
  class={cn('flex items-center gap-1.5', !compact && 'px-3 py-2')}
  role="status"
  aria-label={`OTLP receiver: ${meta.label}`}
  title={`OTLP receiver: ${meta.label}`}
>
  <span
    class={cn('inline-block w-2 h-2 rounded-full shrink-0', meta.dot)}
    aria-hidden="true"
  ></span>
  {#if !compact}
    <span class={cn('text-xs font-medium', meta.text)}>{meta.label}</span>
  {/if}
</div>
