<script lang="ts">
  import { ChevronRight, ChevronDown } from '@lucide/svelte';
  import { cn } from '../utils/cn';
  import Self from './JsonNode.svelte';

  /** Collapsible JSON tree node for object/array attribute values. Theme-token styled. */

  interface Props {
    label?: string;
    value: unknown;
    depth: number;
  }
  let { label, value, depth }: Props = $props();

  function leafClass(v: unknown): string {
    if (v === null) return 'text-fg-subtle';
    switch (typeof v) {
      case 'string':
        return 'text-green-700';
      case 'number':
        return 'text-blue-700';
      case 'boolean':
        return 'text-purple-700';
      default:
        return 'text-fg';
    }
  }

  function leafText(v: unknown): string {
    if (v === null) return 'null';
    if (typeof v === 'string') return `"${v}"`;
    return String(v);
  }

  const isContainer = $derived(value !== null && typeof value === 'object');
  // Top two levels expanded by default; deeper nesting starts collapsed.
  // `depth` is a fixed-per-node prop; reading it for the initial value only is
  // intentional (no reactivity wanted here).
  // svelte-ignore state_referenced_locally
  let open = $state(depth < 2);

  const isArray = $derived(Array.isArray(value));
  const entries = $derived.by(() =>
    isArray
      ? (value as unknown[]).map((v, i) => [String(i), v] as const)
      : Object.entries(value as Record<string, unknown>),
  );
  const openBrace = $derived(isArray ? '[' : '{');
  const closeBrace = $derived(isArray ? ']' : '}');
  const summary = $derived(`${entries.length} ${isArray ? 'items' : 'keys'}`);
</script>

{#if !isContainer}
  <div class="flex gap-1 leading-5">
    {#if label !== undefined}
      <span class="text-fg-subtle">{label}:</span>
    {/if}
    <span class={cn('break-all', leafClass(value))}>
      {leafText(value)}
    </span>
  </div>
{:else}
  <div class="leading-5">
    <button
      onclick={() => (open = !open)}
      class="inline-flex items-center gap-1 hover:bg-hover rounded px-0.5"
    >
      {#if open}
        <ChevronDown size={10} />
      {:else}
        <ChevronRight size={10} />
      {/if}
      {#if label !== undefined}
        <span class="text-fg-subtle">{label}:</span>
      {/if}
      <span class="text-fg-subtle">
        {open ? openBrace : `${openBrace}…${closeBrace}`}
      </span>
      {#if !open}
        <span class="text-fg-subtle opacity-70">{summary}</span>
      {/if}
    </button>
    {#if open}
      <div class="pl-3 ml-1 border-l border-line-subtle">
        {#each entries as [k, v] (k)}
          <Self label={k} value={v} depth={depth + 1} />
        {/each}
        <div class="text-fg-subtle">{closeBrace}</div>
      </div>
    {/if}
  </div>
{/if}
