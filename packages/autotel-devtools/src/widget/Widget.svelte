<script lang="ts">
  import { DevtoolsWebSocketClient } from './websocket';
  import { configureSourceLoader, httpBaseFromWsUrl } from './source-client';
  import {
    updateWidgetData,
    loadPersistedState,
    connectionStatusSignal,
    connectionUrlSignal,
    tracesSignal,
    pendingDeepLinkSignal,
    requestDeepLink,
    setSelectedTrace,
    setSelectedTab,
    selectedTabSignal,
    selectedTraceIdSignal,
    selectedSpanIdSignal,
    traceQuerySignal,
    traceStatusFilterSignal,
    traceMinDurationSignal,
    traceSortSignal,
    genaiQuerySignal,
    timeWindowSignal,
  } from './store.svelte';
  import {
    parseNavHash,
    formatNavHash,
    historyModeFor,
    DEFAULT_SORT,
    DEFAULT_TAB,
    type NavState,
  } from './url-sync';
  import Bubble from './components/Bubble.svelte';
  import Panel from './components/Panel.svelte';
  import Layout from './components/Layout.svelte';
  import { BitsConfig } from 'bits-ui';
  import { DEFAULT_SELECTION } from './timeWindow';
  import { createWorkingSet } from './workingSet.svelte';
  import { createPortalTarget } from './components/ui/portal';

  interface Props {
    mode: 'widget' | 'fullpage';
    wsUrl: string;
    deepLink?: NavState;
  }
  let { mode, wsUrl, deepLink }: Props = $props();

  // Apply a nav state from the URL: tab + filters take effect immediately; the
  // trace/span wait for their trace to arrive over the wire. Filters absent from
  // the URL reset to their defaults so the URL is the source of truth.
  function applyNav(nav: NavState): void {
    // Absent params reset to defaults so the URL is the single source of truth —
    // important for hash-only navigation, where the store state would otherwise
    // persist from the previous view (e.g. leaving the old tab active).
    setSelectedTab(nav.tab ?? DEFAULT_TAB);
    traceQuerySignal.value = nav.q ?? '';
    traceStatusFilterSignal.value = nav.status ?? 'all';
    traceMinDurationSignal.value = nav.minDuration ?? 0;
    timeWindowSignal.value = nav.window ?? DEFAULT_SELECTION;
    traceSortSignal.value = nav.sort ?? DEFAULT_SORT;
    genaiQuerySignal.value = nav.genaiQuery ?? '';
    if (nav.traceId) requestDeepLink(nav.traceId, nav.spanId);
  }

  // Record the server URL so anything issuing HTTP requests (query API, source
  // peek) can derive the right origin rather than assuming the page's own.
  $effect(() => {
    connectionUrlSignal.value = wsUrl;
  });

  // The store-backed working set: the traces and errors every derived view
  // (Service Map, Flow, Security, Resources, GenAI, Errors) folds over.
  const workingSet = createWorkingSet();
  $effect(() => {
    void workingSet.refresh();
    return () => workingSet.dispose();
  });

  // Refresh when the window changes or when traces arrive. Both go through
  // `invalidate`, which coalesces: traces stream continuously, and one refetch
  // per arrival would hammer the server for a view nobody has opened.
  $effect(() => {
    void timeWindowSignal.value;
    void tracesSignal.value.length;
    workingSet.invalidate();
  });

  // Resolve the overlay portal container from whatever root we were mounted
  // into — the shadow root in production, a plain div under test.
  let rootEl: HTMLElement | undefined = $state();
  let portalTarget = $state<HTMLElement | undefined>(undefined);
  $effect(() => {
    if (!rootEl) return;
    const root = rootEl.getRootNode();
    portalTarget = createPortalTarget(
      root instanceof ShadowRoot ? root : document.body,
    );
  });

  // Apply initial navigation from the URL hash (or the VS Code extension).
  $effect(() => {
    if (deepLink) applyNav(deepLink);
  });

  // Apply the pending deep-link once its trace has arrived over the wire.
  $effect(() => {
    const target = pendingDeepLinkSignal.value;
    if (!target) return;
    if (!tracesSignal.value.some((t) => t.traceId === target.traceId)) return;
    setSelectedTrace(target.traceId, target.spanId ?? null);
    setSelectedTab('traces');
    pendingDeepLinkSignal.value = null;
  });

  // The last state written to the URL, so the next write can tell navigation
  // from adjustment. Not a signal: nothing renders from it.
  let lastNav: NavState | null = null;

  // Full-page only: reflect the current view in the URL hash so it can be
  // bookmarked and shared. The embedded widget never touches the host page URL.
  // `replaceState` keeps history clean and (unlike assigning `location.hash`)
  // doesn't fire `hashchange`, so there's no write→read loop with the listener.
  $effect(() => {
    if (mode !== 'fullpage') return;
    const nav: NavState = {
      tab: selectedTabSignal.value,
      traceId: selectedTraceIdSignal.value ?? undefined,
      spanId: selectedSpanIdSignal.value ?? undefined,
      q: traceQuerySignal.value || undefined,
      status: traceStatusFilterSignal.value,
      minDuration: traceMinDurationSignal.value,
      window: timeWindowSignal.value,
      sort: traceSortSignal.value,
      genaiQuery: genaiQuerySignal.value || undefined,
    };
    // Wait for an unresolved deep-link to apply, or we'd write the URL before
    // its trace/span are selected and drop them from the shareable link.
    if (pendingDeepLinkSignal.value) return;
    const next = formatNavHash(nav);
    if (next === location.hash) return;
    // Navigating earns a history entry so Back retraces it; adjusting the view
    // overwrites, or typing a query would bury the page you came from under
    // one entry per keystroke. Back fires `hashchange` for a fragment-only
    // step, which the listener below already turns back into state.
    const historyMode = historyModeFor(lastNav, nav);
    lastNav = nav;
    const url = `${location.pathname}${location.search}${next}`;
    if (historyMode === 'push') history.pushState(history.state, '', url);
    else history.replaceState(history.state, '', url);
  });

  // Full-page only: react to manual hash edits / shared links opened in place.
  $effect(() => {
    if (mode !== 'fullpage') return;
    // Covers both a manually edited hash and a Back step, which for a
    // fragment-only change fires `hashchange` as well as `popstate`.
    const onHashChange = () => {
      const nav = parseNavHash(location.hash);
      lastNav = nav;
      applyNav(nav);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  });

  $effect(() => {
    loadPersistedState();

    // The receiver that serves telemetry is also the only thing that can read
    // source off disk, so the source loader is bound to the same URL.
    configureSourceLoader(httpBaseFromWsUrl(wsUrl));

    const wsClient = new DevtoolsWebSocketClient(wsUrl);
    connectionStatusSignal.value = 'connecting';

    const unsubscribeStatus = wsClient.onStatusChange((status) => {
      connectionStatusSignal.value = status;
    });
    const unsubscribe = wsClient.onMessage(updateWidgetData);
    wsClient.connect();

    return () => {
      unsubscribe();
      unsubscribeStatus();
      wsClient.disconnect();
    };
  });
</script>

<!--
  Every overlay (popover, dialog, combobox listbox, tooltip) portals its content,
  and bits-ui would default that target to `document.body` — the host page,
  outside our shadow root, where none of our Tailwind reaches and the host app's
  CSS does. Pointing the whole tree at a container inside our own root fixes it
  once rather than per-overlay. Falls back to `document.body` only when there is
  no root to attach to, which is Storybook and tests.
-->
<div bind:this={rootEl} class="contents">
  <BitsConfig defaultPortalTo={portalTarget}>
    {#if mode === 'fullpage'}
      <Layout />
    {:else}
      <Bubble />
      <Panel />
    {/if}
  </BitsConfig>
</div>
