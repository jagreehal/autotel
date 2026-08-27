<script lang="ts">
  // Live receiver connection state. Tracked in the store but, until now, never
  // shown — so users couldn't tell "no data yet" from "not connected". Reused by
  // both surfaces (full-page sidebar + embedded panel header).
  //
  // Beyond static connectivity it now signals *flow*: the dot pings when a batch
  // of telemetry arrives, and the non-compact form shows a rolling ingest rate
  // (items/sec) — a throughput meter for the OTLP receiver.
  import {
    connectionStatusSignal,
    activityTickSignal,
    ingestRatePerSecond,
    connectionUrlSignal,
  } from '../store.svelte';
  import { cn } from '../utils/cn';
  import { httpBaseFromWsUrl } from '../source-client';

  interface Props {
    /** Dot only (for tight headers); otherwise dot + label + rate. */
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

  // Ping the dot for ~900ms whenever a fresh batch lands.
  const tick = $derived(activityTickSignal.value);
  let pulsing = $state(false);
  $effect(() => {
    // Touch the tick so this re-runs on every arrival.
    void tick;
    if (tick === 0) return;
    pulsing = true;
    const id = setTimeout(() => (pulsing = false), 900);
    return () => clearTimeout(id);
  });

  // Rolling ingest rate, recomputed on a 1s cadence so it decays to 0 when the
  // stream goes quiet (the buffer empties without fresh samples). Only the
  // non-compact form shows it, so the compact dot skips the timer entirely.
  let rate = $state(0);
  $effect(() => {
    if (compact) return;
    const compute = () => {
      rate = Math.round(ingestRatePerSecond(5000).total);
    };
    compute();
    const id = setInterval(compute, 1000);
    return () => clearInterval(id);
  });

  const showRate = $derived(!compact && status === 'connected' && rate > 0);
  let storage = $state<{ bytesUsed: number; maxBytes: number } | null>(null);
  $effect(() => {
    if (compact || status !== 'connected') return;
    let active = true;
    const load = async () => {
      const wsUrl = connectionUrlSignal.value;
      const base =
        (wsUrl ? httpBaseFromWsUrl(wsUrl) : null) ??
        globalThis.location?.origin;
      if (!base) return;
      try {
        const response = await fetch(`${base}/api/stats`);
        if (response.ok && active) storage = await response.json();
      } catch {
        // Store size is secondary status; connectivity remains authoritative.
      }
    };
    void load();
    const id = setInterval(load, 30_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  });

  function formatBytes(bytes: number): string {
    if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }
</script>

<div
  class={cn('flex items-center gap-1.5', !compact && 'px-3 py-2')}
  role="status"
  aria-label={`OTLP receiver: ${meta.label}`}
  title={`OTLP receiver: ${meta.label}${rate > 0 ? ` · ${rate}/s` : ''}`}
>
  <span class="relative inline-flex w-2 h-2 shrink-0">
    {#if pulsing && status === 'connected'}
      <span
        class="absolute inset-0 rounded-full bg-success opacity-75 animate-ping"
        aria-hidden="true"
      ></span>
    {/if}
    <span
      class={cn('relative inline-block w-2 h-2 rounded-full', meta.dot)}
      aria-hidden="true"
    ></span>
  </span>
  {#if !compact}
    <span class={cn('text-xs font-medium', meta.text)}>{meta.label}</span>
    {#if showRate}
      <span
        class="text-xs font-mono tabular-nums text-fg-subtle"
        title="Telemetry ingest rate"
      >
        · {rate}/s
      </span>
    {/if}
    {#if storage}
      <span
        class="text-xs font-mono tabular-nums text-fg-subtle"
        title="Telemetry store usage and retention cap"
      >
        · {formatBytes(storage.bytesUsed)} / {formatBytes(storage.maxBytes)}
      </span>
    {/if}
  {/if}
</div>
