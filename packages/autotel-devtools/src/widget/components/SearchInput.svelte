<script lang="ts">
  /**
   * The filter/search box used across the views — a leading magnifier icon, a
   * text input, and a clear-X button that appears once there's a value. Every
   * view had this same ~20-line block copy-pasted; this is the single source.
   *
   * `class` tweaks the wrapper (e.g. `flex-1`, `mb-4`); `inputClass` appends to
   * the input (the bg/ring variant, or a computed class for active-search
   * highlighting). Bind `value` for the query and, optionally, `ref` to reach
   * the underlying input (e.g. to focus it on `/`).
   */
  import { Search, X } from '@lucide/svelte';
  import { cn } from '../utils/cn';

  interface Props {
    value: string;
    placeholder: string;
    ariaLabel?: string;
    /** Tooltip on the clear button. */
    clearTitle?: string;
    /** Extra classes for the wrapping `<div class="relative …">`. */
    class?: string;
    /** Extra classes appended to the input (border/bg/ring variants). */
    inputClass?: string;
    /** The underlying `<input>`, e.g. for imperative focus. */
    ref?: HTMLInputElement | null;
    /**
     * Controlled mode: called on every change (typing + clear). Use with a
     * one-way `value` (no `bind:`) when the source of truth is external, e.g. a
     * store signal reflected in the URL.
     */
    onValue?: (value: string) => void;
  }
  let {
    value = $bindable(),
    placeholder,
    ariaLabel,
    clearTitle = 'Clear filter',
    class: wrapperClass = 'flex-1',
    inputClass = 'border-line focus:border-line',
    ref = $bindable(null),
    onValue,
  }: Props = $props();

  function setValue(v: string) {
    value = v;
    onValue?.(v);
  }
</script>

<div class={cn('relative', wrapperClass)}>
  <Search
    size={12}
    class="absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle"
  />
  <input
    bind:this={ref}
    {value}
    oninput={(e) => setValue((e.currentTarget as HTMLInputElement).value)}
    {placeholder}
    aria-label={ariaLabel}
    class={cn(
      'w-full pl-7 pr-7 py-1 text-xs rounded border focus:outline-none',
      inputClass,
    )}
  />
  {#if value}
    <button
      type="button"
      onclick={() => setValue('')}
      class="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-fg-subtle hover:text-fg-muted"
      title={clearTitle}
    >
      <X size={12} />
    </button>
  {/if}
</div>
