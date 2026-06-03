/**
 * @vitest-environment jsdom
 *
 * TabView is the single source of truth for tab → view dispatch (shared by the
 * docked Panel and the full-page Layout). This guards that each TabType renders
 * its own view, by selecting each tab with no data loaded and asserting the
 * target view's distinctive empty state appears — so the two surfaces can never
 * silently drift to the wrong view for a tab.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import TabView from '../components/TabView.svelte';
import { clearAllData, setSelectedTab } from '../store.svelte';
import type { TabType } from '../types';

const CASES: Array<{ tab: TabType; marker: RegExp }> = [
  { tab: 'traces', marker: /No traces yet/ },
  { tab: 'genai', marker: /No GenAI spans yet/ },
  { tab: 'flow', marker: /No flow to show yet/ },
  { tab: 'resources', marker: /No resources derived yet/ },
  { tab: 'service-map', marker: /No traces available to build service map/ },
  { tab: 'metrics', marker: /No metrics yet/ },
  { tab: 'logs', marker: /No logs yet/ },
  { tab: 'errors', marker: /No errors captured/ },
];

describe('TabView dispatch', () => {
  beforeEach(() => {
    clearAllData();
  });
  afterEach(() => {
    cleanup();
    clearAllData();
    setSelectedTab('traces');
  });

  it.each(CASES)(
    'renders the matching view for the "$tab" tab',
    async ({ tab, marker }) => {
      setSelectedTab(tab);
      render(TabView);
      expect(await screen.findByText(marker)).toBeTruthy();
    },
  );

  it('falls back to the traces view for an unknown tab', async () => {
    // The dispatch's else-branch is the traces view; setting an off-list value
    // (defensive — shouldn't happen via the tab bars) must not render blank.
    setSelectedTab('definitely-not-a-tab' as TabType);
    render(TabView);
    expect(await screen.findByText(/No traces yet/)).toBeTruthy();
  });
});
