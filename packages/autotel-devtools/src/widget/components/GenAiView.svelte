<script lang="ts" module>
  import type { GenAiSpan } from '../genai/types';
  import { formatTokenCounts, formatCostUsd } from '../utils/genaiFormat';

  function formatLatency(ns: number): string {
    const ms = ns / 1_000_000;
    if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  function formatTokens(usage: GenAiSpan['usage']): string {
    return formatTokenCounts(usage.inputTokens, usage.outputTokens);
  }

  function formatCost(cost: GenAiSpan['cost']): string {
    return formatCostUsd(cost?.total, cost?.source === 'table');
  }

  type Mode = 'list' | 'timeline';

  function rowMatches(
    row: { normalized: GenAiSpan; service?: string },
    query: string,
  ): boolean {
    const n = row.normalized;
    return matchesNeedle(query.toLowerCase(), [
      n.responseModel ?? n.requestModel,
      n.requestModel,
      n.provider,
      String(n.operation),
      n.name,
      n.agent?.name,
      row.service,
    ]);
  }
</script>

<script lang="ts">
  import {
    Cpu,
    MessageSquare,
    Bot,
    List,
    Network,
    ExternalLink,
    ArrowLeft,
  } from '@lucide/svelte';
  import { genAiRowsSignal, openSpanInWaterfall } from '../store.svelte';
  import ModelHeader from './genai/ModelHeader.svelte';
  import ConversationPanel from './genai/ConversationPanel.svelte';
  import AgentTimeline from './genai/AgentTimeline.svelte';
  import SearchInput from './SearchInput.svelte';
  import { useListKeyboardNav } from './listNav.svelte';
  import { matchesNeedle } from '../utils/textMatch';
  import { cn } from '../utils/cn';

  const rows = $derived(genAiRowsSignal.value);
  let selectedSpanId = $state<string | null>(null);
  let mode = $state<Mode>('list');
  let query = $state('');
  const filtered = $derived.by(() =>
    rows.filter((row) => rowMatches(row, query)),
  );

  let rowEls = $state<(HTMLElement | null)[]>([]);

  const nav = useListKeyboardNav({
    count: () => filtered.length,
    // No row focused + Up jumps to the last span (Traces/Errors go to the first).
    fromUnsetUp: 'last',
    onActivate: (index) => {
      selectedSpanId = filtered[index].normalized.spanId;
    },
    scrollToIndex: (index) =>
      rowEls[index]?.scrollIntoView({ block: 'nearest' }),
  });
  const isFiltered = $derived(query.length > 0);
  const selected = $derived(
    filtered.find((r) => r.normalized.spanId === selectedSpanId) ??
      filtered[0] ??
      rows.find((r) => r.normalized.spanId === selectedSpanId) ??
      rows[0],
  );
  const hasConversations = $derived(
    rows.some((r) => r.normalized.conversationId),
  );
  // Single-column (narrow container) master/detail: the detail view replaces
  // the list only once the user has explicitly picked a span. `selected`
  // falls back to the first row for the side-by-side layout, so gate on the
  // explicit `selectedSpanId` here. Above the @md threshold both panes show
  // regardless and these utilities are no-ops.
  const mobileDetailOpen = $derived(selectedSpanId !== null);
</script>

{#snippet modeToggle()}
  <div
    class="flex items-center gap-1 px-3 py-1.5 border-b border-line bg-subtle/50"
  >
    <button
      type="button"
      onclick={() => (mode = 'list')}
      class={cn(
        'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors',
        mode === 'list'
          ? 'bg-surface border border-line text-fg shadow-sm'
          : 'text-fg-subtle hover:text-fg-muted',
      )}
    >
      <List size={12} />
      List
    </button>
    <button
      type="button"
      onclick={() => (mode = 'timeline')}
      disabled={!hasConversations && false}
      class={cn(
        'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors',
        mode === 'timeline'
          ? 'bg-surface border border-line text-fg shadow-sm'
          : 'text-fg-subtle hover:text-fg-muted',
      )}
    >
      <Network size={12} />
      Timeline
      {#if !hasConversations}
        <span class="ml-1 text-[10px] text-fg-subtle">(by trace)</span>
      {/if}
    </button>
  </div>
{/snippet}

{#if rows.length === 0}
  <div class="p-6 text-sm text-fg-subtle">
    <div class="flex items-center gap-2 mb-2 text-fg-muted font-medium">
      <MessageSquare size={16} />
      No GenAI spans yet
    </div>
    <p>
      Spans appear here as soon as your app emits OpenTelemetry GenAI semconv
      attributes (any of <code class="text-xs">gen_ai.system</code>,
      <code class="text-xs">gen_ai.provider.name</code>, or
      <code class="text-xs">gen_ai.operation.name</code>). Works with Vercel AI
      SDK <code class="text-xs">experimental_telemetry</code>, Pydantic AI +
      Logfire, OpenAI Agents v2, Anthropic, Google GenAI, LangChain, OpenLLMetry
      — anything following the spec.
    </p>
  </div>
{:else if mode === 'timeline'}
  <div class="flex flex-col h-full">
    {@render modeToggle()}
    <div class="flex-1 overflow-hidden">
      <AgentTimeline
        {rows}
        selectedSpanId={selected?.normalized.spanId ?? null}
        onSelectSpan={(id) => {
          selectedSpanId = id;
          mode = 'list';
        }}
      />
    </div>
  </div>
{:else}
  <div class="flex flex-col h-full">
    {@render modeToggle()}
    <!-- container-type: inline-size — collapse to a single column when the
         docked panel is narrow (right/left dock), no JS viewport hack. -->
    <div class="@container flex flex-1 overflow-hidden">
      <!-- Span list. Below the threshold it fills the width and hides while a
           span is open (single-column master/detail); above it is a fixed rail. -->
      <div
        class={cn(
          'flex flex-col w-full border-line @md:w-72 @md:shrink-0 @md:border-r',
          // In single-column mode, hide the list once a span is selected.
          mobileDetailOpen && 'hidden @md:flex',
        )}
      >
        {@render spanList()}
      </div>
      <!-- Detail. Below the threshold it is full-width and hidden until a span
           is selected; above it sits beside the rail. -->
      <div
        class={cn(
          'flex-1 overflow-y-auto w-full',
          !mobileDetailOpen && 'hidden @md:block',
        )}
      >
        {#if selected}
          <div class="flex items-center justify-between px-3 pt-2">
            <button
              type="button"
              onclick={() => (selectedSpanId = null)}
              class="@md:hidden inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-fg-subtle hover:text-fg hover:bg-hover transition-colors"
            >
              <ArrowLeft size={11} />
              Back
            </button>
            <button
              type="button"
              onclick={() =>
                openSpanInWaterfall(
                  selected.traceId,
                  selected.normalized.spanId,
                )}
              class="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-fg-subtle hover:text-fg hover:bg-hover transition-colors"
              title="Open this span in the Traces waterfall"
            >
              <ExternalLink size={11} />
              Open in Traces
            </button>
          </div>
          <ModelHeader span={selected.normalized} />
          <ConversationPanel span={selected.normalized} />
        {/if}
      </div>
    </div>
  </div>
{/if}

{#snippet spanList()}
  <div class="px-3 py-2 border-b border-line bg-subtle/50">
    <div class="text-[11px] font-medium text-fg-muted mb-1.5">
      Spans ({isFiltered ? `${filtered.length} of ${rows.length}` : rows.length})
    </div>
    <SearchInput
      bind:value={query}
      class=""
      inputClass="border-line bg-subtle text-fg focus:border-line focus:ring-1 focus:ring-accent"
      placeholder="Filter by model, operation, agent…"
      ariaLabel="Filter GenAI spans"
    />
  </div>
  <ul
    class="divide-y divide-line overflow-y-auto flex-1 focus:outline-none"
    tabindex="0"
    role="listbox"
    aria-label="GenAI spans"
    onkeydown={nav.onKeyDown}
  >
    {#if filtered.length === 0}
      <li class="px-3 py-6 text-xs text-fg-subtle text-center">No matches</li>
    {/if}
    {#each filtered as row, i (row.normalized.spanId)}
      {@const active = row.normalized.spanId === selected?.normalized.spanId}
      {@const errored = row.normalized.status === 'error'}
      {@const model =
        row.normalized.responseModel ?? row.normalized.requestModel}
      {@const isAgentSpan =
        row.normalized.agent?.name &&
        (row.normalized.provider === 'unknown' || model === 'unknown')}
      <li role="option" aria-selected={active}>
        <button
          type="button"
          bind:this={rowEls[i]}
          data-row-index={i}
          onclick={() => {
            nav.cursor = i;
            selectedSpanId = row.normalized.spanId;
          }}
          class={cn(
            'w-full text-left px-3 py-2 hover:bg-subtle transition-colors',
            active && 'bg-hover hover:bg-hover',
            i === nav.cursor && 'ring-1 ring-inset ring-accent bg-accent/10',
          )}
        >
          <div class="flex items-center gap-1.5 text-xs font-mono">
            {#if isAgentSpan}
              <Bot size={11} class={errored ? 'text-danger' : 'text-accent'} />
            {:else}
              <Cpu
                size={11}
                class={errored ? 'text-danger' : 'text-fg-subtle'}
              />
            {/if}
            <span class="text-fg truncate">
              {isAgentSpan
                ? `agent: ${row.normalized.agent!.name}`
                : `${row.normalized.provider}/${model}`}
            </span>
          </div>
          <div
            class="mt-0.5 flex items-center gap-2 text-[11px] text-fg-subtle"
          >
            <span>{row.normalized.operation}</span>
            <span>·</span>
            <span
              >{formatLatency(
                row.normalized.endNs - row.normalized.startNs,
              )}</span
            >
            <span>·</span>
            <span>{formatTokens(row.normalized.usage)}</span>
            <span class="ml-auto">{formatCost(row.normalized.cost)}</span>
          </div>
          {#if row.service}
            <div class="mt-0.5 text-[10px] text-fg-subtle truncate">
              {row.service}
            </div>
          {/if}
        </button>
      </li>
    {/each}
  </ul>
{/snippet}
