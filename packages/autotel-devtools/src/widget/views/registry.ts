/**
 * Tab → view registry (full).
 *
 * The single place a tab id is mapped to the component that renders it. It
 * exists as a module rather than a `{#if}` chain in `TabView` so the build can
 * swap in a smaller set: the embedded widget aliases this to `registry.lean.ts`
 * and ships only the views a guest in someone else's page should cost them.
 *
 * `TAB_DEFS` in `tabs.ts` is filtered against this, so a build cannot offer a
 * tab whose view it did not bundle.
 */

import type { Component } from 'svelte';
import type { TabType } from '../types';
import TracesView from '../components/TracesView.svelte';
import AgentsView from '../components/AgentsView.svelte';
import GenAiView from '../components/GenAiView.svelte';
import FlowView from '../components/FlowView.svelte';
import ResourcesView from '../components/ResourcesView.svelte';
import ServiceMapView from '../components/ServiceMapView.svelte';
import MetricsView from '../components/MetricsView.svelte';
import LogsView from '../components/LogsView.svelte';
import ErrorsView from '../components/ErrorsView.svelte';
import SecurityView from '../components/SecurityView.svelte';
import CompareView from '../components/CompareView.svelte';
import CoverageView from '../components/CoverageView.svelte';

/** Views this build includes. A missing id falls back to Traces. */
export const VIEWS: Partial<Record<TabType, Component>> = {
  traces: TracesView,
  agents: AgentsView,
  genai: GenAiView,
  flow: FlowView,
  resources: ResourcesView,
  'service-map': ServiceMapView,
  metrics: MetricsView,
  logs: LogsView,
  errors: ErrorsView,
  security: SecurityView,
  compare: CompareView,
  coverage: CoverageView,
};

/** Whether this build is the reduced set — drives the "open full viewer" hint. */
export const IS_LEAN = false;
