<script lang="ts">
  // The visible draggable splitter for resizing a docked side panel. The resize
  // behavior lives in `useResizable` (see `resizable.svelte.ts`), which
  // returns `separatorProps` that callers spread onto this component. Those props
  // (role / aria / tabIndex + pointer / keyboard / double-click handlers) are
  // wired straight onto the handle node here, matching the original Preact
  // `ResizeHandle` byte-for-byte.
  import { cn } from '../utils/cn';
  import type { SeparatorProps } from './resizable.svelte';

  interface Props extends Partial<SeparatorProps> {
    dragging: boolean;
    title?: string;
  }

  let {
    dragging,
    title,
    role,
    'aria-orientation': ariaOrientation,
    'aria-valuenow': ariaValueNow,
    'aria-valuemin': ariaValueMin,
    tabIndex,
    onPointerDown,
    onKeyDown,
    onDblClick,
  }: Props = $props();
</script>

<!-- Focusable separator (window-splitter pattern): role="separator" with
     aria-valuenow + a keyboard handler for arrow-key resize, so a 0 tabindex is
     correct here despite the rule treating separators as non-interactive. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  {role}
  aria-orientation={ariaOrientation}
  aria-valuenow={ariaValueNow}
  aria-valuemin={ariaValueMin}
  tabindex={tabIndex}
  onpointerdown={onPointerDown}
  onkeydown={onKeyDown}
  ondblclick={onDblClick}
  title={title ?? 'Drag to resize · double-click to reset'}
  class={cn(
    'group relative z-10 shrink-0 cursor-col-resize self-stretch outline-none',
    'w-px bg-hover',
  )}
>
  <!-- Wide invisible hit area so the 1px line is easy to grab. -->
  <div class="absolute inset-y-0 -left-1.5 -right-1.5"></div>
  <!-- Visible grip on hover / drag / keyboard focus. -->
  <div
    class={cn(
      'absolute inset-y-0 -left-px w-0.5 transition-colors',
      'group-hover:bg-accent group-focus-visible:bg-accent',
      dragging && 'bg-accent',
    )}
  ></div>
</div>
