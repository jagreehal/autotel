<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Copy, Check } from '@lucide/svelte';
  import { cn } from '../utils/cn';

  interface Props {
    content: string;
    children: Snippet;
  }
  let { content, children }: Props = $props();

  let copied = $state(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(content);
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }
</script>

<div class="relative group">
  {@render children()}
  <button
    onclick={handleCopy}
    class={cn(
      'absolute top-2 right-2 p-1.5 rounded-md',
      'bg-surface border border-line shadow-sm',
      'opacity-0 group-hover:opacity-100 transition-opacity',
      'hover:bg-subtle',
    )}
    title="Copy"
  >
    {#if copied}
      <Check size={14} class="text-success" />
    {:else}
      <Copy size={14} class="text-fg-muted" />
    {/if}
  </button>
</div>
