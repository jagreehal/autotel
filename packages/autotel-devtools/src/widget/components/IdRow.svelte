<script lang="ts">
  import { Copy, Check } from '@lucide/svelte';

  interface Props {
    label: string;
    value: string;
  }
  let { label, value }: Props = $props();

  let copied = $state(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  };
</script>

<div class="flex items-center gap-2">
  <span class="text-fg-subtle w-24 flex-shrink-0">{label}:</span>
  <code class="font-mono text-fg-muted truncate flex-1">{value}</code>
  <button
    onclick={handleCopy}
    class="p-1 hover:bg-hover rounded transition-colors flex-shrink-0"
    title="Copy to clipboard"
  >
    {#if copied}
      <Check size={12} class="text-success" />
    {:else}
      <Copy size={12} class="text-fg-subtle" />
    {/if}
  </button>
</div>
