/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/svelte';
import ErrorsView from '../components/ErrorsView.svelte';
import { clearAllData, updateWidgetData } from '../store.svelte';
import { configureIssuesClient } from '../issues-client';
import type { ErrorGroup } from '../types';

const group = (fingerprint: string, message: string): ErrorGroup => ({
  fingerprint,
  source: 'exception' as const,
  type: 'TypeError',
  message,
  count: 3,
  firstSeen: Date.now() - 60_000,
  lastSeen: Date.now(),
  affectedTraces: ['t1'],
  affectedSpans: ['POST /pay'],
  service: 'api',
});

describe('ErrorsView — issue status and automations', () => {
  let calls: Array<{ url: string; method: string; body?: unknown }>;
  let statuses: Record<string, string>;
  let destinations: unknown[];

  beforeEach(() => {
    clearAllData();
    calls = [];
    statuses = { active1: 'active', gone: 'resolved' };
    destinations = [
      {
        id: 'd1',
        type: 'slack',
        name: 'Team channel',
        url: 'https://hooks.slack.com/••••',
      },
    ];
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        calls.push({ url, method, body });
        const json = (value: unknown) =>
          new Response(JSON.stringify(value), { status: 200 });
        if (url.includes('/api/issues?')) {
          return json({
            issues: Object.entries(statuses).map(([fingerprint, status]) => ({
              fingerprint,
              source: 'exception' as const,
              status,
              count: 3,
            })),
          });
        }
        if (url.endsWith('/status')) {
          statuses[url.split('/').at(-2)!] = body.status;
          return json({ status: body.status });
        }
        if (url.endsWith('/send')) {
          return json({
            run: {
              id: 1,
              destinationId: 'd1',
              trigger: 'manual',
              status: 'succeeded',
              attempts: 1,
              createdAt: Date.now(),
            },
          });
        }
        if (url.includes('/api/issue-runs')) return json({ runs: [] });
        if (url.endsWith('/api/issue-destinations') && method === 'GET')
          return json({ destinations });
        if (url.endsWith('/api/issue-destinations')) {
          destinations.push({ ...body, id: 'd2' });
          return json({ destination: { ...body, id: 'd2' } });
        }
        if (url.endsWith('/api/issue-automations') && method === 'GET')
          return json({ automations: [] });
        return json({});
      },
    );
    configureIssuesClient(
      'http://receiver.test',
      fetchMock as unknown as typeof fetch,
    );
    // The live-tail views query the receiver too; those calls are not under test.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 503 })),
    );
  });

  afterEach(() => {
    cleanup();
    clearAllData();
    configureIssuesClient(null);
    vi.unstubAllGlobals();
  });

  it('hides resolved issues by default and shows them under their status', async () => {
    render(ErrorsView);
    updateWidgetData({
      errors: [group('active1', 'card declined'), group('gone', 'old bug')],
    });
    expect(await screen.findByText('card declined')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('old bug')).toBeNull());

    await fireEvent.change(screen.getByLabelText('Issue status'), {
      target: { value: 'resolved' },
    });
    expect(await screen.findByText('old bug')).toBeTruthy();
  });

  it('resolves an issue and sends it to a destination', async () => {
    render(ErrorsView);
    updateWidgetData({ errors: [group('active1', 'card declined')] });
    await fireEvent.click(await screen.findByText('card declined'));

    const select = await screen.findByLabelText('Send to destination');
    await fireEvent.change(select, { target: { value: 'd1' } });
    await fireEvent.click(screen.getByText('Send'));
    expect(await screen.findByText('Sent')).toBeTruthy();
    expect(calls.find((c) => c.url.endsWith('/active1/send'))?.body).toEqual({
      destinationId: 'd1',
    });

    await fireEvent.click(screen.getByText('Resolve'));
    await waitFor(() =>
      expect(
        calls.find((c) => c.url.endsWith('/active1/status'))?.body,
      ).toEqual({ status: 'resolved' }),
    );
    // Resolved drops out of the default (active) filter.
    await waitFor(() => expect(screen.queryByText('card declined')).toBeNull());
  });

  it('adds a Claude Code destination from the automations panel', async () => {
    render(ErrorsView);
    await fireEvent.click(await screen.findByText('Automations'));
    await fireEvent.input(screen.getByLabelText('Routine ID'), {
      target: { value: 'trig_1' },
    });
    await fireEvent.input(screen.getByLabelText('Token'), {
      target: { value: 'sk-ant-oat01-x' },
    });
    await fireEvent.click(screen.getByText('Add destination'));
    await waitFor(() =>
      expect(
        calls.find(
          (c) =>
            c.url.endsWith('/api/issue-destinations') && c.method === 'POST',
        )?.body,
      ).toEqual({
        type: 'claude-code',
        name: 'Claude Code',
        routineId: 'trig_1',
        token: 'sk-ant-oat01-x',
      }),
    );
  });
});
