<script lang="ts">
  // Floating draggable bubble button
  import Logo from './Logo.svelte';
  import {
    widgetExpandedSignal,
    widgetPositionSignal,
    unseenFailuresSignal,
    toggleWidget,
    setWidgetPosition,
    setWidgetCorner,
  } from '../store.svelte';
  import { snapToCorner, clamp } from '../utils';
  import { cn } from '../utils/cn';

  let bubbleEl: HTMLButtonElement | undefined = $state();
  // Mutable, non-reactive drag bookkeeping (never rendered).
  let isDragging = false;
  let dragStart = { x: 0, y: 0 };

  const position = $derived(widgetPositionSignal.value);
  const unseenFailures = $derived(unseenFailuresSignal.value);
  const expanded = $derived(widgetExpandedSignal.value);

  const hasErrors = $derived(unseenFailures > 0);
  // red for errors, green for success
  const ringColor = $derived(hasErrors ? '#DA2F47' : '#22c55e');

  function handlePointerDown(e: PointerEvent) {
    if (e.button !== 0) return; // Only left click
    isDragging = true;
    dragStart = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
    bubbleEl?.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isDragging) return;
    const newX = clamp(e.clientX - dragStart.x, 0, window.innerWidth - 48);
    const newY = clamp(e.clientY - dragStart.y, 0, window.innerHeight - 48);
    setWidgetPosition(newX, newY);
  }

  function handlePointerUp(e: PointerEvent) {
    if (!isDragging) return;
    isDragging = false;
    bubbleEl?.releasePointerCapture(e.pointerId);
    const snapped = snapToCorner(
      position.x,
      position.y,
      window.innerWidth,
      window.innerHeight,
    );
    setWidgetPosition(snapped.x, snapped.y);
    setWidgetCorner(snapped.corner);
  }

  function handleClick() {
    if (!isDragging) toggleWidget();
  }
</script>

{#if !expanded}
  <button
    bind:this={bubbleEl}
    onclick={handleClick}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    class={cn(
      'fixed z-[1000] rounded-full border-2 shadow-md',
      'flex items-center justify-center cursor-pointer touch-none',
      'transition-all duration-150 select-none',
      'hover:shadow-lg',
      'bg-surface hover:bg-subtle',
    )}
    style="width: 48px; height: 48px; left: {position.x}px; top: {position.y}px; transform: translate3d(0, 0, 0); border-color: {ringColor};"
    title="Autolemetry Observability"
  >
    <Logo fill={hasErrors ? '#fff' : undefined} width={28} height={28} />
  </button>
{/if}
