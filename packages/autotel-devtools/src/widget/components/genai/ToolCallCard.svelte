<script lang="ts">
  import { Wrench, ChevronRight } from '@lucide/svelte';
  import { cn } from '../../utils/cn';
  import type { GenAiToolCall } from '../../genai/types';

  interface Props {
    call: GenAiToolCall;
  }
  let { call }: Props = $props();

  let open = $state(false);

  function formatToolParams(args: unknown): string {
    if (args == null || typeof args !== 'object' || Array.isArray(args))
      return '';
    const entries = Object.entries(args as Record<string, unknown>);
    if (entries.length === 0) return '';
    return entries
      .slice(0, 3)
      .map(([k, v]) => {
        const val =
          typeof v === 'string'
            ? `"${v.length > 20 ? v.slice(0, 20) + '…' : v}"`
            : v === null
              ? 'null'
              : typeof v === 'object'
                ? '…'
                : String(v);
        return `${k}: ${val}`;
      })
      .join(', ');
  }

  const args = $derived(
    typeof call.arguments === 'string'
      ? (() => {
          try {
            return JSON.parse(call.arguments);
          } catch {
            return call.arguments;
          }
        })()
      : call.arguments,
  );
  const result = $derived(call.result);
  const paramSummary = $derived(formatToolParams(args));
</script>

<div class="mt-2 border border-violet-200 rounded-md overflow-hidden">
  <button
    type="button"
    onclick={() => (open = !open)}
    class={cn(
      'w-full px-2.5 py-1.5 flex items-center gap-1.5 text-left',
      'text-xs bg-violet-50 hover:bg-violet-100/70 transition-colors',
    )}
  >
    <ChevronRight
      size={12}
      class={cn(
        'text-violet-600 transition-transform shrink-0',
        open && 'rotate-90',
      )}
    />
    <Wrench size={12} class="text-violet-600 shrink-0" />
    <span class="font-mono font-medium text-violet-900">{call.name}</span>
    {#if !open && paramSummary}
      <span class="font-mono text-[11px] text-violet-700/70 truncate">
        ({paramSummary})
      </span>
    {/if}
    {#if !open && result === undefined}
      <span class="ml-auto text-[10px] uppercase tracking-wide text-fg-subtle">
        no result
      </span>
    {/if}
  </button>
  {#if open}
    <div class="px-3 py-2 border-t border-violet-200/60 bg-surface">
      <div
        class="text-[10px] font-medium uppercase tracking-wider text-fg-subtle mb-1"
      >
        Input
      </div>
      <pre
        class="text-xs bg-subtle border border-line text-fg p-2 rounded overflow-x-auto">{JSON.stringify(
          args,
          null,
          2,
        )}</pre>
    </div>
    {#if result !== undefined}
      <div class="px-3 py-2 border-t border-emerald-200/60 bg-emerald-50/40">
        <div
          class="text-[10px] font-medium uppercase tracking-wider text-emerald-700 mb-1"
        >
          Output
        </div>
        <pre
          class="text-xs bg-surface border border-emerald-200 text-fg p-2 rounded overflow-x-auto">{JSON.stringify(
            result,
            null,
            2,
          )}</pre>
      </div>
    {/if}
    {#if call.id}
      <div
        class="px-3 py-1.5 border-t border-line-subtle bg-subtle/60 text-[10px] font-mono text-fg-subtle"
      >
        id: {call.id}
      </div>
    {/if}
  {/if}
</div>
