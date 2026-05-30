<script lang="ts">
  import { Bot, ArrowRight, Cpu, AlertTriangle } from '@lucide/svelte';
  import { cn } from '../../utils/cn';
  import type { GenAiSpan } from '../../genai/types';

  interface Props {
    rows: Array<{ normalized: GenAiSpan; service: string; traceId: string }>;
    onSelectSpan?: (spanId: string) => void;
    selectedSpanId?: string | null;
  }

  let { rows, onSelectSpan, selectedSpanId }: Props = $props();

  interface Group {
    conversationId: string;
    service: string;
    traceId: string;
    spans: GenAiSpan[];
    startNs: number;
    endNs: number;
  }

  function groupByConversation(rows: Props['rows']): Group[] {
    const byId = new Map<string, Group>();
    // Spans without a conversation id get bucketed by traceId so they still
    // render as a coherent unit (one bucket per trace).
    for (const row of rows) {
      const id = row.normalized.conversationId ?? `trace:${row.traceId}`;
      const g = byId.get(id);
      if (g) {
        g.spans.push(row.normalized);
        g.startNs = Math.min(g.startNs, row.normalized.startNs);
        g.endNs = Math.max(g.endNs, row.normalized.endNs);
      } else {
        byId.set(id, {
          conversationId: id,
          service: row.service,
          traceId: row.traceId,
          spans: [row.normalized],
          startNs: row.normalized.startNs,
          endNs: row.normalized.endNs,
        });
      }
    }
    // Newest first by conversation start.
    return [...byId.values()].sort((a, b) => b.startNs - a.startNs);
  }

  function laneFor(span: GenAiSpan): string {
    if (span.handoff)
      return `handoff: ${span.handoff.fromAgent ?? '?'} → ${span.handoff.toAgent ?? '?'}`;
    if (span.agent?.name) return span.agent.name;
    return `${span.provider}/${span.responseModel ?? span.requestModel}`;
  }

  function formatMs(ns: number): string {
    const ms = ns / 1_000_000;
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  }

  // A span is a wrapper if another span in the same lane is fully contained
  // within its time range (strict containment, not equal). Wrappers render as
  // an outlined rail behind their children rather than a solid block, so the
  // inner steps don't disappear under the parent.
  function markWrappers(spans: GenAiSpan[]): Set<string> {
    const wrapperIds = new Set<string>();
    for (let i = 0; i < spans.length; i++) {
      const a = spans[i];
      for (let j = 0; j < spans.length; j++) {
        if (i === j) continue;
        const b = spans[j];
        const contains =
          b.startNs >= a.startNs &&
          b.endNs <= a.endNs &&
          b.endNs - b.startNs < a.endNs - a.startNs;
        if (contains) {
          wrapperIds.add(a.spanId);
          break;
        }
      }
    }
    return wrapperIds;
  }

  /** Resolves the CSS class for a timeline span bar based on its state. */
  function spanBarClass(
    isWrapper: boolean,
    isHandoffLane: boolean,
    errored: boolean,
  ): string {
    if (isWrapper)
      return 'bg-transparent border border-dashed border-line text-fg-subtle hover:bg-hover/50';
    if (isHandoffLane)
      return 'bg-violet-200 hover:bg-violet-300 text-violet-900 border border-violet-300';
    if (errored)
      return 'bg-red-200 hover:bg-red-300 text-red-900 border border-red-300';
    return 'bg-emerald-100 hover:bg-emerald-200 text-emerald-900 border border-emerald-200';
  }

  // Builds the per-lane ordering, span map and wrapper sets for a group.
  function buildLanes(group: Group) {
    // Build stable lane ordering by first appearance.
    const laneOrder: string[] = [];
    const laneMap = new Map<string, GenAiSpan[]>();
    for (const s of group.spans) {
      const lane = laneFor(s);
      if (!laneMap.has(lane)) {
        laneMap.set(lane, []);
        laneOrder.push(lane);
      }
      laneMap.get(lane)!.push(s);
    }
    // Wrapper detection runs per-lane: a span only wraps spans on its own lane.
    const wrapperIdsByLane = new Map<string, Set<string>>();
    for (const [lane, spans] of laneMap) {
      wrapperIdsByLane.set(lane, markWrappers(spans));
    }
    const durationNs = Math.max(1, group.endNs - group.startNs);
    return { laneOrder, laneMap, wrapperIdsByLane, durationNs };
  }

  const groups = $derived.by(() => groupByConversation(rows));
