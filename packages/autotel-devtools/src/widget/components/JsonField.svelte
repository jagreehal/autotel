<script lang="ts" module>
  /** Pretty-print a captured value: strings as-is, everything else as JSON. */
  export function prettyJson(value: unknown): string {
    if (value === undefined) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
</script>

<script lang="ts">
  import { cn } from '../utils/cn';

  // The shared input/output atom: a labelled `<pre>` of JSON. Used by both the
  // Flow detail panel and the GenAI ToolCallCard so functions and AI tool calls
  // render their I/O identically. Callers own the surrounding section chrome.
  interface Props {
    label: string;
    value: unknown;
    tone?: 'neutral' | 'positive';
  }
  let { label, value, tone = 'neutral' }: Props = $props();
</script>

<div
  class={cn(
    'text-[10px] font-medium uppercase tracking-wider mb-1',
    tone === 'positive' ? 'text-emerald-700' : 'text-fg-subtle',
  )}
>
  {label}
</div>
<pre
  class={cn(
    'text-xs p-2 rounded overflow-x-auto whitespace-pre-wrap',
    tone === 'positive'
      ? 'bg-surface border border-emerald-200 text-fg'
      : 'bg-subtle border border-line text-fg',
  )}>{prettyJson(value)}</pre>
