<script lang="ts">
  import { Copy, Check } from '@lucide/svelte';

  interface Props {
    label: string;
    value: string;
    /**
     * When provided, the value renders as a clickable link that runs this
     * callback (e.g. navigate to the parent span / focus the trace). The copy
     * button is always available regardless.
     */
    onActivate?: () => void;
    /** Tooltip for the link (e.g. "Go to parent span"). */
    activateTitle?: string;
  }
  let { label, value, onActivate, activateTitle }: Props = $props();

  let copied = $state(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  };
</script>

<div class="flex items-center gap-2">
  <span class="text-fg-subtle w-24 flex-shrink-0">{label}:</span>
  {#if onActivate}
    <button
      type="button"
      onclick={onActivate}
      title={activateTitle ?? 'Open'}
      class="font-mono text-accent hover:underline truncate flex-1 text-left cursor-pointer"
    >
      {value}
    </button>
  {:else}
    <code class="font-mono text-fg-muted truncate flex-1">{value}</code>
  {/if}
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
