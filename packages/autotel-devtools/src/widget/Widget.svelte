<script lang="ts">
  import { DevtoolsWebSocketClient } from './websocket';
  import {
    updateWidgetData,
    loadPersistedState,
    connectionStatusSignal,
  } from './store.svelte';
  import Bubble from './components/Bubble.svelte';
  import Panel from './components/Panel.svelte';
  import Layout from './components/Layout.svelte';

  interface Props {
    mode: 'widget' | 'fullpage';
    wsUrl: string;
  }
  let { mode, wsUrl }: Props = $props();

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
