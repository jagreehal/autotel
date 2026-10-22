<script lang="ts" module>
  import type { TraceKind, TraceNode } from '../../genai/trace';
  import type { SpanRef } from '../../genai/types';
  import { formatDuration } from '../../utils';
  import { formatCostUsd } from '../../utils/genaiFormat';
  import {
    Bot,
    Layers,
    Cpu,
    Brain,
    Wrench,
    MessageSquare,
    ArrowRight,
    RefreshCw,
  } from '@lucide/svelte';

  // Soft fills, so a run of twenty bars reads as a shape rather than a wall of
  // colour; status (error, running) is what gets the strong treatment.
  const KIND_STYLE: Record<
    TraceKind,
    { icon: typeof Cpu; text: string; bar: string; seg: string; name: string }
  > = {
    agent: {
      icon: Bot,
      text: 'text-violet-600',
      bar: 'bg-violet-500/15 border-violet-500/30',
      seg: 'bg-violet-500',
      name: 'Agent run',
    },
    group: {
      icon: Layers,
      text: 'text-blue-600',
      bar: 'bg-blue-500/10 border-blue-500/30',
      seg: 'bg-blue-500',
      name: 'Model calls',
    },
    step: {
      icon: Cpu,
      text: 'text-blue-600',
      bar: 'bg-indigo-500/15 border-indigo-500/30',
      seg: 'bg-indigo-500',
      name: 'LLM call',
    },
    reasoning: {
      icon: Brain,
      text: 'text-amber-600',
      bar: 'bg-amber-500/15 border-amber-500/30',
      seg: 'bg-amber-500',
      name: 'Reasoning',
    },
    tool: {
      icon: Wrench,
      text: 'text-purple-600',
      bar: 'bg-purple-500/15 border-purple-500/30',
      seg: 'bg-purple-500',
      name: 'Tool call',
    },
    text: {
      icon: MessageSquare,
      text: 'text-emerald-600',
      bar: 'bg-emerald-500/15 border-emerald-500/30',
      seg: 'bg-emerald-500',
      name: 'Text',
    },
    handoff: {
      icon: ArrowRight,
      text: 'text-violet-600',
      bar: 'bg-violet-500/15 border-violet-500/30',
      seg: 'bg-violet-500',
      name: 'Handoff',
    },
    running: {
      icon: RefreshCw,
      text: 'text-accent',
      bar: 'bg-accent/15 border-accent/40',
      seg: 'bg-accent/70',
      name: 'Running',
    },
  };

  // Name column, then time. Inline rather than an arbitrary utility so the
  // shared stylesheet (which the embedded widget ships too) does not grow.
  const COLUMNS = 'grid-template-columns: minmax(11rem, 38%) 1fr';

  function tokenText(tokens?: TraceNode['tokens']): string {
    if (!tokens) return '';
    const { input, output } = tokens;
    if (input == null && output == null) return '';
    return `${input ?? '—'}→${output ?? '—'}`;
  }

  // Cents are what a person compares at a glance; sub-cent calls keep the
  // precision `formatCostUsd` gives them.
  function costText(usd: number): string {
    return usd >= 0.01 ? `$${usd.toFixed(2)}` : formatCostUsd(usd);
  }
</script>

