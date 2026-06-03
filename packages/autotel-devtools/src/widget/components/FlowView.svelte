<script lang="ts" module>
  import type { FlowRole } from '../flow/flow';

  interface RoleStyle {
    fill: string;
    stroke: string;
    text: string;
    dot: string;
    label: string;
  }

  // Role → palette. Fills are light, strokes/text darker, so coloured nodes read
  // on both themes. Tool = violet (matches ToolCallCard), function = amber, so
  // AI tools and plain functions are instantly distinguishable.
  const ROLE_STYLES: Record<FlowRole, RoleStyle> = {
    entry: {
      fill: 'fill-emerald-500/15',
      stroke: 'stroke-emerald-500/60',
      text: 'fill-emerald-600',
      dot: 'bg-emerald-500',
      label: 'Entry',
    },
    end: {
      fill: 'fill-rose-500/15',
      stroke: 'stroke-rose-500/60',
      text: 'fill-rose-600',
      dot: 'bg-rose-500',
      label: 'End',
    },
    llm: {
      fill: 'fill-blue-500/15',
      stroke: 'stroke-blue-500/60',
      text: 'fill-blue-600',
      dot: 'bg-blue-500',
      label: 'LLM',
    },
    tool: {
      fill: 'fill-violet-500/15',
      stroke: 'stroke-violet-500/60',
      text: 'fill-violet-600',
      dot: 'bg-violet-500',
      label: 'AI tool',
    },
    function: {
      fill: 'fill-amber-500/15',
      stroke: 'stroke-amber-500/60',
      text: 'fill-amber-600',
      dot: 'bg-amber-500',
      label: 'Function',
    },
    db: {
      fill: 'fill-teal-500/15',
      stroke: 'stroke-teal-500/60',
      text: 'fill-teal-600',
      dot: 'bg-teal-500',
      label: 'Database',
    },
    http: {
      fill: 'fill-sky-500/15',
      stroke: 'stroke-sky-500/60',
      text: 'fill-sky-600',
      dot: 'bg-sky-500',
      label: 'HTTP',
    },
  };

  const LEGEND_ORDER: FlowRole[] = [
    'entry',
    'llm',
    'tool',
    'function',
    'db',
    'http',
    'end',
  ];
</script>

