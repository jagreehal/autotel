<script lang="ts">
  /**
   * Radial gauge showing how full the prompt is relative to the model's context
   * window — `used / total` tokens as a percentage arc. In the GenAI view the
   * arc fills and shifts green → amber → red as the prompt approaches the budget.
   *
   * Tailwind-only (no <style>): the arc uses `stroke="currentColor"` and colour
   * comes from a level class, so it inherits the widget's shadow-DOM theme.
   */
  import { cn } from '../../utils/cn';

  interface Props {
    /** Tokens consumed by the request (typically the prompt / input tokens). */
    used: number;
    /** Total context-window size for the model, in tokens. */
    total: number;
    /** Diameter in px. */
    size?: number;
  }
  let { used, total, size = 30 }: Props = $props();

  const fraction = $derived(total > 0 ? Math.min(used / total, 1) : 0);
  const pct = $derived(Math.round(fraction * 100));

  // Colour by how full the window is: comfortable → tight → nearly full.
  const level = $derived(
    fraction >= 0.9
      ? { arc: 'text-danger', label: 'text-danger' }
      : fraction >= 0.7
        ? { arc: 'text-warning', label: 'text-warning' }
        : { arc: 'text-success', label: 'text-fg-muted' },
  );

  const stroke = 3;
  const radius = $derived((size - stroke) / 2);
  const circumference = $derived(2 * Math.PI * radius);
  const dashOffset = $derived(circumference * (1 - fraction));

  const tokenLabel = $derived(
    `${used.toLocaleString()} / ${total.toLocaleString()} tokens · ${pct}% of context window`,
  );
</script>

<span
  class="inline-flex items-center gap-1.5"
  title={tokenLabel}
  aria-label={tokenLabel}
>
  <svg
    width={size}
    height={size}
    viewBox={`0 0 ${size} ${size}`}
    class="flex-shrink-0 -rotate-90"
    role="img"
  >
    <!-- Track -->
    <circle
      cx={size / 2}
      cy={size / 2}
      r={radius}
      fill="none"
      stroke="currentColor"
      stroke-width={stroke}
      class="text-line"
    />
    <!-- Fill arc -->
    <circle
      cx={size / 2}
      cy={size / 2}
      r={radius}
      fill="none"
      stroke="currentColor"
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-dasharray={circumference}
      stroke-dashoffset={dashOffset}
      class={cn('transition-all duration-300', level.arc)}
    />
  </svg>
  <span class={cn('font-mono text-[11px] tabular-nums', level.label)}>
    {pct}%
  </span>
</span>
