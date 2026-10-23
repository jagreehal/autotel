/**
 * @vitest-environment jsdom
 *
 * The bar reports what it would put in a snapshot.
 *
 * It used to say "Local data" whether the store held two thousand traces or
 * none, which made `Download snapshot` a button you pressed to find out
 * whether there was anything to download.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import SnapshotBar from '../components/SnapshotBar.svelte';
import {
  clearAllData,
  exitSnapshotMode,
  updateWidgetData,
} from '../store.svelte';
import type { TraceData } from '../types';

function trace(id: string, status: 'OK' | 'ERROR' = 'OK'): TraceData {
  const now = Date.now();
  const span = {
    traceId: id,
    spanId: `${id}-root`,
    name: 'root',
    kind: 'INTERNAL' as const,
    startTime: now,
    endTime: now + 50,
    duration: 50,
    attributes: {},
    status: { code: status },
  };
  return {
    traceId: id,
    correlationId: id,
    rootSpan: span,
    spans: [span],
    startTime: now,
    endTime: now + 50,
    duration: 50,
    status,
    service: 'demo',
  };
}

beforeEach(() => {
  exitSnapshotMode();
  clearAllData();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SnapshotBar', () => {
  it('says what it holds, so the two live states are told apart', () => {
    updateWidgetData({ traces: [trace('t1'), trace('t2', 'ERROR')] });
    render(SnapshotBar);

    expect(screen.getByText(/2 traces/)).toBeTruthy();
  });

  it('says plainly when there is nothing captured', () => {
    render(SnapshotBar);

    expect(screen.getByText(/No data captured/)).toBeTruthy();
  });

  it('cannot download an empty snapshot', () => {
    // The button was always live, so pressing it produced a file with nothing
    // in it — a dead action dressed as a working one.
    render(SnapshotBar);

    expect(
      screen.getByRole('button', { name: /Download snapshot/i }),
    ).toHaveProperty('disabled', true);
  });

  it('enables the download once something has arrived', () => {
    updateWidgetData({ traces: [trace('t1')] });
    render(SnapshotBar);

    expect(
      screen.getByRole('button', { name: /Download snapshot/i }),
    ).toHaveProperty('disabled', false);
  });

  it('counts one trace without pluralising it', () => {
    updateWidgetData({ traces: [trace('t1')] });
    render(SnapshotBar);

    expect(screen.getByText(/1 trace(?!s)/)).toBeTruthy();
  });

  describe('Clear', () => {
    async function clearWith(fetch: () => Promise<Response>) {
      vi.stubGlobal('fetch', vi.fn(fetch));
      updateWidgetData({ traces: [trace('t1')] });
      render(SnapshotBar);
      await fireEvent.click(screen.getByRole('button', { name: /^Clear$/ }));
    }

    it('clears the server and the view', async () => {
      await clearWith(async () => new Response('{}', { status: 200 }));

      expect(await screen.findByText(/No data captured/)).toBeTruthy();
      expect(screen.queryByText(/server/i)).toBeNull();
    });

    it('warns when the server refuses, since its data will come back', async () => {
      await clearWith(async () => new Response('{}', { status: 403 }));

      expect(
        await screen.findByText(/Server kept its data \(403\)/),
      ).toBeTruthy();
    });

    it('warns when the server cannot be reached, since its data will come back', async () => {
      await clearWith(async () => {
        throw new TypeError('Failed to fetch');
      });

      expect(await screen.findByText(/Couldn't reach the server/)).toBeTruthy();
      expect(screen.getByText(/No data captured/)).toBeTruthy();
    });
  });
});
