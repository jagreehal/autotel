/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/svelte';
import QueryBar from '../components/QueryBar.svelte';

const noop = () => {};

describe('QueryBar', () => {
  afterEach(cleanup);

  it('completes observed query fields', async () => {
    const onInput = vi.fn();
    render(QueryBar, {
      props: {
        value: 'http.',
        onInput,
        onSubmit: vi.fn(),
        fields: ['http.method', 'http.route', 'service'],
      },
    });
    await fireEvent.focus(screen.getByRole('textbox'));
    await fireEvent.click(screen.getByRole('option', { name: 'http.method' }));
    expect(onInput).toHaveBeenCalledWith('http.method = ');
  });

  it('reports every keystroke', async () => {
    const onInput = vi.fn();
    render(QueryBar, { props: { value: '', onInput, onSubmit: noop } });

    await fireEvent.input(screen.getByLabelText('Query'), {
      target: { value: 'service = api' },
    });
    expect(onInput).toHaveBeenCalledWith('service = api');
  });

  it('shows no error for a valid query', () => {
    render(QueryBar, {
      props: { value: 'service = api', onInput: noop, onSubmit: noop },
    });
    expect(
      screen.getByLabelText('Query').getAttribute('aria-invalid'),
    ).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows no error for free text, which needs no field or operator', () => {
    render(QueryBar, {
      props: { value: 'checkout', onInput: noop, onSubmit: noop },
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('reports a syntax error without waiting for the server', () => {
    // The client runs the same grammar the server compiles with, so the error
    // appears on the keystroke that caused it.
    render(QueryBar, {
      props: { value: 'service =', onInput: noop, onSubmit: noop },
    });
    expect(screen.getByRole('status').textContent).toMatch(/value/i);
  });

  it('names the column so the error can be located in the text', () => {
    render(QueryBar, {
      props: { value: 'service =', onInput: noop, onSubmit: noop },
    });
    expect(screen.getByRole('status').textContent).toMatch(/column \d+/);
  });

  it('marks the input invalid and points at the message for assistive tech', () => {
    render(QueryBar, {
      props: { value: 'service =', onInput: noop, onSubmit: noop },
    });
    const input = screen.getByLabelText('Query');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe('query-error');
  });

  it('treats an empty query as valid rather than as an error state', () => {
    render(QueryBar, { props: { value: '', onInput: noop, onSubmit: noop } });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('submits on Enter when the query parses', async () => {
    const onSubmit = vi.fn();
    render(QueryBar, {
      props: { value: 'service = api', onInput: noop, onSubmit },
    });

    await fireEvent.keyDown(screen.getByLabelText('Query'), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('service = api');
  });

  it('does not submit an unparseable query on Enter', async () => {
    const onSubmit = vi.fn();
    render(QueryBar, {
      props: { value: 'service =', onInput: noop, onSubmit },
    });

    await fireEvent.keyDown(screen.getByLabelText('Query'), { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('clears on Escape', async () => {
    const onInput = vi.fn();
    const onSubmit = vi.fn();
    render(QueryBar, {
      props: { value: 'service = api', onInput, onSubmit },
    });

    await fireEvent.keyDown(screen.getByLabelText('Query'), { key: 'Escape' });
    expect(onInput).toHaveBeenCalledWith('');
    expect(onSubmit).toHaveBeenCalledWith('');
  });

  it('clears from the clear button', async () => {
    const onInput = vi.fn();
    render(QueryBar, {
      props: { value: 'service = api', onInput, onSubmit: noop },
    });

    await fireEvent.click(screen.getByLabelText('Clear query'));
    expect(onInput).toHaveBeenCalledWith('');
  });

  it('offers no clear button when there is nothing to clear', () => {
    render(QueryBar, { props: { value: '', onInput: noop, onSubmit: noop } });
    expect(screen.queryByLabelText('Clear query')).toBeNull();
  });

  it('falls back to a server error when the client grammar accepted the text', () => {
    render(QueryBar, {
      props: {
        value: 'service = api',
        onInput: noop,
        onSubmit: noop,
        serverErrors: [
          { message: 'Unknown field "srvice"', range: { from: 0, to: 6 } },
        ],
      },
    });
    expect(screen.getByRole('status').textContent).toMatch(/Unknown field/);
  });

  it('prefers the client error, which is the same grammar and arrives sooner', () => {
    render(QueryBar, {
      props: {
        value: 'service =',
        onInput: noop,
        onSubmit: noop,
        serverErrors: [
          { message: 'stale server error', range: { from: 0, to: 1 } },
        ],
      },
    });
    expect(screen.getByRole('status').textContent).not.toMatch(/stale/);
  });

  it('disables spellcheck and autocorrect, which fight a query language', () => {
    render(QueryBar, { props: { value: '', onInput: noop, onSubmit: noop } });
    const input = screen.getByLabelText('Query');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('autocomplete')).toBe('off');
  });
});
