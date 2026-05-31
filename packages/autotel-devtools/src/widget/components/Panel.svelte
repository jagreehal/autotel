<script lang="ts">
  /**
   * Expandable panel with tabs
   */

  import {
    X,
    Database,
    BarChart,
    AlertTriangle,
    Network,
    FileText,
    Sparkles,
    Workflow,
  } from '@lucide/svelte';
  import {
    widgetExpandedSignal,
    selectedTabSignal,
    popoverDimensionsSignal,
    totalErrorCountSignal,
    toggleWidget,
    setSelectedTab,
    setPopoverDimensions,
    genAiCountSignal,
    flowCountSignal,
  } from '../store.svelte';
  import { clamp } from '../utils';
  import { cn } from '../utils/cn';
  import TabView from './TabView.svelte';
  import ConnectionStatus from './ConnectionStatus.svelte';
  import type { TabType } from '../types';

  // Mutable, non-reactive bookkeeping (never rendered directly).
  let popoverEl: HTMLDivElement | undefined = $state();
  const isDragging = { current: false };
  const isResizing = { current: false };
  const dragStart = { current: { x: 0, y: 0 } };
  const positionRef = { current: { x: 100, y: 100 } };

  const expanded = $derived(widgetExpandedSignal.value);
  const selectedTab = $derived(selectedTabSignal.value);
  const dimensions = $derived(popoverDimensionsSignal.value);

  const totalErrors = $derived(totalErrorCountSignal.value);
  const genAiCount = $derived(genAiCountSignal.value);
  const flowCount = $derived(flowCountSignal.value);

  const tabs = $derived<
    Array<{ id: TabType; label: string; icon: typeof Database; badge?: number }>
  >([
    { id: 'traces', label: 'Traces', icon: Database },
    {
      id: 'genai',
      label: 'GenAI',
      icon: Sparkles,
      badge: genAiCount > 0 ? genAiCount : undefined,
    },
    {
      id: 'flow',
      label: 'Flow',
      icon: Workflow,
      badge: flowCount > 0 ? flowCount : undefined,
    },
    { id: 'service-map', label: 'Services', icon: Network },
    { id: 'metrics', label: 'Metrics', icon: BarChart },
    { id: 'logs', label: 'Logs', icon: FileText },
    {
      id: 'errors',
      label: 'Errors',
      icon: AlertTriangle,
      badge: totalErrors > 0 ? totalErrors : undefined,
    },
  ]);

  function handleHeaderPointerDown(e: PointerEvent) {
    const target = e.target as HTMLElement;
    if (target.closest('button')) return; // Don't drag when clicking buttons

    isDragging.current = true;
    const rect = popoverEl?.getBoundingClientRect();
    if (rect) {
      dragStart.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }
  }

  function handlePointerMove(e: PointerEvent) {
    if (isDragging.current) {
      const newX = clamp(
        e.clientX - dragStart.current.x,
        0,
        window.innerWidth - dimensions.width,
      );
      const newY = clamp(
        e.clientY - dragStart.current.y,
        0,
        window.innerHeight - dimensions.height,
      );

      positionRef.current = { x: newX, y: newY };
      if (popoverEl) {
        popoverEl.style.left = `${newX}px`;
        popoverEl.style.top = `${newY}px`;
      }
    }

    if (isResizing.current) {
      const newWidth = clamp(
        e.clientX - positionRef.current.x,
        400,
        window.innerWidth - positionRef.current.x,
      );
      const newHeight = clamp(
        e.clientY - positionRef.current.y,
        300,
        window.innerHeight - positionRef.current.y,
      );

      setPopoverDimensions(newWidth, newHeight);
    }
  }

  function handlePointerUp() {
    isDragging.current = false;
    isResizing.current = false;
  }

  function handleResizePointerDown(e: PointerEvent) {
    e.stopPropagation();
    isResizing.current = true;
  }

  $effect(() => {
    // Subscribe to `dimensions` so the handlers close over fresh values.
    void dimensions;
    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);

    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  });

  // Center panel on first open
  $effect(() => {
    if (expanded && popoverEl) {
      const x = (window.innerWidth - dimensions.width) / 2;
      const y = (window.innerHeight - dimensions.height) / 2;
      positionRef.current = { x, y };
      popoverEl.style.left = `${x}px`;
      popoverEl.style.top = `${y}px`;
    }
  });
</script>

{#if expanded}
  <!-- Backdrop overlay — a real <button> so it's natively click + keyboard
       dismissable. -->
  <button
    type="button"
    aria-label="Close panel"
    class={cn(
      'fixed inset-0 z-[999]',
      'bg-black/20 backdrop-blur-sm',
      'animate-fade-in',
    )}
    onclick={toggleWidget}
  ></button>

  <!-- Panel -->
  <div
    bind:this={popoverEl}
    class={cn(
      'fixed z-[1000]',
      'bg-surface border border-line rounded-lg',
      'shadow-2xl',
      'flex flex-col',
      'animate-fade-in',
    )}
    style="width: {dimensions.width}px; height: {dimensions.height}px; left: {positionRef
      .current.x}px; top: {positionRef.current.y}px;"
  >
    <!-- Close button in top-right corner -->
    <button
      onclick={toggleWidget}
      class={cn(
        'absolute top-2 right-2 z-10',
        'p-1.5 rounded-md',
        'bg-surface border border-line shadow-sm',
        'text-fg-subtle hover:text-fg-muted hover:bg-subtle',
        'transition-colors',
      )}
      title="Close"
    >
      <X size={16} />
    </button>

    <!-- Header — pointer drag handle for repositioning the panel. Pointer-only
         by nature; there is no keyboard equivalent for free-form drag. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class={cn(
        'flex items-center px-4 pt-3 pb-0',
        'border-b border-line',
        'cursor-grab',
      )}
      onpointerdown={handleHeaderPointerDown}
    >
      <div class="flex gap-6">
        {#each tabs as tab (tab.id)}
          {@const Icon = tab.icon}
          {@const isActive = selectedTab === tab.id}
          <button
            onclick={() => setSelectedTab(tab.id)}
            class={cn(
              'text-sm font-medium pb-3 transition-colors relative cursor-pointer',
              'flex items-center gap-2',
              isActive ? 'text-fg' : 'text-fg-subtle hover:text-fg-muted',
            )}
          >
            <Icon
              size={16}
              class={tab.id === 'errors' && tab.badge
                ? 'text-red-500'
                : undefined}
            />
            {tab.label}
            {#if tab.badge}
              <span
                class={cn(
                  'px-1.5 py-0.5 text-xs font-medium rounded-full',
                  tab.id === 'errors'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-hover text-fg-muted',
                )}
              >
                {tab.badge > 99 ? '99+' : tab.badge}
              </span>
            {/if}
            {#if isActive}
              <div
                class="absolute bottom-0 left-0 right-0 h-0.5 bg-zinc-900"
              ></div>
            {/if}
          </button>
        {/each}
      </div>
      <div class="ml-auto pb-3">
        <ConnectionStatus compact />
      </div>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto">
      <TabView />
    </div>

    <!-- Resize handle -->
    <!-- Corner resize handle — pointer-drag only, no keyboard equivalent. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class={cn(
        'absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize',
        'touch-none select-none',
      )}
      onpointerdown={handleResizePointerDown}
    >
      <div
        class="absolute bottom-1 right-1 w-3 h-3 border-r-2 border-b-2 border-line"
      ></div>
    </div>
  </div>
{/if}
