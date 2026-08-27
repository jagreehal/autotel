// src/widget/tabs.ts
//
// Single source of truth for the tab set — id, label, icon, and order — shared
// by the docked Panel and the full-page Layout/TabBar. Previously each surface
// hand-listed its own tabs, which had drifted: GenAI was missing from the
// full-page UI and Resources was missing from the docked panel, so each view
// was unreachable on one surface. Keep this the only list so they can't drift
// again. (TabView dispatches every id to its view; see TabView.svelte.)

import {
  Database,
  Bot,
  Sparkles,
  Workflow,
  Boxes,
  Network,
  BarChart,
  FileText,
  AlertTriangle,
  ShieldAlert,
  GitCompare,
  ScanSearch,
} from '@lucide/svelte';
import type { TabType } from './types';
import { VIEWS } from './views/registry';

export interface TabDef {
  id: TabType;
  label: string;
  icon: typeof Database;
}

const ALL_TABS: readonly TabDef[] = [
  { id: 'traces', label: 'Traces', icon: Database },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'genai', label: 'GenAI', icon: Sparkles },
  { id: 'flow', label: 'Flow', icon: Workflow },
  { id: 'resources', label: 'Resources', icon: Boxes },
  { id: 'service-map', label: 'Service Map', icon: Network },
  { id: 'metrics', label: 'Metrics', icon: BarChart },
  { id: 'logs', label: 'Logs', icon: FileText },
  { id: 'errors', label: 'Errors', icon: AlertTriangle },
  { id: 'security', label: 'Security', icon: ShieldAlert },
  { id: 'compare', label: 'Compare', icon: GitCompare },
  { id: 'coverage', label: 'Coverage', icon: ScanSearch },
];

/**
 * Tabs this build can actually render.
 *
 * Filtered against the view registry so the embedded build cannot offer a tab
 * whose view it did not bundle — clicking one would otherwise fall back to
 * Traces with no explanation.
 */
export const TAB_DEFS: readonly TabDef[] = ALL_TABS.filter(
  (tab) => VIEWS[tab.id] !== undefined,
);

/** Tab ids in display order — drives keyboard (1–9) tab switching. */
export const TAB_ORDER: readonly TabType[] = TAB_DEFS.map((t) => t.id);
