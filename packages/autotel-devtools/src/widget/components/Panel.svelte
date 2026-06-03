<script lang="ts">
  /**
   * Docked devtools panel.
   *
   * Non-blocking, edge-docked surface modelled on the TanStack Query devtools:
   * it pins to one edge of the viewport (bottom by default), spans the full
   * cross-axis, and leaves the rest of the host page fully interactive — there
   * is no backdrop and the panel never traps pointer events outside its own
   * box. The user drags the inner edge to resize along the dock axis; that size
   * is the only dimension they control and it is persisted. Opening a trace
   * renders the detail inside the panel (master/detail) rather than resizing it.
   */

  import {
    X,
    PanelBottom,
    PanelRight,
    PanelLeft,
    PictureInPicture2,
    Minimize2,
    GripHorizontal,
    HelpCircle,
  } from '@lucide/svelte';
  import { cubicOut } from 'svelte/easing';
  import {
    widgetExpandedSignal,
    selectedTabSignal,
    widgetDockedSignal,
    panelSizeSignal,
    pipActiveSignal,
    totalErrorCountSignal,
    toggleWidget,
    setSelectedTab,
    setPanelSize,
    resetPanelSize,
    panelSizeBounds,
    setWidgetDocked,
    cycleDock,
    genAiCountSignal,
    flowCountSignal,
  } from '../store.svelte';
  import { isPipSupported, openPip, closePip } from '../pip';
  import { TAB_DEFS } from '../tabs';
  import { usePanelResize } from './panelResize.svelte';
  import { useDockDrag } from './dockDrag.svelte';
  import { cn } from '../utils/cn';
  import { isInputFocused } from '../utils/keyboard';
  import {
    helpShortcutsSignal,
    closeHelp,
    toggleHelp,
    selectedTraceIdSignal,
  } from '../store.svelte';
  import {
    GLOBAL_SHORTCUTS,
    TRACE_LIST_SHORTCUTS,
    TRACE_DETAIL_SHORTCUTS,
  } from '../shortcuts';
  import TabView from './TabView.svelte';
  import ConnectionStatus from './ConnectionStatus.svelte';
  import KeyboardShortcutsHelp from './KeyboardShortcutsHelp.svelte';
  import Logo from './Logo.svelte';
  import type { TabType } from '../types';
  import type { DockPosition } from '../types';

  type Dock = Exclude<DockPosition, null>;

  let panelEl: HTMLElement | undefined = $state();

  const expanded = $derived(widgetExpandedSignal.value);
  const selectedTab = $derived(selectedTabSignal.value);
  const dock = $derived((widgetDockedSignal.value ?? 'bottom') as Dock);
  const panelSize = $derived(panelSizeSignal.value);
  const pipActive = $derived(pipActiveSignal.value);
  const pipSupported = isPipSupported();

  // Whether the dock axis is vertical (top/bottom → height) or horizontal
  // (left/right → width). This drives sizing, the resize handle, and which edge
  // gets the divider border.
  const isVertical = $derived(dock === 'bottom' || dock === 'top');
  const axisSize = $derived(
    isVertical ? panelSize.vertical : panelSize.horizontal,
  );
  // Min/max for the resize handle's ARIA value semantics.
  const sizeBounds = $derived(
    panelSizeBounds(isVertical ? 'vertical' : 'horizontal'),
  );

  const totalErrors = $derived(totalErrorCountSignal.value);
  const genAiCount = $derived(genAiCountSignal.value);
  const flowCount = $derived(flowCountSignal.value);

  // Live count badges by tab id; ids without a badge are simply absent.
  const tabBadges = $derived<Partial<Record<TabType, number>>>({
    genai: genAiCount > 0 ? genAiCount : undefined,
    flow: flowCount > 0 ? flowCount : undefined,
    errors: totalErrors > 0 ? totalErrors : undefined,
  });
  // Tabs come from the shared TAB_DEFS — same set + order as the full-page UI,
  // so the two surfaces can't drift. We only layer the count badges on here.
  const tabs = $derived(
    TAB_DEFS.map((def) => ({ ...def, badge: tabBadges[def.id] })),
  );

  // ─── Resize: drag the inner edge along the dock axis ───
  const resize = usePanelResize({
    isVertical: () => isVertical,
    dock: () => dock,
    axisSize: () => axisSize,
    setSize: setPanelSize,
    resetSize: resetPanelSize,
  });

  // ─── Drag-to-dock: grab the header, drop on an edge to re-dock ───
  const dockDrag = useDockDrag({
    dock: () => dock,
    pipActive: () => pipActive,
    onDock: setWidgetDocked,
  });

  // ─── Picture-in-Picture pop-out ───
  async function togglePip() {
    if (pipActive) {
      closePip(() => (pipActiveSignal.value = false));
      return;
    }
    const root = panelEl?.getRootNode();
    const host = root instanceof ShadowRoot ? (root.host as HTMLElement) : null;
    if (!host) return;
    const opened = await openPip(host, () => (pipActiveSignal.value = false), {
      width: 760,
      height: 600,
    });
    if (opened) pipActiveSignal.value = true;
  }

  // ─── Open/close motion: slide from (and back to) the docked edge ───
  const reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function dockSlide(_node: Element, { dock: d }: { dock: Dock }) {
    if (reduceMotion || pipActive) return { duration: 0 };
    const axis = d === 'left' || d === 'right' ? 'X' : 'Y';
    const sign = d === 'bottom' || d === 'right' ? 1 : -1;
    return {
      duration: 240,
      easing: cubicOut,
      css: (_t: number, u: number) =>
        `transform: translate${axis}(${u * sign * 100}%)`,
    };
  }

  // ─── Keyboard shortcuts ───
  // Scoped to the widget's shadow root (or the PiP window) rather than the host
  // `window`, so number keys / Esc / ? only act when the user is actually
  // interacting with the devtools — pressing Escape in the host app never
  // closes our panel out from under them.
  const TABS_ORDER: TabType[] = [
    'traces',
    'genai',
    'flow',
    'service-map',
    'metrics',
    'logs',
    'errors',
  ];
  const helpShortcuts = $derived(helpShortcutsSignal.value);

  function contextShortcuts() {
    if (selectedTraceIdSignal.value) return TRACE_DETAIL_SHORTCUTS;
    if (selectedTabSignal.value === 'traces') return TRACE_LIST_SHORTCUTS;
    return GLOBAL_SHORTCUTS;
  }

  $effect(() => {
    const root = panelEl?.getRootNode();
    const target: Document | ShadowRoot | Window =
      root instanceof ShadowRoot
        ? root
        : root instanceof Document
          ? root
          : window;

    const onKeydown = (e: Event) => {
      const ev = e as KeyboardEvent;
      if (ev.key === 'Escape') {
        if (helpShortcutsSignal.value) {
          closeHelp();
          return;
        }
        if (isInputFocused()) return;
        if (pipActiveSignal.value) {
          closePip(() => (pipActiveSignal.value = false));
          return;
        }
        toggleWidget();
        return;
      }
      if (ev.key === '?' && !isInputFocused()) {
        ev.preventDefault();
        toggleHelp(contextShortcuts());
        return;
      }
      if (helpShortcutsSignal.value) return; // help open — swallow other keys
      if (!isInputFocused() && ev.key >= '1' && ev.key <= '7') {
        const idx = Number.parseInt(ev.key, 10) - 1;
        if (idx < TABS_ORDER.length) setSelectedTab(TABS_ORDER[idx]);
      }
    };

    target.addEventListener('keydown', onKeydown);
    return () => target.removeEventListener('keydown', onKeydown);
  });

  // ─── Dock-aware geometry (PiP fills its whole window) ───
  const containerPosition = $derived(
    pipActive
      ? 'inset-0'
      : {
          bottom: 'left-0 right-0 bottom-0',
          top: 'left-0 right-0 top-0',
          right: 'top-0 bottom-0 right-0',
          left: 'top-0 bottom-0 left-0',
        }[dock],
  );
  const containerBorder = $derived(
    pipActive
      ? ''
      : {
          bottom: 'border-t',
          top: 'border-b',
          right: 'border-l',
          left: 'border-r',
        }[dock],
  );
  // Resize handle: a generous hit strip straddling the inner edge of the panel.
  const handlePosition = $derived(
    {
      bottom: '-top-1 left-0 right-0 h-2 cursor-ns-resize',
      top: '-bottom-1 left-0 right-0 h-2 cursor-ns-resize',
      right: '-left-1 top-0 bottom-0 w-2 cursor-ew-resize',
      left: '-right-1 top-0 bottom-0 w-2 cursor-ew-resize',
    }[dock],
  );
  // The hairline that sits exactly on the docked edge inside the hit strip.
  const handleEdge = $derived(
    {
      bottom: 'inset-x-0 top-1 h-px',
      top: 'inset-x-0 bottom-1 h-px',
      right: 'inset-y-0 left-1 w-px',
      left: 'inset-y-0 right-1 w-px',
    }[dock],
  );
  const sizeStyle = $derived(
    pipActive ? '' : isVertical ? `height: ${axisSize}px;` : `width: ${axisSize}px;`,
  );
  // Shadow casts away from the docked edge so the panel reads as a surface
  // lifted off that edge rather than a box floating in space.
  const shadowStyle = $derived(
    pipActive
      ? ''
      : {
          bottom: 'box-shadow: 0 -12px 32px -14px var(--at-shadow), 0 -2px 6px -4px var(--at-shadow);',
          top: 'box-shadow: 0 12px 32px -14px var(--at-shadow), 0 2px 6px -4px var(--at-shadow);',
          right: 'box-shadow: -12px 0 32px -14px var(--at-shadow), -2px 0 6px -4px var(--at-shadow);',
          left: 'box-shadow: 12px 0 32px -14px var(--at-shadow), 2px 0 6px -4px var(--at-shadow);',
        }[dock],
  );
  const dockIcon = $derived(
    dock === 'right' ? PanelRight : dock === 'left' ? PanelLeft : PanelBottom,
  );

  // Drop-zone bands shown while dragging the header to re-dock.
  const dropZones: { edge: Dock; pos: string; label: string }[] = [
    { edge: 'bottom', pos: 'left-0 right-0 bottom-0 h-24', label: 'Dock bottom' },
    { edge: 'top', pos: 'left-0 right-0 top-0 h-24', label: 'Dock top' },
    { edge: 'left', pos: 'top-0 bottom-0 left-0 w-44', label: 'Dock left' },
    { edge: 'right', pos: 'top-0 bottom-0 right-0 w-44', label: 'Dock right' },
  ];
