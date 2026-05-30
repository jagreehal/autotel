<script lang="ts">
  import { selectedTabSignal, setSelectedTab } from '../store.svelte';
  import { cn } from '../utils/cn';
  import type { TabType } from '../types';
  import {
    Database,
    Boxes,
    Network,
    BarChart,
    FileText,
    AlertTriangle,
  } from '@lucide/svelte';

  interface Props {
    orientation?: 'horizontal' | 'vertical';
  }
  let { orientation = 'horizontal' }: Props = $props();

  const TABS: Array<{ id: TabType; label: string; icon: typeof Database }> = [
    { id: 'traces', label: 'Traces', icon: Database },
    { id: 'resources', label: 'Resources', icon: Boxes },
    { id: 'service-map', label: 'Service Map', icon: Network },
    { id: 'metrics', label: 'Metrics', icon: BarChart },
    { id: 'logs', label: 'Logs', icon: FileText },
    { id: 'errors', label: 'Errors', icon: AlertTriangle },
  ];

  const selected = $derived(selectedTabSignal.value);
</script>

<nav
  class={cn(
    'flex gap-1 p-1',
    orientation === 'vertical'
      ? 'flex-col w-48 border-r border-line'
      : 'border-b border-line overflow-x-auto',
  )}
>
  {#each TABS as { id, label, icon: Icon } (id)}
    <button
      onclick={() => setSelectedTab(id)}
      class={cn(
        'flex items-center gap-2 px-3 py-2 text-xs font-medium rounded transition-colors whitespace-nowrap',
        selected === id
          ? 'bg-zinc-900 text-zinc-50'
          : 'text-fg-subtle hover:bg-hover hover:text-fg',
      )}
    >
      <Icon size={14} />
      {label}
    </button>
  {/each}
</nav>
