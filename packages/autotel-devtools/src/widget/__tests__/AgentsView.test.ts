/**
 * @vitest-environment jsdom
 *
 * AgentsView renders coding-agent sessions reconstructed by the autotel-agents
 * reducers. Covers the empty state (launch command) and a populated state
 * exercising sessions list, aggregate strip, MCP / sub-agent / skill breakdowns,
 * and the prompt-privacy reveal toggle.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/svelte';
import AgentsView from '../components/AgentsView.svelte';
import { clearAllData, updateWidgetData } from '../store.svelte';
import { sampleAgentSessions } from '../components/__fixtures__/agents';

describe('AgentsView', () => {
  beforeEach(() => clearAllData());
  afterEach(() => {
    cleanup();
    clearAllData();
  });

  it('shows the launch command in the empty state', () => {
    render(AgentsView);
    expect(screen.getByText(/Waiting for coding-agent telemetry/)).toBeTruthy();
    expect(screen.getByText(/npx autotel-devtools claude/)).toBeTruthy();
  });

  it('lists sessions and surfaces MCP / sub-agent / skill in the aggregate strip', async () => {
    render(AgentsView);
    updateWidgetData({ agents: sampleAgentSessions() });

    // Detail header shows the full selected id; the list shows truncated ids.
    expect(await screen.findByText('sess-feature-build')).toBeTruthy();
    expect(screen.getByText(/sess-qui/)).toBeTruthy(); // truncated list entry
    // aggregate strip chips (icon + text, matched loosely). mcp:github also
    // appears in the timeline detail, so allow multiples there.
    expect(screen.getAllByText(/mcp:github/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Explore/)).toBeTruthy();
    expect(screen.getByText(/tdd/)).toBeTruthy();
  });

  it('shows the rich session detail with a per-tool breakdown by default', async () => {
    render(AgentsView);
    updateWidgetData({ agents: sampleAgentSessions() });

    // Rich session is most-recently-active → selected by default. These names
    // appear in both the tool breakdown and the timeline, so allow multiples.
    expect((await screen.findAllByText('Task')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Skill').length).toBeGreaterThan(0);
    expect(screen.getAllByText('mcp__github__create_issue').length).toBeGreaterThan(0);
  });

  it('keeps prompts private by default and toggles reveal', async () => {
    render(AgentsView);
    updateWidgetData({ agents: sampleAgentSessions() });

    const toggle = await screen.findByTitle(/Reveal \/ hide captured prompt text/);
    expect(toggle.textContent).toMatch(/Reveal prompts/);
    await fireEvent.click(toggle);
    expect(toggle.textContent).toMatch(/Hide prompts/);
  });
});
