<script lang="ts">
  import { Boxes } from '@lucide/svelte';
  import { resourceSummariesSignal } from '../store.svelte';
  import { formatTimestamp } from '../utils';
  import { cn } from '../utils/cn';
  import type {
    ResourceHealth,
    ResourceSummary,
    ResourceType,
  } from '../utils/resources';

  const typeOptions: ResourceType[] = [
    'service',
    'database',
    'cache',
    'messaging',
    'external',
    'unknown',
  ];

  function healthClass(health: ResourceHealth): string {
    switch (health) {
      case 'healthy':
        return 'bg-green-50 text-green-700 border-green-200';
      case 'degraded':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'unhealthy':
        return 'bg-red-50 text-red-700 border-red-200';
      default:
        return 'bg-subtle text-fg-muted border-line';
    }
  }

  const resources = $derived(resourceSummariesSignal.value);
  let query = $state('');
  let type = $state<'all' | ResourceType>('all');

  const filtered = $derived.by(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return resources.filter((resource) => {
      const matchesType = type === 'all' || resource.type === type;
      const matchesQuery =
        normalizedQuery.length === 0 ||
        resource.name.toLowerCase().includes(normalizedQuery);
      return matchesType && matchesQuery;
    });
  });
</script>

{#snippet stat(label: string, value: string | number)}
  <div>
    <div class="text-[11px] uppercase tracking-wide text-fg-subtle">
      {label}
    </div>
    <div class="text-sm text-gray-800">{value}</div>
  </div>
{/snippet}

{#snippet resourceRow(resource: ResourceSummary)}
  <div class="border border-line rounded-md p-3 bg-surface">
    <div class="flex items-start justify-between gap-2 mb-2">
      <div>
        <div class="text-sm font-medium text-fg">{resource.name}</div>
        <div class="text-xs text-fg-subtle uppercase tracking-wide">
          {resource.type}
        </div>
      </div>
      <span
        class={cn(
          'px-2 py-1 rounded border text-[11px] font-medium capitalize',
          healthClass(resource.health),
        )}
      >
        {resource.health}
      </span>
    </div>
    <div class="grid grid-cols-2 gap-2 text-xs text-fg-muted sm:grid-cols-5">
      {@render stat('Requests', resource.requestCount)}
      {@render stat('Errors', resource.errorCount)}
      {@render stat('Traces', resource.traceCount)}
      {@render stat('Logs', resource.logCount)}
      {@render stat(
        'Last Seen',
        resource.lastSeen ? formatTimestamp(resource.lastSeen) : 'n/a',
      )}
    </div>
  </div>
{/snippet}

<div class="flex flex-col h-full p-4">
  <div class="flex flex-col gap-3 mb-4 pb-3 border-b border-line">
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-sm font-semibold flex items-center gap-2 text-fg">
        <Boxes size={16} />
        Resources ({resources.length})
      </h3>
    </div>
    <div class="flex flex-wrap gap-2">
      <input
        type="search"
        value={query}
        oninput={(event) => (query = event.currentTarget.value)}
        placeholder="Filter resources"
        class="px-3 py-2 text-xs border border-line rounded-md min-w-[180px]"
      />
      <select
        value={type}
        onchange={(event) =>
          (type = event.currentTarget.value as 'all' | ResourceType)}
        class="px-3 py-2 text-xs border border-line rounded-md bg-surface"
      >
        <option value="all">All types</option>
        {#each typeOptions as option (option)}
          <option value={option}>
            {option}
          </option>
        {/each}
      </select>
    </div>
  </div>

  <div class="flex-1 overflow-auto">
    {#if filtered.length === 0}
      <div class="text-center text-fg-subtle text-sm py-12">
        No resources derived yet. Send traces or logs with resource metadata.
      </div>
    {:else}
      <div class="space-y-2">
        {#each filtered as resource (resource.name)}
          {@render resourceRow(resource)}
        {/each}
      </div>
    {/if}
  </div>
</div>
