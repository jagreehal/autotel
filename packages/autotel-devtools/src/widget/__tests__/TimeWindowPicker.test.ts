/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/svelte';
import TimeWindowPicker from '../components/TimeWindowPicker.svelte';
import type { WindowSelection } from '../timeWindow';

const ALL: WindowSelection = { type: 'preset', preset: 'all' };

/**
 * Open the popover and hand back a scope limited to its preset group.
 *
 * Scoping matters: the trigger's own label repeats the active preset's text, so
 * an unscoped `getByText('Last 1h')` matches both the trigger and the option.
 */
async function openPopover(trigger: HTMLElement) {
  const init = { bubbles: true, composed: true };
  trigger.dispatchEvent(new MouseEvent('pointerdown', init));
  trigger.dispatchEvent(new MouseEvent('mousedown', init));
  trigger.dispatchEvent(new MouseEvent('pointerup', init));
  trigger.dispatchEvent(new MouseEvent('mouseup', init));
  trigger.click();
  await waitFor(() =>
    expect(screen.getByRole('group', { name: 'Presets' })).toBeTruthy(),
  );
  return within(screen.getByRole('group', { name: 'Presets' }));
}

describe('TimeWindowPicker', () => {
  afterEach(cleanup);

  it('labels the trigger with the current selection', () => {
    render(TimeWindowPicker, {
      props: {
        selection: { type: 'preset', preset: '15m' },
        onChange: () => {},
      },
    });
    expect(screen.getByLabelText('Time window').textContent).toContain(
      'Last 15m',
    );
  });

  it('labels a custom selection by its bounds rather than a preset name', () => {
    render(TimeWindowPicker, {
      props: {
        selection: {
          type: 'custom',
          start: Date.parse('2026-08-24T09:00:00'),
          end: Date.parse('2026-08-24T09:30:00'),
        },
        onChange: () => {},
      },
    });
    expect(screen.getByLabelText('Time window').textContent).toContain('→');
  });

  it('offers every preset once opened', async () => {
    render(TimeWindowPicker, { props: { selection: ALL, onChange: () => {} } });
    const presets = await openPopover(screen.getByLabelText('Time window'));

    for (const label of [
      'All time',
      'Last 5m',
      'Last 15m',
      'Last 1h',
      'Last 6h',
      'Last 24h',
    ]) {
      expect(presets.getByText(label)).toBeTruthy();
    }
  });

  it('emits a preset selection', async () => {
    const onChange = vi.fn();
    render(TimeWindowPicker, { props: { selection: ALL, onChange } });
    const presets = await openPopover(screen.getByLabelText('Time window'));

    await fireEvent.click(presets.getByText('Last 1h'));
    expect(onChange).toHaveBeenCalledWith({ type: 'preset', preset: '1h' });
  });

  it('marks the active preset for assistive tech, not just visually', async () => {
    render(TimeWindowPicker, {
      props: {
        selection: { type: 'preset', preset: '1h' },
        onChange: () => {},
      },
    });
    const presets = await openPopover(screen.getByLabelText('Time window'));

    const active = presets.getByText('Last 1h').closest('button');
    expect(active?.getAttribute('aria-current')).toBe('true');
  });

  it('emits a custom range from the two date inputs', async () => {
    const onChange = vi.fn();
    render(TimeWindowPicker, { props: { selection: ALL, onChange } });
    await openPopover(screen.getByLabelText('Time window'));

    await fireEvent.input(screen.getByLabelText(/From/), {
      target: { value: '2026-08-24T09:00' },
    });
    await fireEvent.input(screen.getByLabelText(/To/), {
      target: { value: '2026-08-24T09:30' },
    });
    await fireEvent.click(screen.getByText('Apply'));

    expect(onChange).toHaveBeenCalledWith({
      type: 'custom',
      start: Date.parse('2026-08-24T09:00'),
      end: Date.parse('2026-08-24T09:30'),
    });
  });

  it('disables Apply until both bounds parse', async () => {
    render(TimeWindowPicker, { props: { selection: ALL, onChange: () => {} } });
    await openPopover(screen.getByLabelText('Time window'));

    await fireEvent.input(screen.getByLabelText(/From/), {
      target: { value: '' },
    });
    expect(screen.getByText('Apply').hasAttribute('disabled')).toBe(true);
  });

  it('leaves the window alone when Apply is pressed with unparseable input', async () => {
    // Applying a window nobody asked for is worse than doing nothing.
    const onChange = vi.fn();
    render(TimeWindowPicker, { props: { selection: ALL, onChange } });
    await openPopover(screen.getByLabelText('Time window'));

    await fireEvent.input(screen.getByLabelText(/From/), {
      target: { value: 'not-a-date' },
    });
    await fireEvent.click(screen.getByText('Apply'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
