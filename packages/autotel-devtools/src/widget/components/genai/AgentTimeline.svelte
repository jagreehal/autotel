<script lang="ts">
  import { Bot, ArrowRight, Cpu, AlertTriangle, Shield } from '@lucide/svelte';
  import { cn } from '../../utils/cn';
  import { formatDuration } from '../../utils';
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
    startMs: number;
    endMs: number;
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
        g.startMs = Math.min(g.startMs, row.normalized.startMs);
        g.endMs = Math.max(g.endMs, row.normalized.endMs);
      } else {
        byId.set(id, {
          conversationId: id,
          service: row.service,
          traceId: row.traceId,
          spans: [row.normalized],
          startMs: row.normalized.startMs,
          endMs: row.normalized.endMs,
        });
      }
    }
    // Newest first by conversation start.
    return [...byId.values()].sort((a, b) => b.startMs - a.startMs);
  }

  function laneFor(span: GenAiSpan): string {
    if (span.handoff)
      return `handoff: ${span.handoff.fromAgent ?? '?'} → ${span.handoff.toAgent ?? '?'}`;
    if (span.agent?.name) return span.agent.name;
    return `${span.provider}/${span.responseModel ?? span.requestModel}`;
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
          b.startMs >= a.startMs &&
          b.endMs <= a.endMs &&
          b.endMs - b.startMs < a.endMs - a.startMs;
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
      return 'bg-violet-500/15 hover:bg-violet-500/25 text-violet-600 border border-violet-500/30';
    if (errored)
      return 'bg-red-500/15 hover:bg-red-500/25 text-red-600 border border-red-500/30';
    return 'bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 border border-emerald-500/30';
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
    const durationMs = Math.max(1, group.endMs - group.startMs);
    return { laneOrder, laneMap, wrapperIdsByLane, durationMs };
  }

  function securityBadges(group: Group): string[] {
    const badges = new Set<string>();
    for (const span of group.spans) {
      const sec = span.agentSecurity;
      if (!sec) continue;
      if (sec.consentOutcome) badges.add(`consent:${sec.consentOutcome}`);
      if (sec.policyDecision === 'deny') badges.add('policy:deny');
      if (sec.injectionVerdict && sec.injectionVerdict !== 'clean') {
        badges.add(`injection:${sec.injectionVerdict}`);
      }
      if (sec.guardStopped) badges.add('guard:stop');
      if (sec.securityEvent) badges.add(sec.securityEvent);
      if (sec.planStepIndex !== undefined) badges.add(`plan:#${sec.planStepIndex}`);
    }
    return [...badges];
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
      <span class="text-xs text-fg-subtle ml-auto flex items-center gap-1.5 flex-wrap justify-end">
        {#each securityBadges(group) as badge (badge)}
          <span
            class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 border border-amber-500/20 font-mono"
            title="Agent security signal"
          >
            <Shield size={10} />
            {badge}
          </span>
        {/each}
        {group.spans.length} span{group.spans.length === 1 ? '' : 's'} · {formatDuration(
          lanes.durationMs,
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
              isHandoffLane ? 'text-violet-600' : 'text-fg-muted',
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
                ((s.startMs - group.startMs) / lanes.durationMs) * 100}
              {@const widthPct = Math.max(
                0.5,
                ((s.endMs - s.startMs) / lanes.durationMs) * 100,
              )}
              {@const errored = s.status === 'error'}
              {@const active = s.spanId === selectedSpanId}
              {@const isWrapper =
                lanes.wrapperIdsByLane.get(lane)?.has(s.spanId) ?? false}
              <button
                type="button"
                onclick={() => onSelectSpan?.(s.spanId)}
                title={`${s.operation} · ${formatDuration(s.endMs - s.startMs)}${s.usage.inputTokens != null ? ` · ${s.usage.inputTokens}→${s.usage.outputTokens ?? '—'}` : ''}${isWrapper ? ' (wraps children)' : ''}`}
                class={cn(
                  'absolute top-0.5 bottom-0.5 rounded text-[10px] font-mono px-1 truncate flex items-center gap-1 transition-all',
                  spanBarClass(isWrapper, isHandoffLane, errored),
                  active && 'ring-2 ring-accent ring-offset-1',
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
