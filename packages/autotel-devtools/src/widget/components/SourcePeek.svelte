<script lang="ts">
  // The few lines of source around a stack frame.
  //
  // Line numbers come from the window, not from the array index: the whole
  // point is that they match the file on disk, so `startLine` drives them.
  import type { SourceWindow } from '../../server/source-file';
  import { cn } from '../utils/cn';

  interface Props {
    /** `null` when the path escaped the project root or the file was unreadable. */
    window: SourceWindow | null;
    /** Absent when the host cannot deep-link to an editor. */
    onopen?: (window: SourceWindow) => void;
  }

  let { window: sourceWindow, onopen }: Props = $props();
</script>

{#if sourceWindow === null}
  <p class="p-3 text-xs text-fg-muted">
    This file could not be read. It may be outside the project, or generated
    rather than written.
  </p>
{:else}
  <div class="flex flex-col">
    <div
      class="flex items-center justify-between border-b border-line px-3 py-1.5"
    >
      <span class="font-mono text-[11px] text-fg-subtle"
        >{sourceWindow.file}:{sourceWindow.line}</span
      >
      {#if onopen}
        <button
          type="button"
          onclick={() => onopen?.(sourceWindow)}
          class="rounded px-1.5 py-0.5 text-[11px] text-accent hover:bg-hover"
        >
          Open in editor
        </button>
      {/if}
    </div>

    <!-- A table would imply tabular data; this is a numbered listing, so the
         numbers are presentational and marked aria-hidden. -->
    <ol class="overflow-x-auto py-1">
      {#each sourceWindow.lines as text, i (i)}
        {@const lineNumber = sourceWindow.startLine + i}
        {@const isTarget = lineNumber === sourceWindow.line}
        <li
          aria-current={isTarget ? 'true' : undefined}
          class={cn(
            'flex gap-3 px-3 font-mono text-[11px] leading-5',
            isTarget ? 'bg-danger-bg text-fg' : 'text-fg-muted',
          )}
        >
          <span class="w-8 shrink-0 select-none text-right text-fg-subtle">
            {lineNumber}
          </span>
          <!-- `whitespace-pre` keeps indentation; without it the browser
               collapses the leading spaces and the code stops lining up. -->
          <span class="whitespace-pre">{text}</span>
        </li>
      {/each}
    </ol>
  </div>
{/if}