<script lang="ts">
  import { ChevronRight, Gauge, TriangleAlert } from '@lucide/svelte';
  import {
    axisFor,
    descendantCount,
    endOf,
    hasRunning,
    slowestId,
    visibleRows,
    workSegments,
  } from '../../genai/waterfall';
  import { cn } from '../../utils/cn';

  interface Props {
    nodes: TraceNode[];
    selected?: SpanRef | null;
    onSelectSpan?: (span: SpanRef) => void;
    /** The clock running bars are drawn to. The parent ticks it while the run
     *  is live; without one, a run is drawn as of when it rendered. */
    now?: number;
  }
  let {
    nodes,
    selected = null,
    onSelectSpan,
    now = Date.now(),
  }: Props = $props();

  let collapsed = $state(new Set<string>());
  // The cursor follows a row's id, so live arrivals above it leave it on the
  // same span.
  let cursorId = $state<string | null>(null);
  let listEl: HTMLDivElement | undefined = $state();

  const rows = $derived(visibleRows(nodes, collapsed));
  const cursor = $derived(rows.findIndex((row) => row.id === cursorId));
  const axis = $derived(axisFor(nodes, now));
  const slowest = $derived(slowestId(nodes));
  const live = $derived(hasRunning(nodes));

  // Rows without timing of their own (the reasoning, tool call and answer
  // inside a model call) sit at their nearest timed ancestor's start.
  const anchors = $derived.by(() => {
    const map = new Map<string, number>();
    const walk = (n: TraceNode, anchor: number | undefined): void => {
      const own = n.startMs ?? anchor;
      if (own != null) map.set(n.id, own);
      for (const c of n.children) walk(c, own);
    };
    for (const n of nodes) walk(n, undefined);
    return map;
  });

  const pct = (ms: number): number =>
    axis ? ((ms - axis.t0) / axis.spanMs) * 100 : 0;

  function geometry(node: TraceNode) {
    const end = endOf(node, now);
    if (!axis || node.startMs == null || end == null) return undefined;
    const left = pct(node.startMs);
    const width = Math.max(pct(end) - left, 0);
    return { left, width, end: left + width };
  }

  function durationOf(node: TraceNode): number | undefined {
    if (node.kind === 'running' && node.startMs != null)
      return Math.max(now - node.startMs, 0);
    return node.durationMs;
  }

  function tagText(node: TraceNode): string {
    const parts: string[] = [];
    const d = durationOf(node);
    if (d != null)
      parts.push(
        node.kind === 'running' ? `≥${formatDuration(d)}` : formatDuration(d),
      );
    if (node.costUsd != null) parts.push(costText(node.costUsd));
    return parts.join(' · ');
  }

  function rowLabel(node: TraceNode): string {
    const parts = [node.label, KIND_STYLE[node.kind].name];
    if (node.kind === 'running') parts.push('still running');
    if (node.error) parts.push('error');
    if (node.id === slowest) parts.push('slowest call');
    const tag = tagText(node);
    if (tag) parts.push(tag);
    return parts.join(', ');
  }

  function toggle(node: TraceNode): void {
    const next = new Set(collapsed);
    if (next.has(node.id)) next.delete(node.id);
    else next.add(node.id);
    collapsed = next;
  }

  function activate(node: TraceNode): void {
    if (node.spanId && node.traceId)
      onSelectSpan?.({ traceId: node.traceId, spanId: node.spanId });
    else if (node.children.length > 0) toggle(node);
  }

  function moveTo(index: number): void {
    if (rows.length === 0) return;
    const next = Math.max(0, Math.min(rows.length - 1, index));
    cursorId = rows[next].id;
    listEl
      ?.querySelector(`[data-row="${next}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }

  // The tree pattern: Up/Down move, Right opens or steps in, Left closes or
  // steps out to the parent, Enter opens the span.
  function onKeyDown(event: KeyboardEvent): void {
    const node = rows[cursor];
    switch (event.key) {
      case 'ArrowDown':
      case 'j':
        moveTo(cursor + 1);
        break;
      case 'ArrowUp':
      case 'k':
        moveTo(cursor < 0 ? rows.length - 1 : cursor - 1);
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(rows.length - 1);
        break;
      case 'ArrowRight':
        if (!node) return moveTo(0);
        if (node.children.length === 0) break;
        if (collapsed.has(node.id)) toggle(node);
        else moveTo(cursor + 1);
        break;
      case 'ArrowLeft': {
        if (!node) break;
        if (node.children.length > 0 && !collapsed.has(node.id)) {
          toggle(node);
          break;
        }
        for (let i = cursor - 1; i >= 0; i--) {
          if (rows[i].depth < node.depth) {
            moveTo(i);
            break;
          }
        }
        break;
      }
      case 'Enter':
      case ' ':
        if (node) activate(node);
        break;
      default:
        return;
    }
    event.preventDefault();
  }
</script>

{#if rows.length === 0}
  <div class="p-6 text-sm text-fg-subtle">No trace to display.</div>
{:else}
  <div class="flex flex-col h-full min-h-0 text-xs">
    <!-- Axis header: the same two columns as the rows below it. -->
    <div
      style={COLUMNS}
      class="grid border-b border-line bg-subtle/40 text-[11px] text-fg-subtle select-none"
    >
      <div class="flex items-center gap-2 px-3 py-1.5 border-r border-line">
        <span class="uppercase tracking-wide">Span</span>
        {#if live}
          <span
            class="ml-auto inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2 py-0.5 text-accent font-medium"
            role="status"
          >
            <span class="relative flex w-1.5 h-1.5">
              <span
                class="absolute inset-0 rounded-full bg-accent opacity-60 motion-safe:animate-ping"
              ></span>
              <span
                class="relative inline-flex w-1.5 h-1.5 rounded-full bg-accent"
              ></span>
            </span>
            Live
          </span>
        {/if}
      </div>
      <div class="relative h-7 overflow-hidden" aria-hidden="true">
        {#each axis?.ticks ?? [] as tick, i (tick)}
          <span
            class="absolute top-1/2 -translate-y-1/2 pl-1.5 tabular-nums"
            style="left: {(tick / (axis?.spanMs ?? 1)) * 100}%"
            class:hidden={i === (axis?.ticks.length ?? 0) - 1}
            >{tick === 0 ? '0' : formatDuration(tick)}</span
          >
        {/each}
      </div>
    </div>

    <div
      bind:this={listEl}
      class="relative flex-1 min-h-0 overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
      role="tree"
      aria-label="Run trace"
      tabindex="0"
      aria-activedescendant={cursor >= 0
        ? `run-trace-row-${cursor}`
        : undefined}
      onkeydown={onKeyDown}
    >
      <div class="relative">
        <!-- Gridlines and the now line, behind the time column of every row. -->
        <div
          class="pointer-events-none absolute inset-y-0 right-0"
          style="left: max(11rem, 38%)"
          aria-hidden="true"
        >
          {#each axis?.ticks ?? [] as tick (tick)}
            <span
              class="absolute inset-y-0 w-px bg-line-subtle"
              style="left: {(tick / (axis?.spanMs ?? 1)) * 100}%"
            ></span>
          {/each}
          {#if live && axis}
            <span
              class="absolute inset-y-0 w-px bg-accent/70"
              style="left: {pct(now)}%"
              data-testid="now-line"
            >
              <span
                class="absolute left-1/2 top-0 w-2 h-2 -translate-x-1/2 rounded-full bg-accent"
              ></span>
            </span>
          {/if}
        </div>

        {#each rows as node, index (node.id)}
          {@const style = KIND_STYLE[node.kind]}
          {@const Icon = style.icon}
          {@const geo = geometry(node)}
          {@const isCollapsed = collapsed.has(node.id)}
          {@const hasKids = node.children.length > 0}
          {@const isSlowest = node.id === slowest}
          {@const active =
            node.spanId != null &&
            node.spanId === selected?.spanId &&
            node.traceId === selected?.traceId}
          {@const tag = tagText(node)}
          <!-- svelte-ignore a11y_click_events_have_key_events (the tree owns the keyboard) -->
          <div
            id="run-trace-row-{index}"
            data-row={index}
            role="treeitem"
            aria-level={node.depth + 1}
            aria-selected={active}
            aria-expanded={hasKids ? !isCollapsed : undefined}
            aria-label={rowLabel(node)}
            tabindex="-1"
            class={cn(
              'relative grid items-center h-8 cursor-pointer transition-colors hover:bg-hover',
              active ? 'bg-accent/10' : index === cursor && 'bg-hover',
            )}
            style={COLUMNS}
            onclick={() => {
              cursorId = node.id;
              activate(node);
            }}
          >
            <!-- Name column -->
            <div
              class="flex items-center gap-1.5 min-w-0 h-full pr-2 border-r border-line"
              style="padding-left: {node.depth * 16 + 6}px"
            >
              {#if hasKids}
                <button
                  type="button"
                  tabindex="-1"
                  class="flex items-center justify-center w-4 h-4 shrink-0 rounded text-fg-subtle hover:text-fg hover:bg-hover"
                  aria-label={isCollapsed
                    ? `Expand ${node.label}`
                    : `Collapse ${node.label}`}
                  onclick={(e) => {
                    e.stopPropagation();
                    cursorId = node.id;
                    toggle(node);
                  }}
                >
                  <ChevronRight
                    size={12}
                    class={cn(
                      'motion-safe:transition-transform',
                      !isCollapsed && 'rotate-90',
                    )}
                  />
                </button>
              {:else}
                <span class="w-4 h-4 shrink-0"></span>
              {/if}
              <span
                class="flex items-center justify-center w-5 h-5 shrink-0 rounded-md border border-line bg-surface"
              >
                <Icon
                  size={12}
                  class={cn(
                    style.text,
                    node.kind === 'running' && 'motion-safe:animate-spin',
                  )}
                />
              </span>
              <span
                class={cn(
                  'truncate font-medium',
                  node.error ? 'text-danger' : 'text-fg',
                  node.depth > 0 && !hasKids && 'font-normal',
                )}>{node.label}</span
              >
              {#if node.sublabel && geo}
                <span class="truncate text-fg-subtle min-w-0"
                  >{node.sublabel}</span
                >
              {/if}
              {#if isCollapsed}
                <span
                  class="shrink-0 rounded bg-subtle px-1 text-[10px] font-medium text-fg-muted tabular-nums"
                  title="{descendantCount(node)} hidden"
                  >+{descendantCount(node)}</span
                >
              {/if}
              {#if node.error}
                <TriangleAlert
                  size={12}
                  class="shrink-0 text-danger"
                  aria-hidden="true"
                />
              {/if}
              {#if isSlowest}
                <span
                  class="shrink-0 inline-flex items-center gap-0.5 rounded bg-warning-bg px-1 text-[10px] font-medium text-warning"
                  title="Slowest call in this run"
                >
                  <Gauge size={10} aria-hidden="true" />slowest
                </span>
              {/if}
              <span
                class="ml-auto shrink-0 pl-2 font-mono text-[11px] text-fg-subtle tabular-nums"
              >
                {#if tokenText(node.tokens)}
                  <span title="tokens in → out">{tokenText(node.tokens)}</span>
                {/if}
              </span>
            </div>

            <!-- Time column -->
            <div class="relative h-8 min-w-0 overflow-hidden">
              {#if geo}
                <span
                  class={cn(
                    // Centred without a transform, which the grow-in animation owns.
                    'at-bar-in absolute inset-y-0 my-auto h-2.5 rounded-sm border',
                    node.error ? 'bg-danger-bg border-danger/40' : style.bar,
                    node.kind === 'running' && 'at-bar-live',
                    active && 'ring-1 ring-accent',
                  )}
                  style="left: {geo.left}%; width: max({geo.width}%, 3px)"
                  data-testid="bar"
                >
                  {#if isCollapsed}
                    {#each workSegments(node) as seg (seg.id)}
                      {@const s = geometry(seg)}
                      {#if s && geo.width > 0}
                        <span
                          class={cn(
                            'absolute top-1/2 -translate-y-1/2 h-1 rounded-full',
                            seg.error ? 'bg-danger' : KIND_STYLE[seg.kind].seg,
                          )}
                          style="left: {((s.left - geo.left) / geo.width) *
                            100}%; width: max({(s.width / geo.width) *
                            100}%, 2px)"
                        ></span>
                      {/if}
                    {/each}
                  {/if}
                </span>
                {#if tag}
                  <!-- The tag follows the bar; near the right edge it moves before
                     the bar, and when the bar spans nearly the whole axis it
                     sits inside the bar's end, so it is never clipped. -->
                  <span
                    class={cn(
                      'absolute top-1/2 -translate-y-1/2 whitespace-nowrap font-mono text-[11px] tabular-nums',
                      node.error ? 'text-danger' : 'text-fg-muted',
                    )}
                    style={geo.end <= 72
                      ? `left: calc(${geo.end}% + 6px)`
                      : geo.left >= 28
                        ? `right: calc(${100 - geo.left}% + 6px)`
                        : `right: calc(${100 - geo.end}% + 6px)`}>{tag}</span
                  >
                {/if}
              {:else if node.sublabel}
                <span
                  class="absolute top-1/2 -translate-y-1/2 right-2 truncate text-fg-subtle"
                  style="left: {pct(anchors.get(node.id) ?? axis?.t0 ?? 0)}%"
                  >{node.sublabel}</span
                >
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </div>
  </div>
{/if}
