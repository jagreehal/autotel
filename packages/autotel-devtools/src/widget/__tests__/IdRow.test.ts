/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import IdRow from '../components/IdRow.svelte';

describe('IdRow', () => {
  afterEach(cleanup);

  it('renders a plain (non-link) value when no onActivate is given', () => {
    render(IdRow, { props: { label: 'Span ID', value: 'abc123' } });
    // The value is shown, but not as a clickable button.
    expect(screen.getByText('abc123').tagName).toBe('CODE');
    // Only the copy button is present.
    expect(screen.getByTitle('Copy to clipboard')).toBeTruthy();
  });

  it('renders the value as a link button when onActivate is provided', () => {
    render(IdRow, {
      props: {
        label: 'Parent Span ID',
        value: 'parent-1',
        onActivate: () => {},
        activateTitle: 'Go to parent span',
      },
    });
    const link = screen.getByTitle('Go to parent span');
    expect(link.tagName).toBe('BUTTON');
    expect(link.textContent?.trim()).toBe('parent-1');
  });

  it('calls onActivate when the link is clicked', async () => {
    const onActivate = vi.fn();
    render(IdRow, {
      props: { label: 'Trace ID', value: 't1', onActivate, activateTitle: 'Go' },
    });
    screen.getByTitle('Go').click();
    expect(onActivate).toHaveBeenCalledOnce();
  });
});
