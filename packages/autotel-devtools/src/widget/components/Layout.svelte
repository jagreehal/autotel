<script lang="ts">
  import TabBar from './TabBar.svelte';
  import TabView from './TabView.svelte';
  import SnapshotBar from './SnapshotBar.svelte';
  import KeyboardShortcutsHelp from './KeyboardShortcutsHelp.svelte';
  import ConnectionStatus from './ConnectionStatus.svelte';
  import { isInputFocused } from '../utils/keyboard';
  import {
    themeSignal,
    cycleTheme,
    getInitialTheme,
    selectedTabSignal,
    selectedTraceIdSignal,
    setSelectedTab,
    helpShortcutsSignal,
    openHelp,
    closeHelp,
    toggleHelp,
  } from '../store.svelte';
  import {
    GLOBAL_SHORTCUTS,
    TRACE_LIST_SHORTCUTS,
    TRACE_DETAIL_SHORTCUTS,
  } from '../shortcuts';
  import type { TabType } from '../types';
  import { Sun, Moon, Monitor, HelpCircle } from '@lucide/svelte';

  const TABS_ORDER: TabType[] = [
    'traces',
    'flow',
    'resources',
    'service-map',
    'metrics',
    'logs',
    'errors',
  ];

  /** Help list for the active context (read live; signals, not render state). */
  function contextShortcuts() {
    if (selectedTraceIdSignal.value) return TRACE_DETAIL_SHORTCUTS;
    if (selectedTabSignal.value === 'traces') return TRACE_LIST_SHORTCUTS;
    return GLOBAL_SHORTCUTS;
  }

  const theme = $derived(themeSignal.value);
  const helpShortcuts = $derived(helpShortcutsSignal.value);

  // Initialize theme from localStorage on mount
  $effect(() => {
    themeSignal.value = getInitialTheme();
  });

  // Apply theme to the shadow host. The theme tokens are defined under
  // `:host([data-theme='…'])` inside the widget's shadow root stylesheet, so
  // the attribute MUST live on the host — :root or documentElement don't see
  // selectors from a scoped shadow stylesheet. We grab a reference to this
  // component's root element with bind:this, then walk to its shadow host
  // via getRootNode(). Works in both auto-mount (host is the synthetic
  // <div id="autotel-devtools-root">) and explicit custom-element paths
  // (host is <autotel-devtools>). If we're somehow not in a shadow root
  // (e.g. tests render the component into a normal DOM node), fall back to
  // <html> so :root[data-theme] still has a chance of matching.
  let rootEl: HTMLElement | undefined = $state();
  $effect(() => {
    let target: Element | null = null;
    const root = rootEl?.getRootNode();
    if (root instanceof ShadowRoot) {
      target = root.host;
    } else if (typeof document !== 'undefined') {
      target = document.documentElement;
    }
    if (target) {
      target.setAttribute('data-theme', theme);
    }
  });

  // Global keyboard shortcuts. Owns the single `?` help modal; views register
  // their own `?` via openHelp() so only one modal ever renders.
  $effect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === '?' && !isInputFocused()) {
        e.preventDefault();
        toggleHelp(contextShortcuts());
        return;
      }
      if (helpShortcutsSignal.value) return; // help open — ignore other keys

      // Tab switching with number keys
      if (!isInputFocused() && e.key >= '1' && e.key <= '6') {
        const idx = parseInt(e.key, 10) - 1;
        if (idx < TABS_ORDER.length) {
          setSelectedTab(TABS_ORDER[idx]);
        }
      }
    };
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  });

  const themeLabel = $derived(
    theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'System',
  );
</script>

<div bind:this={rootEl} class="flex h-screen w-screen bg-surface text-fg">
  <div class="hidden md:flex flex-col border-r border-line">
    <TabBar orientation="vertical" />
    <div class="mt-auto p-2 border-t border-line flex flex-col gap-1">
      <ConnectionStatus />
      <button
        onclick={cycleTheme}
        class="flex items-center gap-2 px-3 py-2 text-xs text-fg-subtle hover:bg-hover hover:text-fg rounded transition-colors"
        title={`Theme: ${themeLabel} (click to cycle)`}
      >
        {#if theme === 'dark'}
          <Moon size={14} />
        {:else if theme === 'light'}
          <Sun size={14} />
        {:else}
          <Monitor size={14} />
        {/if}
        {themeLabel}
      </button>
      <button
        onclick={() => openHelp(contextShortcuts())}
        class="flex items-center gap-2 px-3 py-2 text-xs text-fg-subtle hover:bg-hover hover:text-fg rounded transition-colors"
        title="Keyboard shortcuts (?)"
      >
        <HelpCircle size={14} />
        Shortcuts
      </button>
    </div>
  </div>
  <div class="flex-1 flex flex-col min-w-0">
    <SnapshotBar />
    <div class="md:hidden">
      <TabBar orientation="horizontal" />
    </div>
    <div class="flex-1 overflow-hidden">
      <TabView />
    </div>
  </div>
  {#if helpShortcuts}
    <KeyboardShortcutsHelp shortcuts={helpShortcuts} onClose={closeHelp} />
  {/if}
</div>
