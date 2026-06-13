<script lang="ts" module>
  import type { TraceKind, TraceNode } from '../../genai/trace';
  import { formatDuration } from '../../utils';
  import { Bot, Layers, Cpu, Brain, Wrench, MessageSquare, ArrowRight } from '@lucide/svelte';

  const KIND_STYLE: Record<
    TraceKind,
    { icon: typeof Cpu; dot: string; text: string }
  > = {
    agent: { icon: Bot, dot: 'bg-violet-500', text: 'text-violet-600' },
    group: { icon: Layers, dot: 'bg-blue-500', text: 'text-blue-600' },
    step: { icon: Cpu, dot: 'bg-blue-500', text: 'text-fg' },
    reasoning: { icon: Brain, dot: 'bg-amber-500', text: 'text-amber-600' },
    tool: { icon: Wrench, dot: 'bg-purple-500', text: 'text-purple-600' },
    text: { icon: MessageSquare, dot: 'bg-emerald-500', text: 'text-emerald-600' },
    handoff: { icon: ArrowRight, dot: 'bg-violet-500', text: 'text-violet-600' },
  };

  function tokenText(tokens?: TraceNode['tokens']): string {
    if (!tokens) return '';
    const { input, output } = tokens;
    if (input == null && output == null) return '';
    return `${input ?? '—'}→${output ?? '—'}`;
  }
</script>

<script lang="ts">
  import { flattenTrace } from '../../genai/trace';
  import { cn } from '../../utils/cn';

  interface Props {
    nodes: TraceNode[];
    selectedSpanId?: string | null;
    onSelectSpan?: (spanId: string) => void;
  }
  let { nodes, selectedSpanId = null, onSelectSpan }: Props = $props();

  const rows = $derived(flattenTrace(nodes));
</script>

{#if rows.length === 0}
  <div class="p-6 text-sm text-fg-subtle">No trace to display.</div>
{:else}
  <div class="py-1 overflow-y-auto h-full font-mono text-xs">
    {#each rows as node (node.id)}
      {@const style = KIND_STYLE[node.kind]}
      {@const Icon = style.icon}
      {@const selectable = node.spanId != null}
      {@const active = node.spanId != null && node.spanId === selectedSpanId}
      <button
        type="button"
        disabled={!selectable}
        onclick={() => node.spanId && onSelectSpan?.(node.spanId)}
        class={cn(
          'group flex w-full items-center gap-2 py-1 pr-3 text-left transition-colors',
          selectable ? 'hover:bg-subtle cursor-pointer' : 'cursor-default',
          active && 'bg-accent/10',
        )}
        style="padding-left: {node.depth * 18 + 8}px"
      >
        <!-- depth rail + kind marker -->
        <span class="relative flex items-center gap-1.5 shrink-0">
          {#if node.depth > 0}
            <span class="text-line-subtle select-none">·</span>
          {/if}
          <span class={cn('w-1.5 h-1.5 rounded-full shrink-0', style.dot)}></span>
          <Icon size={12} class={cn('shrink-0', style.text)} />
        </span>

        <span class={cn('shrink-0 font-medium', style.text)}>{node.label}</span>

        {#if node.sublabel}
          <span class="min-w-0 flex-1 truncate text-fg-subtle font-sans">
            {node.sublabel}
          </span>
        {:else}
          <span class="flex-1"></span>
        {/if}

        <span class="shrink-0 flex items-center gap-2 text-fg-subtle tabular-nums">
          {#if tokenText(node.tokens)}
            <span title="tokens in → out">{tokenText(node.tokens)}</span>
          {/if}
          {#if node.durationMs != null && node.durationMs > 0}
            <span class="text-fg-muted">{formatDuration(node.durationMs)}</span>
          {/if}
        </span>
      </button>
    {/each}
  </div>
{/if}