<script lang="ts">
  import {
    Workflow,
    MessageSquare,
    Coins,
    ExternalLink,
  } from '@lucide/svelte';
  import {
    tracesSignal,
    genAiRowsSignal,
    openSpanInWaterfall,
  } from '../store.svelte';
  import type { GenAiRow } from '../store.svelte';
  import type { TraceData, SpanData } from '../types';
  import {
    buildFlowGraph,
    layoutFlow,
    sumFlowMetrics,
    NODE_H,
    type FlowNodeMetrics,
    type PositionedNode,
  } from '../flow/flow';
  import { cn } from '../utils/cn';
  import { formatDuration } from '../utils';
  import { formatTokenCounts, formatCostUsd } from '../utils/genaiFormat';
  import JsonField, { prettyJson } from './JsonField.svelte';
  import CopyButton from './CopyButton.svelte';
  import Copyable from './Copyable.svelte';
  import SearchInput from './SearchInput.svelte';
  import { matchesNeedle } from '../utils/textMatch';

  const traces = $derived(tracesSignal.value);
  let selectedTraceId = $state<string | null>(null);
  let selectedNodeId = $state<string | null>(null);

  const trace = $derived<TraceData | undefined>(
    traces.find((t) => t.traceId === selectedTraceId) ?? traces[0],
  );

  // LLM tokens/cost per span, sourced from the canonical GenAI normalization
  // (pricing stays in one place). Keyed by spanId, scoped to the active trace.
  // AI-SDK wrappers (`ai.streamText`) carry aggregate usage AND their per-step
  // children (`doStream`) carry their own — counting both double-counts. So a
  // span whose token-bearing ancestor is already counted is skipped; only the
  // outermost aggregate per chain contributes.
  const metricsBySpanId = $derived.by(() => {
    const m = new Map<string, FlowNodeMetrics>();
    if (!trace) return m;
    const rows = genAiRowsSignal.value.filter(
      (r) => r.traceId === trace.traceId,
    );
    const priced = (c: GenAiRow['normalized']['cost']) =>
      c?.source === 'table' ? c.total : undefined;
    const hasUsage = (r: GenAiRow) =>
      r.normalized.usage.inputTokens != null ||
      r.normalized.usage.outputTokens != null ||
      priced(r.normalized.cost) != null;

    const bearerIds = new Set(rows.filter(hasUsage).map((r) => r.raw.spanId));
    const spanById = new Map(trace.spans.map((s) => [s.spanId, s]));
    const hasBearerAncestor = (raw: SpanData) => {
      let p = raw.parentSpanId;
      while (p) {
        if (bearerIds.has(p)) return true;
        p = spanById.get(p)?.parentSpanId;
      }
      return false;
    };

    for (const row of rows) {
      if (!hasUsage(row) || hasBearerAncestor(row.raw)) continue;
      const { usage, cost } = row.normalized;
      m.set(row.raw.spanId, {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: priced(cost),
      });
    }
    return m;
  });

  const layout = $derived.by(() =>
    trace
      ? layoutFlow(buildFlowGraph(trace.spans, { metricsBySpanId }))
      : null,
  );

  const totalMetrics = $derived<FlowNodeMetrics>(
    layout ? sumFlowMetrics(layout.nodes) : {},
  );

  const nodeById = $derived.by(() => {
    const m = new Map<string, PositionedNode>();
    if (layout) for (const n of layout.nodes) m.set(n.id, n);
    return m;
  });

  const selectedNode = $derived(
    selectedNodeId ? (nodeById.get(selectedNodeId) ?? null) : null,
  );

  // Node search — highlight matches, dim the rest, never remove nodes/edges.
  // Matches case-insensitively across the node label and its role label
  // ("AI tool", "Function", …), which reads as the node's operation.
  let query = $state('');

  function nodeMatches(node: PositionedNode, needle: string): boolean {
    return matchesNeedle(needle, [node.label, ROLE_STYLES[node.role].label]);
  }

  const isSearching = $derived(query.trim().length > 0);

  const matchedIds = $derived.by(() => {
    const ids = new Set<string>();
    if (!layout || !isSearching) return ids;
    const needle = query.trim().toLowerCase();
    for (const n of layout.nodes) if (nodeMatches(n, needle)) ids.add(n.id);
    return ids;
  });

  const matchCount = $derived(matchedIds.size);
  const totalNodeCount = $derived(layout?.nodes.length ?? 0);

  // Curved cubic edge from the bottom-centre of source to top-centre of target.
  function edgePath(sourceId: string, targetId: string): string {
    const s = nodeById.get(sourceId);
    const t = nodeById.get(targetId);
    if (!s || !t) return '';
    const sx = s.x + s.width / 2;
    const sy = s.y + NODE_H;
    const tx = t.x + t.width / 2;
    const ty = t.y;
    const midY = (sy + ty) / 2;
    return `M ${sx} ${sy} C ${sx} ${midY}, ${tx} ${midY}, ${tx} ${ty}`;
  }

  function selectNode(id: string) {
    selectedNodeId = selectedNodeId === id ? null : id;
  }

  // Open the selected node's first span in the Traces waterfall (deep-link).
  function openInWaterfall(node: PositionedNode) {
    if (!trace || node.spanIds.length === 0) return;
    openSpanInWaterfall(trace.traceId, node.spanIds[0]);
  }

  // Arrow-key navigation across the graph: left/right within a layer, up/down
  // to the horizontally-nearest node in the adjacent layer.
  function moveSelection(dir: 'left' | 'right' | 'up' | 'down') {
    const nodes = layout?.nodes ?? [];
    if (nodes.length === 0) return;
    const cur = selectedNodeId ? nodeById.get(selectedNodeId) : undefined;
    if (!cur) {
      selectedNodeId = nodes[0].id;
      return;
    }
    if (dir === 'left' || dir === 'right') {
      const row = nodes
        .filter((n) => n.layer === cur.layer)
        .sort((a, b) => a.x - b.x);
      const i = row.findIndex((n) => n.id === cur.id);
      const target = row[dir === 'left' ? i - 1 : i + 1];
      if (target) selectedNodeId = target.id;
      return;
    }
    const targetLayer = cur.layer + (dir === 'down' ? 1 : -1);
    const layerNodes = nodes.filter((n) => n.layer === targetLayer);
    if (layerNodes.length === 0) return;
    const cx = cur.x + cur.width / 2;
    const nearest = layerNodes.reduce((best, n) =>
      Math.abs(n.x + n.width / 2 - cx) < Math.abs(best.x + best.width / 2 - cx)
        ? n
        : best,
    );
    selectedNodeId = nearest.id;
  }

  let graphFocused = $state(false);

  function onGraphKeydown(e: KeyboardEvent) {
    if (!graphFocused) return;
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        moveSelection('left');
        break;
      case 'ArrowRight':
        e.preventDefault();
        moveSelection('right');
        break;
      case 'ArrowUp':
        e.preventDefault();
        moveSelection('up');
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveSelection('down');
        break;
      case 'Enter':
        if (selectedNode) openInWaterfall(selectedNode);
        break;
      case 'Escape':
        selectedNodeId = null;
        break;
    }
  }

  $effect(() => {
    window.addEventListener('keydown', onGraphKeydown);
    return () => window.removeEventListener('keydown', onGraphKeydown);
  });
