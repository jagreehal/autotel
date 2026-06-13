<script lang="ts">
  import {
    Play,
    Pause,
    ChevronLeft,
    ChevronRight,
    X,
    Cpu,
    Wrench,
    Bot,
    ArrowRight,
  } from '@lucide/svelte';
  import type { NarrationStep } from '../../genai/narration';
  import { cn } from '../../utils/cn';

  interface Props {
    steps: NarrationStep[];
    /** Current step (bindable so the parent can sync span selection). */
    index: number;
    onClose: () => void;
  }
  let { steps, index = $bindable(), onClose }: Props = $props();

  let auto = $state(false);
  const AUTO_MS = 2600;

  const step = $derived(steps[index]);
  const atStart = $derived(index <= 0);
  const atEnd = $derived(index >= steps.length - 1);
  const progressPct = $derived(
    steps.length > 1 ? ((index + 1) / steps.length) * 100 : 100,
  );

  function next() {
    if (!atEnd) index += 1;
  }
  function prev() {
    if (!atStart) index -= 1;
  }
  function toggleAuto() {
    auto = !auto;
  }

  // Auto-advance: tick while playing; stop at the end. Re-runs when `auto`
  // flips. Cleanup clears the pending timer on unmount or re-run.
  $effect(() => {
    if (!auto) return;
    if (atEnd) {
      auto = false;
      return;
    }
    const id = setTimeout(() => {
      index += 1;
    }, AUTO_MS);
    return () => clearTimeout(id);
  });

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'ArrowRight' || e.key === ' ') {
      e.preventDefault();
      next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      prev();
    } else if (e.key === 'Escape') {
      onClose();
    }
  }

  // Role → accent + icon, so each step reads at a glance.
  const ROLE_STYLE: Record<
    string,
    { icon: typeof Cpu; dot: string; chip: string }
  > = {
    Agent: {
      icon: Bot,
      dot: 'bg-violet-500',
      chip: 'text-violet-600 bg-violet-500/10',
    },
    Handoff: {
      icon: ArrowRight,
      dot: 'bg-violet-500',
      chip: 'text-violet-600 bg-violet-500/10',
    },
    Tool: {
      icon: Wrench,
      dot: 'bg-amber-500',
      chip: 'text-amber-600 bg-amber-500/10',
    },
  };
  function roleStyle(role: string) {
    if (role.startsWith('Model'))
      return {
        icon: Cpu,
        dot: 'bg-emerald-500',
        chip: 'text-emerald-600 bg-emerald-500/10',
      };
    return (
      ROLE_STYLE[role] ?? {
        icon: Cpu,
        dot: 'bg-accent',
        chip: 'text-fg-muted bg-hover',
      }
    );
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if step}
  {@const rs = roleStyle(step.role)}
  {@const Icon = rs.icon}
  <div
    class="border-b border-line bg-surface shadow-sm"
    role="region"
    aria-label="Guided tour"
  >
    <!-- progress -->
    <div class="h-0.5 bg-line">
      <div
        class="h-full bg-accent transition-all duration-300"
        style="width: {progressPct}%"
      ></div>
    </div>

    <div class="flex items-start gap-3 px-3 py-2.5">
      <div class="flex items-center gap-2 shrink-0 pt-0.5">
        <span class={cn('w-2 h-2 rounded-full', rs.dot)}></span>
        <span
          class={cn(
            'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide',
            rs.chip,
          )}
        >
          <Icon size={11} />
          {step.role}
        </span>
      </div>

      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold text-fg leading-tight">
          {step.title}
        </div>
        <p class="mt-0.5 text-xs text-fg-muted leading-relaxed">
          {step.explain}
        </p>
      </div>

      <div class="flex items-center gap-1 shrink-0">
        <span class="text-[11px] text-fg-subtle tabular-nums mr-1">
          {index + 1} / {steps.length}
        </span>
        <button
          type="button"
          onclick={prev}
          disabled={atStart}
          class="p-1 rounded text-fg-subtle hover:text-fg hover:bg-hover disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          aria-label="Previous step"
          title="Previous (←)"
        >
          <ChevronLeft size={15} />
        </button>
        <button
          type="button"
          onclick={toggleAuto}
          class={cn(
            'p-1 rounded transition-colors',
            auto
              ? 'text-accent bg-accent/10'
              : 'text-fg-subtle hover:text-fg hover:bg-hover',
          )}
          aria-label={auto ? 'Pause auto-play' : 'Play tour'}
          title={auto ? 'Pause' : 'Auto-play'}
        >
          {#if auto}
            <Pause size={15} />
          {:else}
            <Play size={15} />
          {/if}
        </button>
        <button
          type="button"
          onclick={next}
          disabled={atEnd}
          class="p-1 rounded text-fg-subtle hover:text-fg hover:bg-hover disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
          aria-label="Next step"
          title="Next (→ or Space)"
        >
          <ChevronRight size={15} />
        </button>
        <button
          type="button"
          onclick={onClose}
          class="p-1 ml-1 rounded text-fg-subtle hover:text-fg hover:bg-hover transition-colors"
          aria-label="Exit tour"
          title="Exit (Esc)"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  </div>
{/if}
