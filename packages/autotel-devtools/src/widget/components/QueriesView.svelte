<script lang="ts">
  import {
    DatabaseZap,
    TriangleAlert,
    Repeat,
    GitBranch,
  } from '@lucide/svelte';
  import {
    windowedTracesSignal,
    openSpanInWaterfall,
    timeWindowSignal,
  } from '../store.svelte';
  import { formatDuration } from '../utils';
  import { cn } from '../utils/cn';
  import { matchesNeedle } from '../utils/textMatch';
  import { resolveWindow, isUnbounded } from '../timeWindow';
  import {
    buildQueryGroups,
    explainGuidance,
    examinedRatioLabel,
    examinedSeverity,
    prettyStatement,
    sortQueryGroups,
    trendPoints,
    type QueryGroup,
    type QuerySort,
    type Severity,
  } from '../utils/queries';
  import Sparkline from './charts/Sparkline.svelte';
  import Copyable from './Copyable.svelte';
  import PlanDiagnosis from './PlanDiagnosis.svelte';

  // Grouped here rather than in the store, so the grouping code ships only in
  // the bundle that has this tab. Windowed, like every trace-derived view.
  const groups = $derived(buildQueryGroups(windowedTracesSignal.value));
  let query = $state('');
  let sort = $state<QuerySort>('total');
  let selectedKey = $state<string | null>(null);

  const visible = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    return sortQueryGroups(
      groups.filter((group) =>
        matchesNeedle(needle, [
          group.statement ?? '',
          group.collection ?? '',
          group.operation ?? '',
          group.system ?? '',
          group.namespace ?? '',
        ]),
      ),
      sort,
    );
  });

  const selected = $derived(
    visible.find((group) => group.key === selectedKey) ?? null,
  );

  const stats = $derived({
    patterns: groups.length,
    queries: groups.reduce((sum, group) => sum + group.count, 0),
    slowest: groups.reduce((max, group) => Math.max(max, group.maxMs), 0),
    fullScans: groups.filter((group) => group.fullScanCount > 0).length,
    repeated: groups.filter((group) => group.maxPerTrace > 1).length,
  });

  // Trend buckets span the window on screen, or the data's own range under
  // "All", so every row's sparkline shares one time axis.
  const range = $derived.by(() => {
    const window = resolveWindow(timeWindowSignal.value, Date.now());
    if (!isUnbounded(window)) {
      const { start, end } = window as { start: number; end: number };
      return { from: start, to: end };
    }
    let from = Number.POSITIVE_INFINITY;
    let to = Number.NEGATIVE_INFINITY;
    for (const group of groups) {
      from = Math.min(from, group.firstSeenMs);
      to = Math.max(to, group.lastSeenMs);
    }
    return Number.isFinite(from) ? { from, to } : { from: 0, to: 1 };
  });

  const severityText: Record<Severity, string> = {
    ok: 'text-fg-muted',
    warn: 'text-warning',
    bad: 'text-danger',
  };

  // What a first run needs: telemetry flowing here, a database instrumented,
  // and explain on so plans arrive with the queries.
  // Mongoose shown; autotel-drizzle takes the same `explain` option.
  const SETUP = `import { init } from 'autotel';
import { instrumentMongoose } from 'autotel-mongoose';

init({ service: 'my-app', endpoint: 'http://localhost:4318' });
instrumentMongoose(mongoose, { explain: 'plan' });`;

  function label(group: QueryGroup): string {
    return (
      [group.operation, group.collection].filter(Boolean).join(' ') ||
      group.system ||
      'query'
    );
  }
</script>

