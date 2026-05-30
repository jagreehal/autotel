<script lang="ts">
  import { Search, X, ChevronUp, ChevronDown } from '@lucide/svelte';
  import type { SpanData } from '../types';

  interface Props {
    spans: SpanData[];
    onMatchesChange: (matchedSpanIds: Set<string>) => void;
    onCurrentMatchChange: (spanId: string | null) => void;
    debounceMs?: number;
  }
  let {
    spans,
    onMatchesChange,
    onCurrentMatchChange,
    debounceMs = 300,
  }: Props = $props();

  function searchSpan(span: SpanData, query: string): boolean {
    const q = query.toLowerCase();
    if (span.spanId.toLowerCase().includes(q)) return true;
    if (span.name.toLowerCase().includes(q)) return true;
    if (span.kind.toLowerCase().includes(q)) return true;
    for (const [key, val] of Object.entries(span.attributes)) {
      if (key.toLowerCase().includes(q)) return true;
      if (String(val).toLowerCase().includes(q)) return true;
    }
    if (span.status.message && span.status.message.toLowerCase().includes(q))
      return true;
    if (span.events) {
      for (const event of span.events) {
        if (event.name.toLowerCase().includes(q)) return true;
        if (event.attributes) {
          for (const [ek, ev] of Object.entries(event.attributes)) {
            if (ek.toLowerCase().includes(q)) return true;
            if (String(ev).toLowerCase().includes(q)) return true;
          }
        }
      }
    }
    return false;
  }

  let query = $state('');
  let matches = $state<string[]>([]);
  let currentIdx = $state(0);
  // Mutable, non-reactive debounce bookkeeping (never rendered).
  const debounceTimer: { current: number | null } = { current: null };

  $effect(() => {
    // Track reactive deps for the debounce effect.
    const q = query;
    const currentSpans = spans;
    const ms = debounceMs;

    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current);
    }

    if (!q.trim()) {
      matches = [];
      onMatchesChange(new Set());
      onCurrentMatchChange(null);
      return;
    }

    debounceTimer.current = window.setTimeout(() => {
      const matched = currentSpans
        .filter((s) => searchSpan(s, q))
        .map((s) => s.spanId);
      matches = matched;
      currentIdx = 0;
      onMatchesChange(new Set(matched));
      onCurrentMatchChange(matched[0] || null);
    }, ms);

    return () => {
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current);
      }
    };
  });

  function goNext() {
    if (matches.length === 0) return;
    const next = (currentIdx + 1) % matches.length;
    currentIdx = next;
    onCurrentMatchChange(matches[next]);
  }

  function goPrev() {
    if (matches.length === 0) return;
    const prev = (currentIdx - 1 + matches.length) % matches.length;
    currentIdx = prev;
    onCurrentMatchChange(matches[prev]);
  }
</script>

<div class="flex items-center gap-2 px-3 py-2 border-b border-line bg-subtle">
  <Search size={14} class="text-fg-subtle" />
  <input
    type="text"
    value={query}
    oninput={(e) => (query = (e.target as HTMLInputElement).value)}
    placeholder="Search spans... (press /)"
    class="flex-1 text-xs bg-transparent outline-none text-fg-muted placeholder-gray-400"
  />
  {#if query}
    <span class="text-xs text-fg-subtle">
      {matches.length > 0
        ? `${currentIdx + 1}/${matches.length}`
        : 'No matches'}
    </span>
    <button
      onclick={goPrev}
      class="p-0.5 hover:bg-hover rounded"
      title="Previous (N)"
    >
      <ChevronUp size={12} />
    </button>
    <button
      onclick={goNext}
      class="p-0.5 hover:bg-hover rounded"
      title="Next (n)"
    >
      <ChevronDown size={12} />
    </button>
    <button onclick={() => (query = '')} class="p-0.5 hover:bg-hover rounded">
      <X size={12} />
    </button>
  {/if}
</div>