</script>

{#snippet conversationBlock(group: Group)}
  {@const lanes = buildLanes(group)}
  <div class="border border-line rounded-lg overflow-hidden bg-surface">
    <header
      class="px-3 py-2 border-b border-line bg-subtle flex items-center gap-2 text-sm"
    >
      <Bot size={14} class="text-violet-600" />
      <span
        class="font-mono text-xs text-fg-muted truncate"
        title={group.conversationId}
      >
        {group.conversationId.startsWith('trace:')
          ? `trace ${group.conversationId.slice(6, 14)}…`
          : `conversation ${group.conversationId.slice(0, 12)}…`}
      </span>
      <span class="text-xs text-fg-subtle ml-auto">
        {group.spans.length} span{group.spans.length === 1 ? '' : 's'} · {formatMs(
          lanes.durationNs,
        )} · {group.service}
      </span>
    </header>
    <div class="p-3 space-y-1.5">
      {#each lanes.laneOrder as lane (lane)}
        {@const spans = lanes.laneMap.get(lane)!}
        {@const isHandoffLane = lane.startsWith('handoff:')}
        <div class="flex items-center gap-3">
          <div
            class={cn(
              'w-44 shrink-0 flex items-center gap-1.5 text-xs font-mono truncate',
              isHandoffLane ? 'text-violet-700' : 'text-fg-muted',
            )}
            title={lane}
          >
            {#if isHandoffLane}
              <ArrowRight size={11} />
            {:else}
              <Cpu size={11} class="text-fg-subtle" />
            {/if}
            <span class="truncate">{lane}</span>
          </div>
          <div
            class="relative flex-1 h-6 bg-subtle border border-line-subtle rounded"
          >
            {#each spans as s (s.spanId)}
              {@const leftPct =
                ((s.startNs - group.startNs) / lanes.durationNs) * 100}
              {@const widthPct = Math.max(
                0.5,
                ((s.endNs - s.startNs) / lanes.durationNs) * 100,
              )}
              {@const errored = s.status === 'error'}
              {@const active = s.spanId === selectedSpanId}
              {@const isWrapper =
                lanes.wrapperIdsByLane.get(lane)?.has(s.spanId) ?? false}
              <button
                type="button"
                onclick={() => onSelectSpan?.(s.spanId)}
                title={`${s.operation} · ${formatMs(s.endNs - s.startNs)}${s.usage.inputTokens != null ? ` · ${s.usage.inputTokens}→${s.usage.outputTokens ?? '—'}` : ''}${isWrapper ? ' (wraps children)' : ''}`}
                class={cn(
                  'absolute top-0.5 bottom-0.5 rounded text-[10px] font-mono px-1 truncate flex items-center gap-1 transition-all',
                  spanBarClass(isWrapper, isHandoffLane, errored),
                  active && 'ring-2 ring-zinc-900 ring-offset-1',
                )}
                style="left: {leftPct}%; width: {widthPct}%; min-width: 8px; z-index: {isWrapper
                  ? 1
                  : 2};"
              >
                {#if errored}
                  <AlertTriangle size={9} />
                {/if}
                <span class="truncate">{s.operation}</span>
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
{/snippet}

{#if groups.length === 0}
  <div class="p-6 text-sm text-fg-subtle">No conversations to display.</div>
{:else}
  <div class="p-3 space-y-3 overflow-y-auto h-full">
    {#each groups as g (g.conversationId)}
      {@render conversationBlock(g)}
    {/each}
  </div>
{/if}