</script>

{#if !trace || !layout || layout.nodes.length === 0}
  <div class="p-6 text-sm text-fg-subtle">
    <div class="flex items-center gap-2 mb-2 text-fg-muted font-medium">
      <Workflow size={16} />
      No flow to show yet
    </div>
    <p>
      The Flow view turns a trace into a call graph — entry points, LLM calls,
      AI tool calls and plain functions, with repeated calls collapsed into one
      node (e.g. <code class="text-xs">calculate (5)</code>). Send a trace to
      devtools and it appears here.
    </p>
  </div>
{:else}
  <div class="flex flex-col h-full">
    <!-- Header: trace selector + legend -->
    <div
      class="flex items-center gap-3 px-3 py-1.5 border-b border-line bg-subtle/50 flex-wrap"
    >
      {#if traces.length > 1}
        <select
          class="text-xs bg-surface border border-line rounded px-2 py-1 text-fg max-w-[16rem]"
          bind:value={selectedTraceId}
        >
          {#each traces as t (t.traceId)}
            <option value={t.traceId}>
              {t.service} · {t.rootSpan?.name ?? t.traceId.slice(0, 8)}
            </option>
          {/each}
        </select>
      {:else}
        <div class="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
          <Workflow size={13} />
          {trace.rootSpan?.name ?? 'Flow'}
        </div>
      {/if}
      {#if totalMetrics.costUsd != null || totalMetrics.inputTokens != null}
        <div
          class="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/30 text-[11px] font-medium text-accent"
          title="Total LLM tokens and cost for this trace"
        >
          <Coins size={11} class="text-accent" />
          {#if totalMetrics.costUsd != null}
            <span>{formatCostUsd(totalMetrics.costUsd)}</span>
          {/if}
          <span class="font-mono text-accent/80"
            >{formatTokenCounts(
              totalMetrics.inputTokens,
              totalMetrics.outputTokens,
            )}</span
          >
        </div>
      {/if}
      <SearchInput
        bind:value={query}
        class="ml-auto w-48 max-w-[14rem]"
        inputClass={cn(
          'bg-subtle text-fg',
          isSearching ? 'border-accent ring-1 ring-accent' : 'border-line',
        )}
        ariaLabel="Search flow nodes by name or type"
        placeholder="Search nodes…"
        clearTitle="Clear search"
      />
      <div class="flex items-center gap-3 flex-wrap">
        {#if isSearching}
          <span class="text-[10px] text-fg-muted whitespace-nowrap">
            Nodes ({matchCount} of {totalNodeCount})
          </span>
        {/if}
        {#each LEGEND_ORDER as role (role)}
          <div class="flex items-center gap-1 text-[10px] text-fg-subtle">
            <span class={cn('inline-block w-2 h-2 rounded-sm', ROLE_STYLES[role].dot)}
            ></span>
            {ROLE_STYLES[role].label}
          </div>
        {/each}
      </div>
    </div>

    <div class="flex flex-1 overflow-hidden">
      <!-- Graph canvas — focusable so arrow keys navigate nodes, Enter opens
           the node in the Traces waterfall, Esc deselects. Key handling lives on
           window (gated by focus) to match WaterfallView's pattern. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        class="relative flex-1 overflow-auto bg-surface focus:outline-none"
        role="application"
        aria-label="Flow call graph — arrow keys to navigate, Enter to open in Traces"
        tabindex="0"
        onfocusin={() => (graphFocused = true)}
        onfocusout={() => (graphFocused = false)}
      >
        {#if isSearching && matchCount === 0}
          <div
            class="absolute left-1/2 top-3 -translate-x-1/2 z-10 px-3 py-1.5 rounded border border-line bg-subtle text-xs text-fg-muted shadow-sm"
          >
            No matches for “{query.trim()}”
          </div>
        {/if}
        <svg
          width={layout.width}
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          class="min-w-full"
          role="presentation"
        >
          <defs>
            <marker
              id="flow-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" class="fill-fg-subtle" />
            </marker>
          </defs>

          <!-- Edges -->
          {#each layout.edges as edge (edge.source + '>' + edge.target)}
            {@const dimmed =
              selectedNodeId &&
              edge.source !== selectedNodeId &&
              edge.target !== selectedNodeId}
            <path
              d={edgePath(edge.source, edge.target)}
              fill="none"
              class={cn(
                'stroke-fg-subtle transition-opacity',
                dimmed && 'opacity-20',
              )}
              stroke-width="1.5"
              marker-end="url(#flow-arrow)"
            />
            {#if edge.count > 1}
              {@const s = nodeById.get(edge.source)}
              {@const t = nodeById.get(edge.target)}
              {#if s && t}
                <text
                  x={(s.x + s.width / 2 + t.x + t.width / 2) / 2}
                  y={(s.y + NODE_H + t.y) / 2}
                  text-anchor="middle"
                  class="fill-fg-subtle text-[10px]"
                  dy="-2">×{edge.count}</text
                >
              {/if}
            {/if}
          {/each}

          <!-- Nodes -->
          {#each layout.nodes as node (node.id)}
            {@const style = ROLE_STYLES[node.role]}
            {@const active = node.id === selectedNodeId}
            {@const matched = matchedIds.has(node.id)}
            {@const highlighted = isSearching && matched}
            {@const dimmed =
              (isSearching && !matched) || (selectedNodeId && !active)}
            {@const errored = node.errorCount > 0}
            <g
              role="button"
              tabindex="0"
              class={cn(
                'cursor-pointer transition-opacity focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                dimmed && 'opacity-40',
              )}
              onclick={() => selectNode(node.id)}
              onkeydown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  selectNode(node.id);
                }
              }}
            >
              <rect
                x={node.x}
                y={node.y}
                width={node.width}
                height={NODE_H}
                rx="8"
                class={cn(
                  style.fill,
                  highlighted
                    ? 'stroke-accent'
                    : errored
                      ? 'stroke-red-500'
                      : style.stroke,
                  (active || highlighted) && 'stroke-[2.5px]',
                )}
                stroke-width={active || highlighted ? 2.5 : 1.5}
              />
              <text
                x={node.x + node.width / 2}
                y={node.y + NODE_H / 2}
                text-anchor="middle"
                dominant-baseline="central"
                class={cn('text-[12px] font-medium font-mono', style.text)}
              >
                {node.label.length > 26
                  ? node.label.slice(0, 25) + '…'
                  : node.label}
              </text>
              {#if node.count > 1}
                <g>
                  <rect
                    x={node.x + node.width - 26}
                    y={node.y - 8}
                    width="28"
                    height="16"
                    rx="8"
                    class={cn(
                      errored ? 'fill-red-500' : 'fill-fg-muted',
                    )}
                  />
                  <text
                    x={node.x + node.width - 12}
                    y={node.y}
                    text-anchor="middle"
                    dominant-baseline="central"
                    class="fill-white text-[10px] font-semibold"
                  >
                    {errored
                      ? `${node.count - node.errorCount}/${node.count}`
                      : `${node.count}`}
                  </text>
                </g>
              {/if}
            </g>
          {/each}
        </svg>
      </div>

      <!-- Detail panel -->
      {#if selectedNode}
        {@const style = ROLE_STYLES[selectedNode.role]}
        <div class="w-80 shrink-0 border-l border-line overflow-y-auto bg-surface">
          <div class="px-3 py-2.5 border-b border-line">
            <div class="group flex items-center gap-1.5">
              <span class={cn('inline-block w-2 h-2 rounded-sm', style.dot)}></span>
              <span class="font-mono text-sm font-medium text-fg truncate"
                >{selectedNode.label}</span
              >
              <CopyButton
                value={selectedNode.label}
                label="Copy node name"
                class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
              />
              {#if selectedNode.spanIds.length > 0}
                <button
                  type="button"
                  onclick={() => openInWaterfall(selectedNode)}
                  class="ml-auto shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-fg-subtle hover:text-fg hover:bg-hover transition-colors"
                  title="Open this span in the Traces waterfall"
                >
                  <ExternalLink size={11} />
                  Traces
                </button>
                <CopyButton
                  value={trace.traceId}
                  label="Copy trace ID"
                  class="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                />
              {/if}
            </div>
            <div
              class="mt-1 flex items-center gap-2 text-[11px] text-fg-subtle flex-wrap"
            >
              <span class="uppercase tracking-wide">{style.label}</span>
              <span>·</span>
              <span
                >{selectedNode.count}
                {selectedNode.count === 1 ? 'call' : 'calls'}</span
              >
              {#if selectedNode.errorCount > 0}
                <span>·</span>
                <span class="text-danger">{selectedNode.errorCount} errored</span>
              {/if}
              {#if selectedNode.totalDurationMs > 0}
                <span>·</span>
                <span>{formatDuration(selectedNode.totalDurationMs)}</span>
              {/if}
            </div>
            {#if selectedNode.metrics}
              <div
                class="mt-1.5 flex items-center gap-1.5 text-[11px] text-accent"
              >
                <Coins size={11} class="text-accent" />
                {#if selectedNode.metrics.costUsd != null}
                  <span class="font-medium"
                    >{formatCostUsd(selectedNode.metrics.costUsd)}</span
                  >
                  <span class="text-fg-subtle">·</span>
                {/if}
                <span class="font-mono text-accent/80"
                  >{formatTokenCounts(
                    selectedNode.metrics.inputTokens,
                    selectedNode.metrics.outputTokens,
                  )} tokens</span
                >
              </div>
            {/if}
          </div>

          {#if selectedNode.sample.input !== undefined}
            <div class="px-3 py-2 border-b border-line">
              <Copyable content={prettyJson(selectedNode.sample.input)}>
                <JsonField label="Input" value={selectedNode.sample.input} />
              </Copyable>
            </div>
          {/if}
          {#if selectedNode.sample.output !== undefined}
            <div class="px-3 py-2 border-b border-success-border bg-success-bg">
              <Copyable content={prettyJson(selectedNode.sample.output)}>
                <JsonField
                  label="Output"
                  value={selectedNode.sample.output}
                  tone="positive"
                />
              </Copyable>
            </div>
          {/if}
          {#if selectedNode.sample.input === undefined && selectedNode.sample.output === undefined}
            <div class="px-3 py-3 text-xs text-fg-subtle flex items-center gap-1.5">
              <MessageSquare size={13} />
              No input/output captured for this node.
            </div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}
