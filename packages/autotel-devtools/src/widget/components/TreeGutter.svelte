<script lang="ts">
  /**
   * Connector lines joining a waterfall row to its parent.
   *
   * Indentation alone stops being readable past two or three levels: in a deep
   * trace you can see that a span is further right than the one above it, but
   * not which parent it belongs to. These lines answer that.
   *
   * Drawn with bordered divs rather than SVG so they inherit the row's height
   * without measuring it, and so a resizing pane needs no re-layout pass.
   *
   * Decorative: the tree structure is already conveyed by the row's
   * `aria-level`, so this is hidden from assistive tech rather than repeated
   * as a wall of meaningless nodes.
   */
  import { cn } from '../utils/cn';

  interface Props {
    /** One entry per ancestor level, outermost first; true = line continues. */
    ancestorLines: boolean[];
    /** Whether this row is its parent's last child — elbow rather than tee. */
    isLast: boolean;
    /** Width of one indent level, in pixels. */
    indent?: number;
    class?: string;
  }
  let {
    ancestorLines,
    isLast,
    indent = 16,
    class: className,
  }: Props = $props();
</script>

<span
  class={cn('flex shrink-0 self-stretch', className)}
  aria-hidden="true"
  data-testid="tree-gutter"
>
  {#each ancestorLines as continues, level (level)}
    <span
      class="relative shrink-0"
      style="width:{indent}px"
      data-testid={continues ? 'gutter-line' : 'gutter-blank'}
    >
      {#if continues}
        <span
          class="absolute inset-y-0 border-l border-line"
          style="left:{indent / 2}px"
        ></span>
      {/if}
    </span>
  {/each}

  {#if ancestorLines.length > 0 || !isLast}
    <!-- The joint itself: a vertical stub down to the row's midpoint plus a
         horizontal arm. A last child stops at the midpoint (an elbow); any
         other child continues past it to reach the sibling below (a tee). -->
    <span
      class="relative shrink-0"
      style="width:{indent}px"
      data-testid={isLast ? 'gutter-elbow' : 'gutter-tee'}
    >
      <span
        class={cn(
          'absolute top-0 border-l border-line',
          isLast ? 'h-1/2' : 'inset-y-0',
        )}
        style="left:{indent / 2}px"
      ></span>
      <span
        class="absolute top-1/2 border-t border-line"
        style="left:{indent / 2}px; width:{indent / 2}px"
      ></span>
    </span>
  {/if}
</span>
