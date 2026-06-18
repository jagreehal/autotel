<script lang="ts">
  import { Cpu, Clock, Coins, Hash, Bot, Gauge, ShieldAlert, TriangleAlert } from '@lucide/svelte';
  import { cn } from '../../utils/cn';
  import CopyButton from '../CopyButton.svelte';
  import {
    formatInputTokens,
    formatOutputTokens,
    formatCostUsd,
    formatTokensPerSecond,
    formatSeconds,
  } from '../../utils/genaiFormat';
  import { formatDuration } from '../../utils';
  import type { GenAiSpan } from '../../genai/types';

  interface Props {
    span: GenAiSpan;
  }
  let { span }: Props = $props();

  const PROVIDER_COLORS: Record<string, string> = {
    openai: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
    anthropic: 'bg-orange-500/15 text-orange-600 border-orange-500/30',
    google: 'bg-blue-500/15 text-blue-600 border-blue-500/30',
    mistral: 'bg-fuchsia-500/15 text-fuchsia-600 border-fuchsia-500/30',
    groq: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
    deepseek: 'bg-cyan-500/15 text-cyan-600 border-cyan-500/30',
  };

  const providerClass = $derived(
    PROVIDER_COLORS[span.provider] ?? 'bg-subtle text-fg-muted border-line',
  );
  const latency = $derived(formatDuration(span.endMs - span.startMs));
  const inputTokensLabel = $derived(
    formatInputTokens(span.usage.inputTokens, span.usage.cacheReadInputTokens),
  );
  const outputTokensLabel = $derived(
    formatOutputTokens(
      span.usage.outputTokens,
      span.usage.reasoningOutputTokens,
    ),
  );

  const paramText = $derived.by(() => {
    const params: Array<[string, string | number | undefined]> = [
      ['temp', span.params.temperature],
      ['top_p', span.params.topP],
      ['max', span.params.maxTokens],
    ];
    return params
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k} ${v}`)
      .join(' · ');
  });

  // Streaming throughput: prefer time-to-first-chunk + tok/s when present.
  const streamingLabel = $derived.by(() => {
    const s = span.streaming;
    if (!s) return null;
    const parts: string[] = [];
    if (s.timeToFirstChunkS !== undefined)
      parts.push(`TTFC ${formatSeconds(s.timeToFirstChunkS)}`);
    if (s.outputTokensPerSecond !== undefined)
      parts.push(formatTokensPerSecond(s.outputTokensPerSecond));
    return parts.length > 0 ? parts.join(' · ') : null;
  });

  const costKnown = $derived(
    span.cost?.source === 'table' || span.cost?.source === 'reported',
  );

  // Base classes shared by every status chip (provider, agent, guard, warning).
  const CHIP =
    'inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium';
  const AMBER = 'bg-amber-500/15 text-amber-600 border-amber-500/30';
  const RED = 'bg-red-500/15 text-red-600 border-red-500/30';

  const providerLabel = $derived(
    span.provider === 'unknown' && span.agent?.name ? null : span.provider,
  );
  const modelLabel = $derived(span.responseModel ?? span.requestModel);
  const showAgentChip = $derived(
    span.agent?.name &&
      (span.provider === 'unknown' || modelLabel === 'unknown'),
  );
</script>

<div
  class={cn(
    'flex items-center gap-3 flex-wrap',
    'px-3 py-2 border-b border-line',
    'text-sm',
  )}
>
  {#if showAgentChip}
    <span class={cn(CHIP, 'bg-violet-500/15 text-violet-600 border-violet-500/30')}>
      <Bot size={12} />
      agent: {span.agent!.name}
    </span>
  {:else}
    <span class={cn(CHIP, providerClass)}>
      <Cpu size={12} />
      {providerLabel}
    </span>
  {/if}
  {#if span.guard}
    <span
      class={cn(CHIP, span.guard.stopped || span.guard.action === 'stop' ? RED : AMBER)}
      title={span.guard.message ??
        (span.guard.stopped ? 'Guard stopped the run' : 'Guard warning')}
    >
      <ShieldAlert size={12} />
      guard{span.guard.rule ? `: ${span.guard.rule}` : ''}
    </span>
  {/if}
  {#if span.warnings && span.warnings.length > 0}
    <span
      class={cn(CHIP, AMBER)}
      title={span.warnings
        .map((w) => w.message ?? w.setting ?? w.type)
        .filter(Boolean)
        .join('\n')}
    >
      <TriangleAlert size={12} />
      {span.warnings.length} warning{span.warnings.length === 1 ? '' : 's'}
    </span>
  {/if}
  {#if modelLabel !== 'unknown'}
    <span class="group inline-flex items-center gap-0.5">
      <span class="font-mono text-fg">{modelLabel}</span>
      <CopyButton
        value={modelLabel}
        label="Copy model name"
        class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
      />
    </span>
  {/if}
  <span class="text-fg-subtle">{span.operation}</span>
  <span class="group inline-flex items-center gap-0.5">
    <span class="font-mono text-[11px] text-fg-subtle" title={span.traceId}>
      trace {span.traceId.slice(0, 8)}…
    </span>
    <CopyButton
      value={span.traceId}
      label="Copy trace ID"
      class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
    />
  </span>
  {#if paramText}
    <span class="text-fg-subtle font-mono text-xs">{paramText}</span>
  {/if}
  <span class="ml-auto flex items-center gap-3 text-fg-muted">
    {#if streamingLabel}
      <span
        class="inline-flex items-center gap-1 font-mono text-xs"
        title="Streaming: time to first chunk · output throughput"
      >
        <Gauge size={12} />
        {streamingLabel}
      </span>
    {/if}
    <span class="inline-flex items-center gap-1" title="Latency">
      <Clock size={12} />
      {latency}
    </span>
    <span
      class="inline-flex items-center gap-1 font-mono text-xs"
      title="Tokens in (cached) → out (reasoning)"
    >
      <Hash size={12} />
      {inputTokensLabel}
      <span class="text-fg-subtle">→</span>
      {outputTokensLabel}
    </span>
    <span
      class={cn(
        'inline-flex items-center gap-1',
        costKnown ? 'text-fg' : 'text-fg-subtle',
      )}
      title={span.cost?.source === 'reported'
        ? 'Reported cost (gen_ai.usage.cost.usd)'
        : span.cost?.source === 'table'
          ? 'Estimated cost'
          : `No price for ${span.provider}/${span.requestModel}`}
    >
      <Coins size={12} />
      {formatCostUsd(span.cost?.total, costKnown)}
    </span>
  </span>
</div>
