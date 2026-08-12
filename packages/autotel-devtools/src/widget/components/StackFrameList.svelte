<script lang="ts">
  // A parsed stack trace, ordered innermost-first as V8 emits it.
  //
  // The point of this list is to get the reader to *their* code. Dependency and
  // runtime frames are kept — dropping them would hide how the call arrived —
  // but only app frames are actionable, because they are the only ones with a
  // file on disk inside the project that we can show.
  import type { StackFrame, StackFrameKind } from '../../server/parse-stack';
  import { cn } from '../utils/cn';

  interface Props {
    frames: StackFrame[];
    /** Frame currently shown in the source peek, if any. */
    selected?: StackFrame | null;
    onselect?: (frame: StackFrame) => void;
  }

  let { frames, selected = null, onselect }: Props = $props();

  const NON_APP_LABEL: Record<Exclude<StackFrameKind, 'app'>, string> = {
    dependency: 'node_modules',
    native: 'runtime',
  };

  function position(frame: StackFrame): string {
    return `${frame.file}:${frame.line}:${frame.column}`;
  }

  function isSelected(frame: StackFrame): boolean {
    return (
      selected !== null &&
      selected.file === frame.file &&
      selected.line === frame.line &&
      selected.column === frame.column
    );
  }
</script>

{#if frames.length === 0}
  <p class="p-3 text-xs text-fg-muted">No stack frames on this error.</p>
{:else}
  <ol class="divide-y divide-line-subtle">
    {#each frames as frame, i (i)}
      {@const label = frame.kind === 'app' ? null : NON_APP_LABEL[frame.kind]}
      <li>
        {#if frame.kind === 'app'}
          <button
            type="button"
            onclick={() => onselect?.(frame)}
            class={cn(
              'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left transition-colors hover:bg-hover',
              isSelected(frame) && 'bg-subtle border-l-2 border-accent',
            )}
          >
            <span class="font-mono text-xs text-fg">
              {frame.function ?? '(anonymous)'}
            </span>
            <span class="font-mono text-[11px] text-fg-subtle">
              {position(frame)}
            </span>
          </button>
        {:else}
          <div class="flex flex-col items-start gap-0.5 px-3 py-2">
            <span class="flex items-center gap-2">
              <span class="font-mono text-xs text-fg-muted">
                {frame.function ?? '(anonymous)'}
              </span>
              <span
                class="rounded bg-subtle px-1.5 py-0.5 text-[10px] text-fg-subtle"
              >
                {label}
              </span>
            </span>
            <span class="font-mono text-[11px] text-fg-muted">
              {position(frame)}
            </span>
          </div>
        {/if}
      </li>
    {/each}
  </ol>
{/if}
