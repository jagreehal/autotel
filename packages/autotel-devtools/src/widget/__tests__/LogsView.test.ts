/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import LogsView from '../components/LogsView.svelte';
import { clearAllData, updateWidgetData } from '../store.svelte';
import type { LogData } from '../types';

const log: LogData = {
  id: 'log-1',
  body: 'claude_code.tool_result',
  timestamp: Date.now(),
  severityText: 'INFO',
  severityNumber: 9,
  resourceName: 'claude-code',
  attributes: {
    'session.id': 'sess-1',
    tool_name: 'Bash',
    success: false,
    duration_ms: 1510,
  },
};

describe('LogsView — row summary', () => {
  beforeEach(() => {
    clearAllData();
    // The server query is unreachable here, so the view renders the live tail.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 503 })),
    );
  });
  afterEach(() => {
    cleanup();
    clearAllData();
    vi.unstubAllGlobals();
  });

  it('shows key attributes inline so a row is readable without expanding it', async () => {
    render(LogsView);
    updateWidgetData({ logs: [log] });
    expect(await screen.findByText('claude_code.tool_result')).toBeTruthy();
    expect(screen.getByText('Bash')).toBeTruthy();
    expect(screen.getByText('1510')).toBeTruthy();
    expect(screen.queryByText('sess-1')).toBeNull();
  });
});
