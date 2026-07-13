<script lang="ts">
  /**
   * A faceted filter popover: a "Filter" button that opens a dropdown of facet
   * sections, each a list of toggleable values with live counts (event-types +
   * tools with counts). Any view can pass its own facets (service, status, …).
   * Multi-select within a facet; the active-value count shows on the button.
   *
   * Long facets get a type-to-narrow box. Closes on outside click / Esc.
   */
  import { Filter, X, Search } from '@lucide/svelte';
  import { cn } from '../utils/cn';
  import type { Facet, FacetOption } from './facetFilter.types';

  interface Props {
    facets: Facet[];
    /** Clears every facet's selection. */
    onClearAll: () => void;
    /** Show the narrow box once a facet has more than this many options. */
    searchThreshold?: number;
  }
  let { facets, onClearAll, searchThreshold = 8 }: Props = $props();

  let open = $state(false);
  let needle = $state('');
  let rootEl: HTMLDivElement | undefined = $state();

  const activeCount = $derived(
    facets.reduce((sum, f) => sum + f.selected.size, 0),
  );
  const anyLongFacet = $derived(
    facets.some((f) => f.options.length > searchThreshold),
  );

  function visibleOptions(facet: Facet): FacetOption[] {
    const n = needle.trim().toLowerCase();
    const opts = n
      ? facet.options.filter((o) => o.value.toLowerCase().includes(n))
      : facet.options;
    // Selected first, then by count desc, then alphabetically.
    return [...opts].sort((a, b) => {
      const aSel = facet.selected.has(a.value) ? 1 : 0;
      const bSel = facet.selected.has(b.value) ? 1 : 0;
      if (aSel !== bSel) return bSel - aSel;
      if (a.count !== b.count) return b.count - a.count;
      return a.value.localeCompare(b.value);
    });
  }

  function toggle() {
    open = !open;
    if (!open) needle = '';
  }

  $effect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      // The widget mounts in a shadow root, so `e.target` at the document level
      // is the retargeted shadow host — `contains()` would report every
      // in-popover click as "outside". `composedPath()` pierces the shadow
      // boundary, so we can ask whether the click actually landed within us.
      if (rootEl && !e.composedPath().includes(rootEl)) {
        open = false;
        needle = '';
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        open = false;
        needle = '';
      }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  });
</script>

<div class="relative" bind:this={rootEl}>
  <button
    type="button"
    onclick={toggle}
    class={cn(
      'flex items-center gap-1 px-2 py-1 text-xs rounded border transition-colors',
      activeCount > 0 || open
        ? 'border-accent/40 bg-accent/10 text-accent'
        : 'border-line text-fg-muted hover:bg-hover',
    )}
    aria-haspopup="true"
    aria-expanded={open}
    title="Filter by facets"
  >
    <Filter size={12} />
    <span>Filter</span>
    {#if activeCount > 0}
      <span
        class="ml-0.5 min-w-[16px] px-1 rounded-full bg-accent text-[10px] font-semibold text-white text-center tabular-nums"
      >
        {activeCount}
      </span>
    {/if}
  </button>

  {#if open}
    <div
      class="absolute right-0 z-30 mt-1 w-64 max-h-[60vh] overflow-auto rounded-md border border-line bg-surface shadow-lg"
      role="menu"
    >
      {#if anyLongFacet}
        <div class="sticky top-0 bg-surface p-2 border-b border-line-subtle">
          <div class="relative">
            <Search
              size={12}
              class="absolute left-2 top-1/2 -translate-y-1/2 text-fg-subtle"
            />
            <input
              type="text"
              bind:value={needle}
              placeholder="Narrow options…"
              class="w-full pl-6 pr-2 py-1 text-xs rounded border border-line bg-subtle text-fg focus:outline-none focus:border-accent"
            />
          </div>
        </div>
      {/if}

      {#each facets as facet (facet.key)}
        {@const opts = visibleOptions(facet)}
        <div class="p-2 border-b border-line-subtle last:border-b-0">
          <div
            class="flex items-center justify-between px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle"
          >
            <span>{facet.label}</span>
            {#if facet.selected.size > 0}
              <span class="text-accent normal-case">{facet.selected.size}</span>
            {/if}
          </div>
          {#if opts.length === 0}
            <div class="px-1 py-1 text-xs text-fg-subtle">No matches</div>
          {:else}
            <div class="flex flex-col gap-0.5">
              {#each opts as opt (opt.value)}
                {@const active = facet.selected.has(opt.value)}
                <button
                  type="button"
                  onclick={() => facet.onToggle(opt.value)}
                  class={cn(
                    'flex items-center gap-2 px-1.5 py-1 rounded text-xs text-left transition-colors',
                    active
                      ? 'bg-accent/15 text-accent'
                      : 'text-fg-muted hover:bg-hover',
                  )}
                  role="menuitemcheckbox"
                  aria-checked={active}
                >
                  <span
                    class={cn(
                      'flex-shrink-0 w-3 h-3 rounded-sm border flex items-center justify-center',
                      active ? 'bg-accent border-accent' : 'border-line',
                    )}
                  >
                    {#if active}
                      <svg
                        viewBox="0 0 12 12"
                        class="w-2.5 h-2.5 text-white"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                      >
                        <path
                          d="M2.5 6.5l2.5 2.5 4.5-5"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        />
                      </svg>
                    {/if}
                  </span>
                  <span class="flex-1 truncate" title={opt.value}
                    >{opt.value}</span
                  >
                  <span class="flex-shrink-0 font-mono tabular-nums text-fg-subtle"
                    >{opt.count}</span
                  >
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/each}

      {#if activeCount > 0}
        <button
          type="button"
          onclick={onClearAll}
          class="flex items-center gap-1 w-full px-3 py-2 text-xs text-fg-subtle hover:bg-hover transition-colors border-t border-line"
        >
          <X size={12} />
          Clear all filters
        </button>
      {/if}
    </div>
  {/if}
</div>
