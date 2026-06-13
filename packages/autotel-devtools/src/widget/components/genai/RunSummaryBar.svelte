<script lang="ts" module>
  import { formatCostUsd } from '../../utils/genaiFormat';
  import { formatDuration } from '../../utils';

  function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }
</script>

<script lang="ts">
  import {
    DollarSign,
    Hash,
    Brain,
    Wrench,
    Bot,
    Clock,
    Cpu,
    AlertTriangle,
  } from '@lucide/svelte';
  import type { RunSummary } from '../../genai/summary';
  import { cn } from '../../utils/cn';

  interface Props {
    summary: RunSummary;
  }
  let { summary }: Props = $props();

  // A KPI is shown only when it carries signal — keeps the strip dense and
  // relevant rather than a wall of zeros for a single chat call.
  const kpis = $derived(
    [
      summary.costKnown && {
        icon: DollarSign,
        label: 'Cost',
        // A trailing "+" flags a lower bound: some model calls were unpriced.
        value:
          formatCostUsd(summary.totalCostUsd) +
          (summary.costComplete ? '' : '+'),
        title: summary.costComplete
          ? 'Total cost across this run (exact)'
          : 'Total cost — lower bound; some model calls are not in the price table',
        accent: true,
      },
      summary.totalTokens > 0 && {
        icon: Hash,
        label: 'Tokens',
        value: `${formatTokens(summary.inputTokens)}→${formatTokens(summary.outputTokens)}`,
        title: `${summary.inputTokens.toLocaleString()} in → ${summary.outputTokens.toLocaleString()} out`,
      },
      summary.reasoningTokens > 0 && {
        icon: Brain,
        label: 'Reasoning',
        value: formatTokens(summary.reasoningTokens),
        title: `${summary.reasoningTokens.toLocaleString()} reasoning tokens`,
      },
      summary.modelCalls > 0 && {
        icon: Cpu,
        label: 'Model calls',
        value: String(summary.modelCalls),
        title: `${summary.modelCalls} LLM request(s)`,
      },
      summary.toolCalls > 0 && {
        icon: Wrench,
        label: 'Tools',
        value: String(summary.toolCalls),
        title: `${summary.toolCalls} tool execution(s)`,
      },
      summary.agentInvocations > 1 && {
        icon: Bot,
        label: 'Agents',
        value: String(summary.agentInvocations),
        title: `${summary.agentInvocations} agent invocation(s)`,
      },
      summary.durationMs > 0 && {
        icon: Clock,
        label: 'Duration',
        value: formatDuration(summary.durationMs),
        title: 'Wall-clock span of the run',
      },
      summary.errors > 0 && {
        icon: AlertTriangle,
        label: 'Errors',
        value: String(summary.errors),
        title: `${summary.errors} errored span(s)`,
        danger: true,
      },
    ].filter(Boolean) as Array<{
      icon: typeof DollarSign;
      label: string;
      value: string;
      title: string;
      accent?: boolean;
      danger?: boolean;
    }>,
  );
</script>

{#if kpis.length > 0}
  <div
    class="flex flex-wrap items-stretch gap-1.5 px-3 py-2 border-b border-line bg-subtle/40"
    role="group"
    aria-label="Run summary"
  >
    {#each kpis as kpi (kpi.label)}
      {@const Icon = kpi.icon}
      <div
        class={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded border bg-surface',
          kpi.danger
            ? 'border-danger/30 text-danger'
            : kpi.accent
              ? 'border-accent/30 text-fg'
              : 'border-line text-fg',
        )}
        title={kpi.title}
      >
        <Icon
          size={12}
          class={cn(
            'shrink-0',
            kpi.danger
              ? 'text-danger'
              : kpi.accent
                ? 'text-accent'
                : 'text-fg-subtle',
          )}
        />
        <span class="text-[10px] uppercase tracking-wide text-fg-subtle"
          >{kpi.label}</span
        >
        <span class="text-xs font-mono font-semibold tabular-nums"
          >{kpi.value}</span
        >
      </div>
    {/each}
    {#if summary.models.length > 0}
      <div
        class="flex items-center gap-1.5 px-2 py-1 text-[11px] text-fg-subtle font-mono truncate max-w-full"
        title={`Models: ${summary.models.join(', ')}`}
      >
        {summary.models.slice(0, 2).join(' · ')}{summary.models.length > 2
          ? ` +${summary.models.length - 2}`
          : ''}
      </div>
    {/if}
  </div>
{/if}
