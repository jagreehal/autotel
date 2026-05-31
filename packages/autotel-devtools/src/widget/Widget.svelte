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
  } from './store.svelte';
  import Bubble from './components/Bubble.svelte';
  import Panel from './components/Panel.svelte';
  import Layout from './components/Layout.svelte';

  interface Props {
    mode: 'widget' | 'fullpage';
    wsUrl: string;
    deepLink?: { traceId: string; spanId?: string };
  }
  let { mode, wsUrl, deepLink }: Props = $props();

  // Register an inbound deep-link (e.g. from the VS Code extension's URL hash).
  $effect(() => {
    if (deepLink) requestDeepLink(deepLink.traceId, deepLink.spanId);
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
