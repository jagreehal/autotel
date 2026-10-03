<script lang="ts">
  /**
   * What one explained run of a statement says: whether a plan was captured
   * and how, the stages it ran, the work it did, and the index that would
   * remove that work. Shared by the Queries tab and span detail, so a plan
   * reads the same wherever you meet it.
   *
   * It always says which run it describes. A statement's latency covers every
   * run; its plan covers one. Showing them together unlabelled invites
   * reading one as the other.
   */
  import type { PlanSummary, PlanSample } from 'autotel-db';
  import { formatDuration } from '../utils';
  import { formatClock } from '../timeFormat';
  import { cn } from '../utils/cn';
  import { openSpanInWaterfall, timeZoneSignal } from '../store.svelte';
  import {
    examinedRatioLabel,
    examinedSeverity,
    explainGuidance,
    indexReason,
    stageTone,
    type Severity,
    type StageTone,
  } from '../utils/queries';
  import Copyable from './Copyable.svelte';

  interface Props {
    /** The captured plan, when one was. */
    plan?: PlanSummary;
    /** A failed or unsupported explain, when no plan was captured. */
    issue?: PlanSummary;
    /** The run the plan came from; omitted when that run is on screen. */
    sample?: PlanSample;
    system?: string;
    /** The instrumentation scope that emitted the spans. */
    scope?: string;
    operation?: string;
    /** One line for "explain is off", where a full setup note would crowd. */
    compact?: boolean;
  }
  let {
    plan,
    issue,
    sample,
    system,
    scope,
    operation,
    compact = false,
  }: Props = $props();

  const toneClass: Record<StageTone, string> = {
    scan: 'bg-danger-bg text-danger border-danger/40',
    sort: 'bg-warning-bg text-warning border-warning/40',
    index: 'bg-success/10 text-success border-success/30',
    other: 'bg-subtle text-fg-muted border-line',
  };
  const severityText: Record<Severity, string> = {
    ok: 'text-fg-muted',
    warn: 'text-warning',
    bad: 'text-danger',
  };
  const guidance = $derived(explainGuidance(scope, system));
</script>

