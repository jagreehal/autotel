<script lang="ts" module>
  function formatRelativeTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s ago`;

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }
</script>

<script lang="ts">
  // Errors view - displays aggregated error groups
  import {
    AlertTriangle,
    Clock,
    Hash,
    ChevronDown,
    ChevronRight,
    ExternalLink,
    Search,
  } from '@lucide/svelte';
  import {
    sortedErrorGroupsSignal,
    errorGroupsByFrequencySignal,
    totalErrorCountSignal,
    recentErrorCountSignal,
    setSelectedTrace,
    setSelectedTab,
  } from '../store.svelte';
  import { formatTimestamp } from '../utils';
  import CopyButton from './CopyButton.svelte';
  import Copyable from './Copyable.svelte';
  import SearchInput from './SearchInput.svelte';
  import { useListKeyboardNav } from './listNav.svelte';
  import { matchesNeedle } from '../utils/textMatch';
  import type { ErrorGroup } from '../types';

  function errorGroupMatches(group: ErrorGroup, query: string): boolean {
    return matchesNeedle(query.toLowerCase(), [
      group.type,
      group.message,
      ...group.affectedTraces,
    ]);
  }

  type SortMode = 'recent' | 'frequent';

  let sortMode = $state<SortMode>('recent');
  let expandedGroup = $state<string | null>(null);
  let query = $state('');
  let listRef: HTMLDivElement | undefined = $state();

  const errorGroups = $derived(
    sortMode === 'recent'
      ? sortedErrorGroupsSignal.value
      : errorGroupsByFrequencySignal.value,
  );
  const filteredGroups = $derived(
    errorGroups.filter((group) => errorGroupMatches(group, query)),
  );
  const isFiltered = $derived(query.length > 0);
  const totalErrors = $derived(totalErrorCountSignal.value);
  const recentErrors = $derived(recentErrorCountSignal.value);

  const nav = useListKeyboardNav({
    count: () => filteredGroups.length,
    onActivate: (index) => {
      const group = filteredGroups[index];
      if (group) toggleGroup(group.fingerprint);
    },
    scrollToIndex: (index) =>
      listRef
        ?.querySelector<HTMLElement>(`[data-row-index="${index}"]`)
        ?.scrollIntoView({ block: 'nearest' }),
  });

  function toggleGroup(fingerprint: string) {
    expandedGroup = expandedGroup === fingerprint ? null : fingerprint;
  }

  function viewTrace(traceId: string) {
    setSelectedTrace(traceId);
    setSelectedTab('traces');
  }
</script>

{#snippet errorGroupCard(
  group: ErrorGroup,
  isExpanded: boolean,
  index: number,
  isCursor: boolean,
)}
  {@const timeSinceFirstSeen = Date.now() - group.firstSeen}
  {@const timeSinceLastSeen = Date.now() - group.lastSeen}

  <div
    role="option"
    aria-selected={isCursor}
    data-row-index={index}
    class={`border border-line rounded-md bg-surface overflow-hidden${
      isCursor ? ' ring-1 ring-inset ring-accent bg-accent/10' : ''
    }`}
  >
    <!-- Header - clickable -->
    <button
      onclick={() => {
        nav.cursor = index;
        toggleGroup(group.fingerprint);
      }}
      class="w-full p-3 flex items-start gap-3 hover:bg-subtle transition-colors text-left"
    >
      <div class="mt-0.5">
        {#if isExpanded}
          <ChevronDown size={16} class="text-fg-subtle" />
        {:else}
          <ChevronRight size={16} class="text-fg-subtle" />
        {/if}
      </div>

      <div class="flex-1 min-w-0">
        <!-- Error type and count -->
        <div class="flex items-center gap-2 mb-1">
          <span class="text-sm font-semibold text-danger">
            {group.type}
          </span>
          <span
            class="px-1.5 py-0.5 text-xs font-medium bg-danger-bg text-danger rounded"
          >
            {group.count}x
          </span>
          {#if group.service}
            <span
              class="px-1.5 py-0.5 text-xs font-medium bg-hover text-fg-muted rounded"
            >
              {group.service}
            </span>
          {/if}
        </div>

        <!-- Error message -->
        <div class="group flex items-start gap-1 mb-2">
          <p class="text-sm text-fg-muted truncate">{group.message}</p>
          <CopyButton
            value={`${group.type}: ${group.message}`}
            label="Copy error message"
            class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          />
        </div>

        <!-- Timestamps -->
        <div class="flex items-center gap-4 text-xs text-fg-subtle">
          <span class="flex items-center gap-1">
            <Clock size={12} />
            First: {formatRelativeTime(timeSinceFirstSeen)}
          </span>
          <span class="flex items-center gap-1">
            <Clock size={12} />
            Last: {formatRelativeTime(timeSinceLastSeen)}
          </span>
        </div>
      </div>
    </button>

    <!-- Expanded content -->
    {#if isExpanded}
      <div class="border-t border-line p-3 bg-subtle space-y-3">
        <!-- Stack trace -->
        {#if group.stackTrace}
          <div>
            <h5 class="text-xs font-semibold text-fg-muted mb-1.5">
              Stack Trace
            </h5>
            <Copyable content={group.stackTrace}>
              <pre
                class="text-xs font-mono bg-code text-fg p-2 rounded overflow-x-auto whitespace-pre-wrap">{group.stackTrace}</pre>
            </Copyable>
          </div>
        {/if}

        <!-- Affected spans -->
        {#if group.affectedSpans.length > 0}
          <div>
            <h5 class="text-xs font-semibold text-fg-muted mb-1.5">
              Affected Operations
            </h5>
            <div class="flex flex-wrap gap-1">
              {#each group.affectedSpans as span, i (i)}
                <span
                  class="px-2 py-0.5 text-xs font-mono bg-hover text-fg-muted rounded"
                >
                  {span}
                </span>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Affected traces -->
        {#if group.affectedTraces.length > 0}
          <div>
            <h5 class="text-xs font-semibold text-fg-muted mb-1.5">
              Recent Traces
            </h5>
            <div class="space-y-1">
              {#each group.affectedTraces.slice(0, 5) as traceId (traceId)}
                <div class="group flex items-center gap-1">
                  <button
                    onclick={() => viewTrace(traceId)}
                    class="flex items-center gap-1 text-xs text-fg-muted hover:text-fg font-mono"
                  >
                    <Hash size={10} />
                    {traceId.slice(0, 16)}...
                    <ExternalLink size={10} />
                  </button>
                  <CopyButton
                    value={traceId}
                    label="Copy trace ID"
                    size={10}
                    class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                  />
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Attributes -->
        {#if group.attributes && Object.keys(group.attributes).length > 0}
          <div>
            <h5 class="text-xs font-semibold text-fg-muted mb-1.5">Context</h5>
            <div class="text-xs space-y-0.5">
              {#each Object.entries(group.attributes) as [key, value] (key)}
                <div class="flex gap-2">
                  <span class="text-fg-subtle">{key}:</span>
                  <span class="font-mono text-fg-muted">
                    {String(value)}
                  </span>
                </div>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Full timestamps -->
        <div class="text-xs text-fg-subtle pt-2 border-t border-line">
          <div class="flex gap-4">
            <span>First seen: {formatTimestamp(group.firstSeen)}</span>
            <span>Last seen: {formatTimestamp(group.lastSeen)}</span>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/snippet}

<div class="flex flex-col h-full p-4">
  <!-- Header -->
  <div class="flex items-center justify-between mb-4 pb-3 border-b border-line">
    <h3 class="text-sm font-semibold flex items-center gap-2 text-fg">
      <AlertTriangle size={16} class="text-danger" />
      Errors
      {#if isFiltered}
        <span class="text-xs font-normal text-fg-muted">
          ({filteredGroups.length} of {errorGroups.length})
        </span>
      {/if}
      {#if totalErrors > 0}
        <span
          class="ml-1 px-2 py-0.5 text-xs font-medium bg-danger-bg text-danger rounded-full"
        >
          {totalErrors}
        </span>
      {/if}
    </h3>
    <div class="flex items-center gap-2">
      <select
        class="text-xs border border-line rounded px-2 py-1 bg-surface text-fg-muted"
        value={sortMode}
        onchange={(e) =>
          (sortMode = (e.target as HTMLSelectElement).value as SortMode)}
      >
        <option value="recent">Most Recent</option>
        <option value="frequent">Most Frequent</option>
      </select>
    </div>
  </div>

  <!-- Filter bar -->
  {#if errorGroups.length > 0}
    <SearchInput
      bind:value={query}
      class="mb-4"
      inputClass="border-line bg-subtle text-fg focus:border-line focus:ring-1 focus:ring-accent"
      placeholder="Filter by type, message, trace id…"
      ariaLabel="Filter errors"
    />
  {/if}

  <!-- Stats bar -->
  {#if totalErrors > 0}
    <div class="flex gap-4 mb-4 p-3 bg-subtle rounded-md border border-line">
      <div class="text-sm">
        <span class="text-fg-muted">Groups:</span>
        <span class="font-semibold text-fg">
          {isFiltered
            ? `${filteredGroups.length} of ${errorGroups.length}`
            : errorGroups.length}
        </span>
      </div>
      <div class="text-sm">
        <span class="text-fg-muted">Total:</span>
        <span class="font-semibold text-fg">{totalErrors}</span>
      </div>
      <div class="text-sm">
        <span class="text-fg-muted">Last hour:</span>
        <span class="font-semibold text-danger">{recentErrors}</span>
      </div>
    </div>
  {/if}

  <!-- Error groups list -->
  <div
    bind:this={listRef}
    role="listbox"
    tabindex="0"
    aria-label="Error groups"
    onkeydown={nav.onKeyDown}
    class="flex-1 overflow-auto space-y-2 focus:outline-none"
  >
    {#if errorGroups.length === 0}
      <div
        class="flex flex-col items-center justify-center h-full text-fg-subtle py-12"
      >
        <AlertTriangle size={32} class="mb-2 text-fg-subtle" />
        <p class="text-sm">No errors captured</p>
        <p class="text-xs text-fg-subtle mt-1">
          Errors from failed traces will appear here
        </p>
      </div>
    {:else if filteredGroups.length === 0}
      <div
        class="flex flex-col items-center justify-center h-full text-fg-subtle py-12"
      >
        <Search size={32} class="mb-2 text-fg-subtle" />
        <p class="text-sm">No matching errors</p>
        <p class="text-xs text-fg-subtle mt-1">
          No error groups match the current filter
        </p>
      </div>
    {:else}
      {#each filteredGroups as group, i (group.fingerprint)}
        {@render errorGroupCard(
          group,
          expandedGroup === group.fingerprint,
          i,
          nav.cursor === i,
        )}
      {/each}
    {/if}
  </div>
</div>