</script>

{#if expanded}
  <!-- Docked, non-blocking panel — no backdrop, host page stays interactive. -->
  <section
    bind:this={panelEl}
    aria-label="Autotel devtools"
    transition:dockSlide={{ dock }}
    class={cn(
      'fixed z-[1000] flex flex-col',
      'bg-surface text-fg',
      containerPosition,
      containerBorder,
      'border-line',
    )}
    style={`${sizeStyle} ${shadowStyle}`}
  >
    {#if !pipActive}
      <!-- Resize handle on the inner edge. An ARIA window splitter: focusable and
           keyboard-operable (arrow keys), so the noninteractive-element lint is a
           false positive here. -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <div
        role="separator"
        aria-orientation={isVertical ? 'horizontal' : 'vertical'}
        aria-label="Resize panel"
        aria-valuenow={Math.round(axisSize)}
        aria-valuemin={sizeBounds.min}
        aria-valuemax={sizeBounds.max}
        tabindex="0"
        title="Drag to resize · double-click to reset"
        onpointerdown={resize.onPointerDown}
        onkeydown={resize.onKeyDown}
        ondblclick={resize.onDblClick}
        class={cn(
          'absolute z-20 group touch-none select-none outline-none',
          handlePosition,
        )}
      >
      <!-- Edge hairline — quietly marks the divider at rest, fills with the
           brand accent while hovering, keyboard-focused, or dragging. -->
      <div
        class={cn(
          'absolute bg-line-subtle transition-colors duration-150',
          'group-hover:bg-accent group-focus-visible:bg-accent',
          resize.resizing && '!bg-accent',
          handleEdge,
        )}
      ></div>
      <!-- Grip — a small pill centered on the edge so the handle is
           discoverable without hovering, à la a real docked splitter. -->
      <div
        class={cn(
          'absolute rounded-full bg-line transition-colors duration-150',
          'group-hover:bg-accent group-focus-visible:bg-accent',
          resize.resizing && '!bg-accent',
          isVertical
            ? 'left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-9 h-1'
            : 'top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 h-9 w-1',
        )}
      ></div>
      </div>
    {/if}

    <!-- Header: drag to re-dock · brand · tabs · status · pop-out · dock · close.
         Pointer-drag only (free-form re-docking has no keyboard analogue); the
         dock-cycle button is the keyboard-accessible equivalent. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <header
      onpointerdown={dockDrag.onHeaderPointerDown}
      class={cn(
        'flex items-center gap-1 pl-2 pr-2 h-11 flex-shrink-0',
        'border-b border-line bg-surface',
        pipActive ? '' : 'cursor-grab active:cursor-grabbing',
      )}
    >
      {#if !pipActive}
        <span class="text-fg-subtle/60 flex-shrink-0 pl-0.5" aria-hidden="true">
          <GripHorizontal size={14} />
        </span>
      {/if}
      <div class="flex items-center gap-2 flex-shrink-0 pr-1 mr-0.5">
        <Logo width={18} height={18} />
        <span class="text-xs font-semibold tracking-tight text-fg hidden sm:inline"
          >autotel</span
        >
      </div>

      <!-- Tabs scroll horizontally so the panel never has to grow to fit them. -->
      <nav
        class="flex items-center gap-0.5 overflow-x-auto min-w-0 flex-1 at-no-scrollbar"
        aria-label="Devtools sections"
      >
        {#each tabs as tab (tab.id)}
          {@const Icon = tab.icon}
          {@const isActive = selectedTab === tab.id}
          <button
            onclick={() => setSelectedTab(tab.id)}
            aria-current={isActive ? 'page' : undefined}
            class={cn(
              'flex items-center gap-1.5 px-2.5 h-8 rounded-md flex-shrink-0',
              'text-xs transition-colors cursor-pointer',
              isActive
                ? 'bg-accent/12 text-fg font-semibold ring-1 ring-inset ring-accent/20'
                : 'text-fg-subtle font-medium hover:text-fg hover:bg-subtle',
            )}
          >
            <Icon
              size={14}
              class={tab.id === 'errors' && tab.badge ? 'text-danger' : undefined}
            />
            <span>{tab.label}</span>
            {#if tab.badge}
              <span
                class={cn(
                  'px-1.5 py-px text-[10px] font-semibold rounded-full',
                  tab.id === 'errors'
                    ? 'bg-danger-bg text-danger'
                    : 'bg-accent/15 text-fg-muted',
                )}
              >
                {tab.badge > 99 ? '99+' : tab.badge}
              </span>
            {/if}
          </button>
        {/each}
      </nav>

      <div class="flex items-center gap-1 flex-shrink-0 pl-1">
        <ConnectionStatus compact />
        <button
          onclick={() => toggleHelp(contextShortcuts())}
          class="p-1.5 rounded-md text-fg-subtle hover:text-fg hover:bg-subtle transition-colors"
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
        >
          <HelpCircle size={15} />
        </button>
        {#snippet DockIcon()}
          {@const Icon = dockIcon}
          <Icon size={15} />
        {/snippet}
        {#if !pipActive}
          <button
            onclick={cycleDock}
            class="p-1.5 rounded-md text-fg-subtle hover:text-fg hover:bg-subtle transition-colors"
            title="Dock position (click to cycle: bottom → right → left) — or drag the header to an edge"
            aria-label="Change dock position"
          >
            {@render DockIcon()}
          </button>
        {/if}
        {#if pipSupported}
          <button
            onclick={togglePip}
            class="p-1.5 rounded-md text-fg-subtle hover:text-fg hover:bg-subtle transition-colors"
            title={pipActive ? 'Return to docked panel' : 'Pop out to a separate window'}
            aria-label={pipActive ? 'Return to docked panel' : 'Pop out to window'}
          >
            {#if pipActive}
              <Minimize2 size={15} />
            {:else}
              <PictureInPicture2 size={15} />
            {/if}
          </button>
        {/if}
        {#if !pipActive}
          <button
            onclick={toggleWidget}
            class="p-1.5 rounded-md text-fg-subtle hover:text-fg hover:bg-subtle transition-colors"
            title="Close (Esc)"
            aria-label="Close devtools"
          >
            <X size={16} />
          </button>
        {/if}
      </div>
    </header>

    <!-- Content -->
    <div class="flex-1 min-h-0 overflow-hidden">
      <TabView />
    </div>

    {#if helpShortcuts}
      <KeyboardShortcutsHelp shortcuts={helpShortcuts} onClose={closeHelp} />
    {/if}
  </section>

  <!-- Drag-to-dock drop zones — shown while dragging the header. Pointer-events
       stay off so the window-level drag tracking keeps receiving moves. -->
  {#if dockDrag.dragging}
    <div class="fixed inset-0 z-[1001] pointer-events-none" aria-hidden="true">
      {#each dropZones as zone (zone.edge)}
        {@const isTarget = dockDrag.dropTarget === zone.edge}
        <div
          class={cn(
            'absolute flex items-center justify-center transition-colors duration-100',
            zone.pos,
            isTarget
              ? 'bg-accent/15 ring-2 ring-inset ring-accent'
              : 'bg-accent/5',
          )}
        >
          {#if isTarget}
            <span
              class="px-2.5 py-1 rounded-md bg-accent text-white text-xs font-semibold shadow-lg"
            >
              {zone.label}
            </span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
{/if}
