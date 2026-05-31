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
</script>

<script lang="ts">
  import {
    Cpu,
    MessageSquare,
    Bot,
    List,
    Network,
    ExternalLink,
  } from '@lucide/svelte';
  import { genAiRowsSignal, openSpanInWaterfall } from '../store.svelte';
  import ModelHeader from './genai/ModelHeader.svelte';
  import ConversationPanel from './genai/ConversationPanel.svelte';
  import AgentTimeline from './genai/AgentTimeline.svelte';
  import { cn } from '../utils/cn';

  const rows = $derived(genAiRowsSignal.value);
  let selectedSpanId = $state<string | null>(null);
  let mode = $state<Mode>('list');
  const selected = $derived(
    rows.find((r) => r.normalized.spanId === selectedSpanId) ?? rows[0],
  );
  const hasConversations = $derived(
    rows.some((r) => r.normalized.conversationId),
  );
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
    <div class="flex flex-1 overflow-hidden">
      <div class={cn('w-72 shrink-0 border-r border-line overflow-y-auto')}>
        <ul class="divide-y divide-zinc-100">
          {#each rows as row (row.normalized.spanId)}
            {@const active =
              row.normalized.spanId === selected?.normalized.spanId}
            {@const errored = row.normalized.status === 'error'}
            {@const model =
              row.normalized.responseModel ?? row.normalized.requestModel}
            {@const isAgentSpan =
              row.normalized.agent?.name &&
              (row.normalized.provider === 'unknown' || model === 'unknown')}
            <li>
              <button
                type="button"
                onclick={() => (selectedSpanId = row.normalized.spanId)}
                class={cn(
                  'w-full text-left px-3 py-2 hover:bg-subtle transition-colors',
                  active && 'bg-hover hover:bg-hover',
                )}
              >
                <div class="flex items-center gap-1.5 text-xs font-mono">
                  {#if isAgentSpan}
                    <Bot
                      size={11}
                      class={errored ? 'text-red-500' : 'text-violet-600'}
                    />
                  {:else}
                    <Cpu
                      size={11}
                      class={errored ? 'text-red-500' : 'text-fg-subtle'}
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
      </div>
      <div class="flex-1 overflow-y-auto">
        {#if selected}
          <div class="flex justify-end px-3 pt-2">
            <button
              type="button"
              onclick={() =>
                openSpanInWaterfall(
                  selected.traceId,
                  selected.normalized.spanId,
                )}
              class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-fg-subtle hover:text-fg hover:bg-hover transition-colors"
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
