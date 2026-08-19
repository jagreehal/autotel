/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/svelte';
import StackTracePanel from '../components/StackTracePanel.svelte';
import type { SourceWindow } from '../../server/source-file';

const STACK =
  'TypeError: no quote\n' +
  '    at quoteShipment (file:///proj/src/carrier.ts:42:11)\n' +
  '    at ClientRequest.emit (node:events:509:28)';

const WINDOW: SourceWindow = {
  file: 'src/carrier.ts',
  line: 42,
  startLine: 41,
  lines: ['if (!quote) {', '  throw new TypeError("no quote");'],
};

afterEach(cleanup);

describe('StackTracePanel', () => {
  it('lists the frames without fetching anything up front', () => {
    const loadSource = vi.fn();
    render(StackTracePanel, { stackTrace: STACK, loadSource });

    expect(screen.getByText('quoteShipment')).toBeTruthy();
    expect(loadSource).not.toHaveBeenCalled();
  });

  it('shows the source once a frame is chosen', async () => {
    const loadSource = vi.fn().mockResolvedValue(WINDOW);
    render(StackTracePanel, { stackTrace: STACK, loadSource });

    await fireEvent.click(
      screen.getByRole('button', { name: /quoteShipment/ }),
    );

    expect(
      await screen.findByText('  throw new TypeError("no quote");', {
        normalizer: (t) => t,
      }),
    ).toBeTruthy();
    expect(loadSource).toHaveBeenCalledOnce();
  });

  it('explains itself when the source cannot be read', async () => {
    const loadSource = vi.fn().mockResolvedValue(null);
    render(StackTracePanel, { stackTrace: STACK, loadSource });

    await fireEvent.click(
      screen.getByRole('button', { name: /quoteShipment/ }),
    );

    expect(await screen.findByText(/could not be read/i)).toBeTruthy();
  });

  it('renders nothing rather than an empty shell when there are no frames', () => {
    const { container } = render(StackTracePanel, {
      stackTrace: 'Error: thrown with no stack',
      loadSource: vi.fn(),
    });

    expect(container.textContent).toBe('');
  });
});
