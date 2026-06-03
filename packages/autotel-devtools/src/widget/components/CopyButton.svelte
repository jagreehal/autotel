<script lang="ts">
  /**
   * Small icon-only copy button for inline use — next to an ID, a value, a row.
   * Use `Copyable` instead when you want a floating button over a block (JSON,
   * code), and `IdRow` for a labelled id + value line.
   *
   * `stop` (default true) keeps the click from bubbling to a clickable parent
   * row, so copying a trace id never also opens the trace.
   */
  import { Copy, Check } from '@lucide/svelte';
  import { cn } from '../utils/cn';

  interface Props {
    value: string;
    label?: string;
    size?: number;
    class?: string;
    stop?: boolean;
  }
  let {
    value,
    label = 'Copy',
    size = 12,
    class: klass = '',
    stop = true,
  }: Props = $props();

  let copied = $state(false);

  async function copy(e: MouseEvent) {
    if (stop) {
      e.stopPropagation();
      e.preventDefault();
    }
    try {
      await navigator.clipboard.writeText(value);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch (err) {
      console.error('[autotel-devtools] copy failed:', err);
    }
  }
</script>

<button
  type="button"
  onclick={copy}
  title={copied ? 'Copied!' : label}
  aria-label={label}
  class={cn(
    'inline-flex items-center justify-center p-1 rounded flex-shrink-0',
    'text-fg-subtle hover:text-fg hover:bg-hover transition-colors',
    klass,
  )}
>
  {#if copied}
    <Check {size} class="text-success" />
  {:else}
    <Copy {size} />
  {/if}
</button>
