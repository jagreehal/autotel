<script lang="ts">
  import { selectedTabSignal, setSelectedTab } from '../store.svelte';
  import { cn } from '../utils/cn';
  import { TAB_DEFS } from '../tabs';

  interface Props {
    orientation?: 'horizontal' | 'vertical';
  }
  let { orientation = 'horizontal' }: Props = $props();

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
  {#each TAB_DEFS as { id, label, icon: Icon } (id)}
    <button
      onclick={() => setSelectedTab(id)}
      class={cn(
        'flex items-center gap-2 px-3 py-2 text-xs font-medium rounded transition-colors whitespace-nowrap',
        selected === id
          ? 'bg-accent text-white'
          : 'text-fg-subtle hover:bg-hover hover:text-fg',
      )}
    >
      <Icon size={14} />
      {label}
    </button>
  {/each}
</nav>
