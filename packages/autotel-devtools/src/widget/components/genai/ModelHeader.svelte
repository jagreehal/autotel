<script lang="ts">
  import { Cpu, Clock, Coins, Hash, Bot } from '@lucide/svelte';
  import { cn } from '../../utils/cn';
  import CopyButton from '../CopyButton.svelte';
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

  function formatMs(ns: number): string {
    const ms = ns / 1_000_000;
    if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  function formatCost(usd: number): string {
    if (usd === 0) return '$0';
    if (usd < 0.0001) return `$${(usd * 1_000_000).toFixed(2)}μ`;
    if (usd < 0.01) return `$${(usd * 1000).toFixed(3)}m`;
    return `$${usd.toFixed(4)}`;
  }

  function formatTokens(n: number | undefined): string {
    if (n == null) return '—';
    if (n < 1000) return `${n}`;
    return `${(n / 1000).toFixed(1)}k`;
  }

  const providerClass = $derived(
    PROVIDER_COLORS[span.provider] ?? 'bg-subtle text-fg-muted border-line',
  );
  const latency = $derived(formatMs(span.endNs - span.startNs));
  const cachedPct = $derived(
    span.usage.cacheReadInputTokens && span.usage.inputTokens
      ? Math.round(
          (span.usage.cacheReadInputTokens / span.usage.inputTokens) * 100,
        )
      : 0,
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
    <span
      class={cn(
        'inline-flex items-center gap-1 px-2 py-0.5',
        'rounded border text-xs font-medium',
        'bg-violet-500/15 text-violet-600 border-violet-500/30',
      )}
    >
      <Bot size={12} />
      agent: {span.agent!.name}
    </span>
  {:else}
    <span
      class={cn(
        'inline-flex items-center gap-1 px-2 py-0.5',
        'rounded border text-xs font-medium',
        providerClass,
      )}
    >
      <Cpu size={12} />
      {providerLabel}
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
    <span class="inline-flex items-center gap-1" title="Latency">
      <Clock size={12} />
      {latency}
    </span>
    <span class="inline-flex items-center gap-1" title="Tokens in → out">
      <Hash size={12} />
      {formatTokens(span.usage.inputTokens)}
      <span class="text-fg-subtle">→</span>
      {formatTokens(span.usage.outputTokens)}
      {#if cachedPct > 0}
        <span class="ml-1 text-success">({cachedPct}% cached)</span>
      {/if}
    </span>
    <span
      class={cn(
        'inline-flex items-center gap-1',
        span.cost?.source === 'unknown' ? 'text-fg-subtle' : 'text-fg',
      )}
      title={span.cost?.source === 'unknown'
        ? `No price for ${span.provider}/${span.requestModel}`
        : 'Estimated cost'}
    >
      <Coins size={12} />
      {span.cost?.source === 'unknown'
        ? '—'
        : formatCost(span.cost?.total ?? 0)}
    </span>
  </span>
</div>
