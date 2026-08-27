<script lang="ts">
  /**
   * The "N new" pill shown while the live tail is frozen.
   *
   * The list stops reordering the moment someone is reading it, so this is the
   * only signal that anything is still arriving — and the only way back to
   * live. It is a button, not a badge: seeing the count is half its job,
   * catching up is the other half.
   *
   * Renders nothing while live, or while frozen with nothing pending — an
   * empty pill would claim there is something to catch up on.
   */
  import { ArrowUp } from '@lucide/svelte';
  import { cn } from '../utils/cn';

  interface Props {
    /** Matches that arrived while frozen. */
    count: number;
    /** Whether the view is currently following new data. */
    live: boolean;
    onResume: () => void;
    class?: string;
  }
  let { count, live, onResume, class: className }: Props = $props();

  const visible = $derived(!live && count > 0);
  // Past a point the exact number stops being information and starts being
  // noise — what matters is "a lot arrived".
  const label = $derived(count > 999 ? '999+' : String(count));
</script>

{#if visible}
  <button
    type="button"
    onclick={onResume}
    aria-live="polite"
    title="Show the newest matches and follow new data again"
    class={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
      'bg-accent text-white shadow-sm hover:opacity-90 focus-visible:outline-none',
      'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1',
      'transition-opacity',
      className,
    )}
  >
    <ArrowUp size={12} />
    {label} new
  </button>
{/if}