{#snippet stat(name: string, value: string | number, tone = 'text-fg')}
  <div>
    <div class="text-[11px] uppercase tracking-wide text-fg-subtle">{name}</div>
    <div class={cn('text-sm tabular-nums', tone)}>{value}</div>
  </div>
{/snippet}

{#snippet planBadge(group: QueryGroup)}
  {#if group.fullScanCount > 0}
    <span
      class="px-1.5 py-px rounded border text-[10px] font-medium bg-danger-bg text-danger border-danger/40"
      >FULL SCAN</span
    >
  {:else if group.plan?.blockingSort}
    <span
      class="px-1.5 py-px rounded border text-[10px] font-medium bg-warning-bg text-warning border-warning/40"
      title="The plan sorted in memory">IN-MEMORY SORT</span
    >
  {:else if group.plan}
    <span
      class="text-[10px] font-mono text-fg-muted truncate"
      title={group.plan.stages.join(' → ')}
      >{group.plan.indexes[0] ?? group.plan.node ?? 'planned'}</span
    >
  {:else if group.planIssue?.status === 'failed'}
    <span class="text-[10px] text-danger" title={group.planIssue.error}
      >explain failed</span
    >
  {:else if group.planIssue?.status === 'unsupported'}
    <span class="text-[10px] text-fg-subtle">nothing to plan</span>
  {:else}
    {@const guidance = explainGuidance(group.scope, group.system)}
    {#if guidance.kind === 'unavailable'}
      <span class="text-[10px] text-fg-subtle" title={guidance.reason}
        >no plan capture</span
      >
    {:else}
      <span
        class="text-[10px] text-fg-subtle"
        title="Turn explain on to see plans">explain off</span
      >
    {/if}
  {/if}
{/snippet}

{#snippet row(group: QueryGroup)}
  {@const plan = group.plan}
  {@const examined =
    plan?.rowsExamined !== undefined && plan.rowsReturned !== undefined
      ? {
          label: examinedRatioLabel(plan.rowsExamined, plan.rowsReturned),
          severity: examinedSeverity(plan.rowsExamined, plan.rowsReturned),
        }
      : null}
  <button
    type="button"
    onclick={() => (selectedKey = selectedKey === group.key ? null : group.key)}
    class={cn(
      'w-full grid grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,0.6fr))_minmax(0,0.8fr)_minmax(0,0.9fr)_88px] gap-2 items-center px-3 py-2 text-left text-xs border-b border-line-subtle hover:bg-hover',
      selectedKey === group.key && 'bg-accent/10',
    )}
    aria-pressed={selectedKey === group.key}
  >
    <span class="min-w-0 flex flex-col gap-0.5">
      <span class="min-w-0 flex items-center gap-1.5">
        <span
          class="text-[10px] px-1 py-px rounded border font-mono bg-indigo-500/15 text-indigo-600 border-indigo-500/30 shrink-0"
          >{group.system ?? 'db'}{group.namespace
            ? ` · ${group.namespace}`
            : ''}</span
        >
        <span class="truncate text-fg font-medium">{label(group)}</span>
        {#if group.maxPerTrace > 1}
          <span
            class="shrink-0 px-1 py-px rounded border text-[10px] bg-warning-bg text-warning border-warning/40"
            title={`Ran ${group.maxPerTrace} times in one trace: possible N+1`}
            >Repeated ×{group.maxPerTrace}</span
          >
        {/if}
        {#if group.planHashes.length > 1}
          <span title="The plan changed for this statement" class="shrink-0">
            <GitBranch size={12} class="text-accent" />
          </span>
        {/if}
      </span>
      {#if group.statement}
        <!-- Two statements can share an operation and collection; the shape
             is what tells them apart. -->
        <span class="truncate font-mono text-[10px] text-fg-subtle"
          >{group.statement}</span
        >
      {/if}
    </span>
    <span class="tabular-nums text-fg">{group.count}</span>
    <span class="tabular-nums text-fg-muted"
      >{formatDuration(group.totalMs)}</span
    >
    <span class="tabular-nums text-fg-muted">{formatDuration(group.avgMs)}</span
    >
    <span class="tabular-nums text-fg-muted">{formatDuration(group.p95Ms)}</span
    >
    <span
      class={cn(
        'tabular-nums',
        examined ? severityText[examined.severity] : 'text-fg-subtle',
      )}>{examined?.label ?? 'n/a'}</span
    >
    <span class="min-w-0">{@render planBadge(group)}</span>
    <Sparkline
      points={trendPoints(group.starts, range.from, range.to)}
      width={80}
      height={18}
      ariaLabel={`${label(group)} runs over time`}
    />
  </button>
{/snippet}

{#snippet detail(group: QueryGroup)}
  {@const statement = group.statement ? prettyStatement(group.statement) : null}
  <div
    class="border-t border-line bg-surface p-4 space-y-4 text-xs overflow-auto max-h-[55%]"
  >
    <div class="flex items-center justify-between gap-2">
      <h4 class="text-sm font-semibold text-fg">
        {label(group)}
        {#if group.namespace}
          <span class="ml-1 font-mono text-[11px] font-normal text-fg-subtle"
            >{group.namespace}{group.collection
              ? `.${group.collection}`
              : ''}</span
          >
        {/if}
      </h4>
      <button
        type="button"
        class="text-fg-subtle hover:text-fg"
        onclick={() => (selectedKey = null)}>Close</button
      >
    </div>

    {#if statement}
      <section>
        <div class="text-[11px] uppercase tracking-wide text-fg-subtle mb-1.5">
          Statement, values removed
        </div>
        <Copyable content={group.statement ?? ''}>
          <pre
            class="bg-subtle rounded p-2.5 border border-line font-mono text-[11px] text-fg whitespace-pre-wrap break-all max-h-[200px] overflow-auto">{statement.text}</pre>
        </Copyable>
      </section>
    {/if}

    <section>
      <div class="text-[11px] uppercase tracking-wide text-fg-subtle mb-1.5">
        Across {group.count}
        {group.count === 1 ? 'run' : 'runs'} in {group.traceCount}
        {group.traceCount === 1 ? 'trace' : 'traces'}
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {@render stat('Total', formatDuration(group.totalMs))}
        {@render stat('Average', formatDuration(group.avgMs))}
        {@render stat('p95', formatDuration(group.p95Ms))}
        {@render stat('Max', formatDuration(group.maxMs))}
      </div>
      {#if group.maxPerTrace > 1}
        <button
          type="button"
          class="mt-2 inline-flex items-center gap-1.5 text-warning hover:underline"
          onclick={() => openSpanInWaterfall(group.maxPerTraceTraceId)}
        >
          <Repeat size={12} />
          Repeated ×{group.maxPerTrace} in one trace: possible N+1, open it
        </button>
      {/if}
    </section>

    <section>
      <PlanDiagnosis
        plan={group.plan}
        issue={group.planIssue}
        sample={group.planSample}
        system={group.system}
        scope={group.scope}
        operation={group.operation}
      />
      {#if group.planHashes.length > 1}
        <p class="mt-2 text-accent">
          <GitBranch size={12} class="inline" />
          The planner chose {group.planHashes.length} different plans for this statement
          in this window. The plan above is the most recent.
        </p>
      {/if}
    </section>

    <section>
      <div class="text-[11px] uppercase tracking-wide text-fg-subtle mb-1.5">
        Slowest runs
      </div>
      <ul class="space-y-1">
        {#each group.slowest as run (`${run.traceId}:${run.spanId}`)}
          <li>
            <button
              type="button"
              class="w-full flex items-center justify-between gap-2 px-2 py-1 rounded hover:bg-hover"
              onclick={() => openSpanInWaterfall(run.traceId, run.spanId)}
            >
              <span class="font-mono text-fg-muted truncate">{run.traceId}</span
              >
              <span class="tabular-nums text-fg"
                >{formatDuration(run.durationMs)}</span
              >
            </button>
          </li>
        {/each}
      </ul>
    </section>
  </div>
{/snippet}

<div class="flex flex-col h-full">
  <div class="flex flex-col gap-3 p-4 pb-3 border-b border-line">
    <h3 class="text-sm font-semibold flex items-center gap-2 text-fg">
      <DatabaseZap size={16} />
      Queries ({groups.length})
    </h3>
    <div class="grid grid-cols-2 sm:grid-cols-5 gap-2">
      {@render stat('Patterns', stats.patterns)}
      {@render stat('Queries', stats.queries)}
      {@render stat('Slowest', formatDuration(stats.slowest))}
      {@render stat(
        'Full scans',
        stats.fullScans,
        stats.fullScans > 0 ? 'text-danger' : 'text-fg',
      )}
      {@render stat(
        'Repeated in a trace',
        stats.repeated,
        stats.repeated > 0 ? 'text-warning' : 'text-fg',
      )}
    </div>
    <div class="flex flex-wrap gap-2">
      <input
        type="search"
        value={query}
        oninput={(event) => (query = event.currentTarget.value)}
        placeholder="Filter by statement, collection, operation"
        class="px-3 py-2 text-xs border border-line rounded-md min-w-[220px] flex-1"
      />
      <select
        value={sort}
        onchange={(event) => (sort = event.currentTarget.value as QuerySort)}
        class="px-3 py-2 text-xs border border-line rounded-md bg-surface"
        aria-label="Sort queries"
      >
        <option value="total">Total time</option>
        <option value="count">Count</option>
        <option value="avg">Average</option>
        <option value="p95">p95</option>
        <option value="plan">Worst plan</option>
      </select>
    </div>
  </div>

  {#if groups.length === 0}
    <div
      class="flex-1 flex flex-col items-center justify-center gap-3 text-sm p-8"
    >
      <TriangleAlert size={18} class="text-fg-subtle" />
      <p class="text-fg-muted text-center max-w-[520px]">
        No database spans in this window. Send traces here from an instrumented
        app: autotel-mongoose, autotel-drizzle, or the official instrumentations
        all work. With explain on, each query arrives with its plan.
      </p>
      <Copyable content={SETUP}>
        <pre
          class="bg-subtle rounded p-3 border border-line font-mono text-[11px] text-fg text-left">{SETUP}</pre>
      </Copyable>
    </div>
  {:else}
    <div
      class="grid grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,0.6fr))_minmax(0,0.8fr)_minmax(0,0.9fr)_88px] gap-2 px-3 py-1.5 text-[10px] uppercase tracking-wide text-fg-subtle border-b border-line"
    >
      <span>Statement</span><span>Count</span><span>Total</span><span>Avg</span
      ><span>p95</span><span
        title="Rows examined per row returned, from the latest explained run"
        >Exam/ret</span
      ><span title="From the latest explained run">Plan</span><span>Trend</span>
    </div>
    <div class="flex-1 overflow-auto">
      {#each visible as group (group.key)}
        {@render row(group)}
      {:else}
        <div class="text-center text-fg-subtle text-sm py-8">
          No queries match “{query.trim()}”.
        </div>
      {/each}
    </div>
    {#if selected}
      {@render detail(selected)}
    {/if}
  {/if}
</div>
