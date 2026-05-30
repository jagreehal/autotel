<script lang="ts">
  import type { Snippet } from 'svelte';
  import { ChevronDown } from '@lucide/svelte';
  import { cn } from '../utils/cn';

  interface Props {
    label: string;
    expanded: boolean;
    onToggle: () => void;
    children: Snippet;
  }
  let { label, expanded, onToggle, children }: Props = $props();
</script>

<div class="flex flex-col gap-2">
  <button
    onclick={onToggle}
    class="flex items-center gap-2 cursor-pointer text-fg-muted hover:text-fg transition-colors w-fit"
  >
    <ChevronDown
      size={12}
      class={cn(
        'text-fg-subtle transition-transform',
        expanded && 'rotate-180',
      )}
    />
    <span class="text-xs font-medium">{label}</span>
  </button>
  {#if expanded}
    <div>{@render children()}</div>
  {/if}
</div>