{#snippet label(text: string)}
  <div class="text-[11px] uppercase tracking-wide text-fg-subtle mb-1">
    {text}
  </div>
{/snippet}

{#snippet count(name: string, value: string | number, tone = 'text-fg')}
  <div>
    <div class="text-[10px] uppercase tracking-wide text-fg-subtle">{name}</div>
    <div class={cn('text-xs tabular-nums', tone)}>{value}</div>
  </div>
{/snippet}

<div class="space-y-3 text-xs" data-testid="db-plan">
  {#if plan}
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-[11px] uppercase tracking-wide text-fg-subtle"
        >Plan from one run</span
      >
      <span
        class="px-1.5 py-px rounded border text-[10px] bg-subtle border-line text-fg-muted"
        title={plan.mode === 'plan'
          ? 'explain asked the planner only; the query was not run again, so there are no execution counts'
          : 'explain ran the query again to measure the work it did'}
        >{plan.mode === 'plan'
          ? 'planner only'
          : plan.mode === 'analyze'
            ? 'executed'
            : 'explained'}</span
      >
      {#if sample}
        <button
          type="button"
          class="text-accent hover:underline"
          onclick={() => openSpanInWaterfall(sample.traceId, sample.spanId)}
          title="Open the run this plan was captured from"
        >
          {formatClock(sample.startMs, timeZoneSignal.value)} · open run
        </button>
      {/if}
    </div>

    {#if plan.stages.length > 0}
      <div class="flex flex-wrap items-center gap-1" aria-label="Plan stages">
        {#each plan.stages as stage, index (index)}
          {#if index > 0}<span class="text-fg-subtle">→</span>{/if}
          <span
            class={cn(
              'px-1.5 py-px rounded border font-mono text-[10px]',
              toneClass[stageTone(stage)],
            )}
            title={stageTone(stage) === 'sort'
              ? 'Blocking sort: every match is read before the first is returned'
              : stageTone(stage) === 'scan'
                ? 'Reads the whole table or collection'
                : undefined}>{stage}</span
          >
        {/each}
        {#each plan.indexes as index (index)}
          <span
            class="ml-1 px-1 py-px rounded border font-mono text-[10px] bg-subtle border-line text-fg-muted"
            title="Index used">{index}</span
          >
        {/each}
      </div>
    {/if}

    {#if plan.rowsExamined !== undefined && plan.rowsReturned !== undefined}
      {@const severity = examinedSeverity(plan.rowsExamined, plan.rowsReturned)}
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {#if plan.keysExamined !== undefined}
          {@render count('Keys examined', plan.keysExamined)}
        {/if}
        {@render count(
          'Rows examined',
          plan.rowsExamined,
          severityText[severity],
        )}
        {@render count('Returned', plan.rowsReturned)}
        {@render count(
          'Examined per returned',
          examinedRatioLabel(plan.rowsExamined, plan.rowsReturned),
          severityText[severity],
        )}
      </div>
      <div class="h-1.5 rounded bg-subtle overflow-hidden">
        <div
          class={severity === 'bad'
            ? 'h-full bg-danger'
            : severity === 'warn'
              ? 'h-full bg-warning'
              : 'h-full bg-success'}
          style={`width: ${Math.max(2, Math.min(100, (plan.rowsReturned / Math.max(plan.rowsExamined, 1)) * 100))}%`}
          title="Share of examined rows the query returned"
        ></div>
      </div>
    {:else if plan.mode === 'plan'}
      <p class="text-fg-subtle">
        Planner only, so no execution counts.
        {#if plan.rowsEstimated !== undefined}
          The planner expected {plan.rowsEstimated} rows.
        {/if}
        Use <code class="font-mono">explain: 'analyze'</code> to measure rows examined;
        it runs each read again.
      </p>
    {/if}
    {#if plan.executionMs !== undefined}
      <p class="text-fg-subtle">
        Explain execution time: <span class="text-fg tabular-nums"
          >{formatDuration(plan.executionMs)}</span
        >. Measured when the plan was captured, not the request's own timing.
      </p>
    {/if}

    {#if plan.indexSuggestion}
      <div class="space-y-1.5 border-t border-line-subtle pt-3">
        {@render label('Suggested index')}
        <p class="text-fg-muted">{indexReason(plan)}</p>
        {#if plan.indexFields}
          <table class="text-[11px]">
            <tbody>
              {#each [{ job: 'Equality', fields: plan.indexFields.equality, why: 'exact matches narrow the scan first' }, { job: 'Sort', fields: plan.indexFields.sort, why: 'rows come back already in order, no in-memory sort' }, { job: 'Range', fields: plan.indexFields.range, why: 'bounds the scan last' }] as row (row.job)}
                {#if row.fields.length > 0}
                  <tr>
                    <td class="pr-3 text-fg-subtle align-top">{row.job}</td>
                    <td class="pr-3 font-mono text-fg align-top"
                      >{row.fields
                        .map((field) =>
                          field.endsWith(':-1')
                            ? `${field.slice(0, -3)} desc`
                            : field.endsWith(':1')
                              ? `${field.slice(0, -2)} asc`
                              : field,
                        )
                        .join(', ')}</td
                    >
                    <td class="text-fg-subtle">{row.why}</td>
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
        {/if}
        <Copyable content={plan.indexSuggestion}>
          <pre
            class="bg-subtle rounded p-2 border border-line font-mono text-[11px] text-fg whitespace-pre-wrap break-all">{plan.indexSuggestion}</pre>
        </Copyable>
        <p class="text-fg-subtle">
          Check your existing indexes first: one whose keys start with these
          serves the query already. After creating it, run the request again;
          this statement's plan should show an index stage and rows examined
          close to rows returned.
        </p>
      </div>
    {/if}
  {:else if issue?.status === 'failed'}
    <p class="text-danger">
      Explain failed{issue.error ? `: ${issue.error}` : ''}.
    </p>
    <p class="text-fg-subtle">
      The query itself ran normally; only the plan is missing. A permissions
      error means the database user lacks the right to explain.
    </p>
  {:else if issue?.status === 'unsupported'}
    <p class="text-fg-muted">
      No plan for {operation ?? 'this operation'}: inserts, saves and metadata
      counts have nothing to plan, and explain only runs where the
      instrumentation speaks the database's dialect.
    </p>
  {:else if guidance.kind === 'unavailable'}
    <p class="text-fg-subtle">No plan capture: {guidance.reason}</p>
  {:else if compact}
    <p class="text-fg-subtle">
      No plan: {guidance.kind === 'setup'
        ? `explain is off in ${guidance.source}.`
        : `${guidance.source} does not explain on its own.`}
    </p>
  {:else if guidance.kind === 'manual'}
    <div class="space-y-1.5">
      <p class="text-fg-muted">
        No plan: {guidance.source} does not explain on its own. Fetch a plan where
        you run the query and attach it to the span:
      </p>
      <Copyable content={guidance.code}>
        <pre
          class="bg-subtle rounded p-2 border border-line font-mono text-[11px] text-fg whitespace-pre-wrap break-all">{guidance.code}</pre>
      </Copyable>
      <p class="text-fg-subtle">
        With Mongoose, autotel-mongoose does this for every query:
        <code class="font-mono">explain: 'plan'</code>.
      </p>
    </div>
  {:else}
    <div class="space-y-1.5">
      <p class="text-fg-muted">
        No plan: explain is off. Turn it on in {guidance.source}:
      </p>
      <Copyable content={guidance.code}>
        <pre
          class="bg-subtle rounded p-2 border border-line font-mono text-[11px] text-fg whitespace-pre-wrap break-all">{guidance.code}</pre>
      </Copyable>
      <p class="text-fg-subtle">
        <code class="font-mono">'plan'</code> asks the planner only: one extra
        round trip, nothing runs twice. <code class="font-mono">'analyze'</code>
        runs each read again to measure rows examined; use it in development or CI.
      </p>
    </div>
  {/if}
</div>
