<script lang="ts">
  /**
   * Metrics view - displays events, funnels, outcomes, and values
   */
  import {
    BarChart,
    TrendingUp,
    Target,
    DollarSign,
    SquareArrowOutUpRight,
  } from '@lucide/svelte';
  import {
    groupedMetricsSignal,
    setSelectedTrace,
    setSelectedTab,
  } from '../store.svelte';
  import { formatNumber, formatTimestamp } from '../utils';
  import type { MetricData } from '../types';
  import CopyButton from './CopyButton.svelte';

  function goToTrace(traceId: string) {
    setSelectedTrace(traceId);
    setSelectedTab('traces');
  }

  function metricToJson(metric: MetricData): string {
    return JSON.stringify(
      {
        name: metric.name,
        type: metric.type,
        value: metric.value,
        attributes: metric.attributes,
        timestamp: metric.timestamp,
      },
      null,
      2,
    );
  }

  const metrics = $derived(groupedMetricsSignal.value);
</script>

{#snippet metricRow(metric: MetricData)}
  <div
    class="group flex items-center justify-between gap-3 p-3 bg-subtle rounded-md text-sm border border-line"
  >
    <div class="flex-1 min-w-0">
      <div class="font-medium truncate text-fg">{metric.name}</div>
      {#if Object.keys(metric.attributes).length > 0}
        <div class="text-xs text-fg-muted mt-1.5 flex flex-wrap gap-2">
          {#each Object.entries(metric.attributes).slice(0, 3) as [key, value] (key)}
            <span class="font-mono">{key}: {String(value)}</span>
          {/each}
        </div>
      {/if}
    </div>

    <div class="flex items-center gap-2 flex-shrink-0">
      <div class="text-right">
        {#if metric.value !== undefined}
          <div class="font-semibold text-accent text-sm">
            {formatNumber(metric.value)}
          </div>
        {/if}
        <div class="text-xs text-fg-subtle mt-1">
          {formatTimestamp(metric.timestamp)}
        </div>
      </div>

      {#if metric.traceId}
        <button
          onclick={() => goToTrace(metric.traceId!)}
          title="Go to originating trace"
          aria-label="Go to originating trace"
          class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity p-1 rounded text-fg-subtle hover:text-accent hover:bg-hover flex-shrink-0"
        >
          <SquareArrowOutUpRight size={12} />
        </button>
      {/if}

      <CopyButton
        value={metricToJson(metric)}
        label="Copy metric JSON"
        class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
      />
    </div>
  </div>
{/snippet}

{#snippet metricSection(
  title: string,
  icon: typeof BarChart,
  items: MetricData[],
)}
  {@const Icon = icon}
  <div class="border border-line rounded-md p-4 bg-surface">
    <h4 class="text-sm font-semibold flex items-center gap-2 mb-3 text-fg">
      <Icon size={16} />
      {title} ({items.length})
    </h4>

    <div class="space-y-2">
      {#each items.slice(0, 10) as metric (metric.id ?? `${metric.name}-${metric.timestamp}`)}
        {@render metricRow(metric)}
      {/each}

      {#if items.length > 10}
        <div
          class="text-xs text-fg-subtle text-center pt-2 border-t border-line"
        >
          +{items.length - 10} more
        </div>
      {/if}
    </div>
  </div>
{/snippet}

<div class="flex flex-col h-full p-4">
  <!-- Header -->
  <div class="flex items-center justify-between mb-4 pb-3 border-b border-line">
    <h3 class="text-sm font-semibold flex items-center gap-2 text-fg">
      <BarChart size={16} />
      Metrics
    </h3>
  </div>

  <!-- Metrics grid -->
  <div class="flex-1 overflow-auto space-y-4">
    {#if metrics.events.length === 0 && metrics.funnels.length === 0 && metrics.outcomes.length === 0 && metrics.values.length === 0}
      <div class="text-center text-fg-subtle text-sm py-12">
        No metrics yet. Waiting for data...
      </div>
    {:else}
      {#if metrics.events.length > 0}
        {@render metricSection('Events', BarChart, metrics.events)}
      {/if}

      {#if metrics.funnels.length > 0}
        {@render metricSection('Funnels', TrendingUp, metrics.funnels)}
      {/if}

      {#if metrics.outcomes.length > 0}
        {@render metricSection('Outcomes', Target, metrics.outcomes)}
      {/if}

      {#if metrics.values.length > 0}
        {@render metricSection('Values', DollarSign, metrics.values)}
      {/if}
    {/if}
  </div>
</div>
