<script lang="ts">
  import { DevtoolsWebSocketClient } from './websocket';
  import {
    updateWidgetData,
    loadPersistedState,
    connectionStatusSignal,
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
    traceTimeRangeFilterSignal,
    traceSortSignal,
    genaiQuerySignal,
  } from './store.svelte';
  import {
    parseNavHash,
    formatNavHash,
    DEFAULT_SORT,
    DEFAULT_TAB,
    type NavState,
  } from './url-sync';
  import Bubble from './components/Bubble.svelte';
  import Panel from './components/Panel.svelte';
  import Layout from './components/Layout.svelte';

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
    traceTimeRangeFilterSignal.value = nav.timeRange ?? 'all';
    traceSortSignal.value = nav.sort ?? DEFAULT_SORT;
    genaiQuerySignal.value = nav.genaiQuery ?? '';
    if (nav.traceId) requestDeepLink(nav.traceId, nav.spanId);
  }

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
      timeRange: traceTimeRangeFilterSignal.value,
      sort: traceSortSignal.value,
      genaiQuery: genaiQuerySignal.value || undefined,
    };
    // Wait for an unresolved deep-link to apply, or we'd write the URL before
    // its trace/span are selected and drop them from the shareable link.
    if (pendingDeepLinkSignal.value) return;
    const next = formatNavHash(nav);
    if (next === location.hash) return;
    history.replaceState(
      history.state,
      '',
      `${location.pathname}${location.search}${next}`,
    );
  });

  // Full-page only: react to manual hash edits / shared links opened in place.
  $effect(() => {
    if (mode !== 'fullpage') return;
    const onHashChange = () => applyNav(parseNavHash(location.hash));
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  });

  $effect(() => {
    loadPersistedState();

    const wsClient = new DevtoolsWebSocketClient(wsUrl);
    connectionStatusSignal.value = 'connecting';

    wsClient.connect().then((connected) => {
      connectionStatusSignal.value = connected ? 'connected' : 'disconnected';
    });

    const unsubscribe = wsClient.onMessage((data) => {
      updateWidgetData(data);
      connectionStatusSignal.value = 'connected';
    });

    return () => {
      unsubscribe();
      wsClient.disconnect();
    };
  });
</script>

{#if mode === 'fullpage'}
  <Layout />
{:else}
  <Bubble />
  <Panel />
{/if}
