/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/svelte';
import TailPill from '../components/TailPill.svelte';

describe('TailPill', () => {
  afterEach(cleanup);

  it('shows the pending count while frozen', () => {
    render(TailPill, { props: { count: 12, live: false, onResume: () => {} } });
    expect(screen.getByRole('button').textContent).toContain('12 new');
  });

  it('renders nothing while live', () => {
    // Live means the rows are already on screen — a pill would be lying.
    render(TailPill, { props: { count: 9, live: true, onResume: () => {} } });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing when frozen with nothing pending', () => {
    render(TailPill, { props: { count: 0, live: false, onResume: () => {} } });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('saturates the label past 999 rather than showing a useless figure', () => {
    render(TailPill, {
      props: { count: 4821, live: false, onResume: () => {} },
    });
    expect(screen.getByRole('button').textContent).toContain('999+ new');
  });

  it('calls onResume when clicked', async () => {
    const onResume = vi.fn();
    render(TailPill, { props: { count: 3, live: false, onResume } });

    await fireEvent.click(screen.getByRole('button'));
    expect(onResume).toHaveBeenCalledOnce();
  });

  it('announces politely, so a screen reader is not interrupted by arrivals', () => {
    render(TailPill, { props: { count: 3, live: false, onResume: () => {} } });
    expect(screen.getByRole('button').getAttribute('aria-live')).toBe('polite');
  });

  it('explains what activating it will do', () => {
    render(TailPill, { props: { count: 3, live: false, onResume: () => {} } });
    expect(screen.getByRole('button').getAttribute('title')).toMatch(/follow/i);
  });
});
