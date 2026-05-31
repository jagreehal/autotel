<script lang="ts">
  /**
   * Single source of truth for tab → view dispatch, shared by both surfaces
   * (the full-page Layout and the embedded Panel). Covers every TabType; each
   * surface only ever selects ids from its own tab bar, so the extra cases are
   * inert — but keeping them here means the two surfaces can never drift in
   * which view a tab maps to.
   */
  import { selectedTabSignal } from '../store.svelte';
  import TracesView from './TracesView.svelte';
  import GenAiView from './GenAiView.svelte';
  import FlowView from './FlowView.svelte';
  import ResourcesView from './ResourcesView.svelte';
  import ServiceMapView from './ServiceMapView.svelte';
  import MetricsView from './MetricsView.svelte';
  import LogsView from './LogsView.svelte';
  import ErrorsView from './ErrorsView.svelte';

  const selected = $derived(selectedTabSignal.value);
</script>

{#if selected === 'genai'}
  <GenAiView />
{:else if selected === 'flow'}
  <FlowView />
{:else if selected === 'resources'}
  <ResourcesView />
{:else if selected === 'service-map'}
  <ServiceMapView />
{:else if selected === 'metrics'}
  <MetricsView />
{:else if selected === 'logs'}
  <LogsView />
{:else if selected === 'errors'}
  <ErrorsView />
{:else}
  <TracesView />
{/if}
