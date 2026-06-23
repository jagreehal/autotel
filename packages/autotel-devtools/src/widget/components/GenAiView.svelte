<script lang="ts" module>
  import type { GenAiSpan } from '../genai/types';
  import { formatTokenCounts, formatCostUsd } from '../utils/genaiFormat';
  import { formatDuration } from '../utils';
  import { groupRuns } from '../genai/summary';

  // The "run" a given span belongs to — its conversation group, or its trace
  // when no conversation id. Used to scope the summary strip and the tour to
  // one agent run rather than the whole capture buffer.
  function runRowsFor(
    rows: Array<{ normalized: GenAiSpan; traceId: string }>,
    spanId: string | undefined,
  ): Array<{ normalized: GenAiSpan; traceId: string }> {
    if (!spanId) return [];
    const runs = groupRuns(rows);
    const run = runs.find((r) =>
      r.rows.some((row) => row.normalized.spanId === spanId),
    );
    return run?.rows ?? [];
  }

  function formatTokens(usage: GenAiSpan['usage']): string {
    return formatTokenCounts(usage.inputTokens, usage.outputTokens);
  }

  function formatCost(cost: GenAiSpan['cost']): string {
    return formatCostUsd(cost?.total, cost?.source === 'table');
  }

  type Mode = 'list' | 'timeline' | 'trace';

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
    ListTree,
    ExternalLink,
    ArrowLeft,
  } from '@lucide/svelte';
  import { Sparkles } from '@lucide/svelte';
  import {
    genAiRowsSignal,
    openSpanInWaterfall,
    genaiQuerySignal,
  } from '../store.svelte';
  import ModelHeader from './genai/ModelHeader.svelte';
  import ConversationPanel from './genai/ConversationPanel.svelte';
  import AgentTimeline from './genai/AgentTimeline.svelte';
  import RunTraceView from './genai/RunTraceView.svelte';
  import RunSummaryBar from './genai/RunSummaryBar.svelte';
  import GenAiTour from './genai/GenAiTour.svelte';
  import { summarizeRun } from '../genai/summary';
  import { buildTour } from '../genai/narration';
  import { buildRunTrace } from '../genai/trace';
  import SearchInput from './SearchInput.svelte';
  import { useListKeyboardNav } from './listNav.svelte';
  import { matchesNeedle } from '../utils/textMatch';
  import { cn } from '../utils/cn';

  const rows = $derived(genAiRowsSignal.value);
  let selectedSpanId = $state<string | null>(null);
  let mode = $state<Mode>('list');
  // Global so the full-page UI reflects it in the shareable URL.
  const query = $derived(genaiQuerySignal.value);
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
  const runCount = $derived(groupRuns(rows).length);
  // Single-column (narrow container) master/detail: the detail view replaces
  // the list only once the user has explicitly picked a span. `selected`
  // falls back to the first row for the side-by-side layout, so gate on the
  // explicit `selectedSpanId` here. Above the @md threshold both panes show
  // regardless and these utilities are no-ops.
  const mobileDetailOpen = $derived(selectedSpanId !== null);

  // The agent run (conversation group) the selected span belongs to. Scopes
  // both the summary strip and the guided tour to one run.
  const runRows = $derived(
    runRowsFor(rows, selected?.normalized.spanId ?? selectedSpanId ?? undefined),
  );
  const runSummary = $derived(summarizeRun(runRows.map((r) => r.normalized)));
  const runTrace = $derived(buildRunTrace(runRows.map((r) => r.normalized)));

  // Guided tour ("Explain this run") — steps through the run's spans in order
  // with plain-language narration. Driving selectedSpanId reuses the existing
  // detail panes (ModelHeader + ConversationPanel) as the tour's "stage".
  let tourActive = $state(false);
  let tourIndex = $state(0);
  const tourSteps = $derived(
    tourActive ? buildTour(runRows.map((r) => r.normalized)) : [],
  );

  function startTour() {
    if (runRows.length === 0) return;
    // The tour narrates the detail panes, which live in list mode.
    mode = 'list';
    // Ensure single-column mode shows the detail pane during the tour.
    if (selectedSpanId === null) selectedSpanId = runRows[0].normalized.spanId;
    tourIndex = 0;
    tourActive = true;
  }
  function endTour() {
    tourActive = false;
  }

  // Sync selection to the active tour step (and back: clicking a span while the
  // tour is open just moves the tour to that step, handled in the list).
  $effect(() => {
    if (!tourActive) return;
    const stepSpanId = tourSteps[tourIndex]?.span.spanId;
    if (stepSpanId && stepSpanId !== selectedSpanId) {
      selectedSpanId = stepSpanId;
    }
  });
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
    <button
      type="button"
      onclick={() => (mode = 'trace')}
      class={cn(
        'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors',
        mode === 'trace'
          ? 'bg-surface border border-line text-fg shadow-sm'
          : 'text-fg-subtle hover:text-fg-muted',
      )}
      title="Decompose the selected run into reasoning, tools, text and nested agents"
    >
      <ListTree size={12} />
      Trace
    </button>

    <!-- Explain this run: a narrated, step-by-step walkthrough for demos. -->
    <button
      type="button"
      onclick={startTour}
      disabled={runRows.length === 0 || tourActive}
      class={cn(
        'ml-auto inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors',
        'text-accent hover:bg-accent/10 disabled:opacity-40 disabled:hover:bg-transparent',
      )}
      title="Step through this run with plain-language narration"
    >
      <Sparkles size={12} />
      Explain run
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
{:else if mode === 'trace'}
  <div class="flex flex-col h-full">
    {@render modeToggle()}
    {#if runSummary.spanCount > 0}
      <RunSummaryBar summary={runSummary} />
    {/if}
    <div class="flex-1 overflow-hidden">
      {#if runRows.length === 0}
        <div class="p-6 text-sm text-fg-subtle">
          Select a span (in List) to trace its run, or wait for a multi-span run
          to arrive.
        </div>
      {:else}
        <RunTraceView
          nodes={runTrace}
          selectedSpanId={selected?.normalized.spanId ?? null}
          onSelectSpan={(id) => {
            selectedSpanId = id;
            mode = 'list';
          }}
        />
      {/if}
    </div>
  </div>
{:else}
  <div class="flex flex-col h-full">
    {@render modeToggle()}
    {#if tourActive && tourSteps.length > 0}
      <GenAiTour steps={tourSteps} bind:index={tourIndex} onClose={endTour} />
    {/if}
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
          {#if runSummary.spanCount > 0}
            <RunSummaryBar summary={runSummary} />
          {/if}
          <ModelHeader
            span={selected.normalized}
            onOpenTrace={() =>
              openSpanInWaterfall(selected.traceId, selected.normalized.spanId)}
          />
          <ConversationPanel span={selected.normalized} />
        {/if}
      </div>
    </div>
  </div>
{/if}

{#snippet spanList()}
  <div class="px-3 py-2 border-b border-line bg-subtle/50">
    <div class="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-medium text-fg-muted">
      <span>
        Spans ({isFiltered ? `${filtered.length} of ${rows.length}` : rows.length})
      </span>
      <span>{runCount} run{runCount === 1 ? '' : 's'}</span>
    </div>
    <SearchInput
      value={query}
      onValue={(v) => (genaiQuerySignal.value = v)}
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
            // During a tour, clicking a span jumps the narration to that step
            // rather than fighting the step→selection sync.
            if (tourActive) {
              const stepIdx = tourSteps.findIndex(
                (s) => s.span.spanId === row.normalized.spanId,
              );
              if (stepIdx >= 0) tourIndex = stepIdx;
            }
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
              >{formatDuration(
                row.normalized.endMs - row.normalized.startMs,
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
