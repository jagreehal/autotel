/**
 * Tab → view registry (embedded widget).
 *
 * The embedded widget is a guest in someone else's product page, and every
 * kilobyte it ships is one their users download. So it carries the views you
 * reach for while debugging *your own app* — traces, logs, errors, and the
 * resource summary — and hands off to the full viewer for the exploratory ones
 * (GenAI, Agents, Flow, Service Map, Metrics, Security), which bring the chart
 * and graph code with them.
 *
 * The full-page app aliases back to `registry.ts` and has no such budget.
 */

import type { Component } from 'svelte';
import type { TabType } from '../types';
import TracesView from '../components/TracesView.svelte';
import ResourcesView from '../components/ResourcesView.svelte';
import LogsView from '../components/LogsView.svelte';
import ErrorsView from '../components/ErrorsView.svelte';

export const VIEWS: Partial<Record<TabType, Component>> = {
  traces: TracesView,
  resources: ResourcesView,
  logs: LogsView,
  errors: ErrorsView,
};

export const IS_LEAN = true;
