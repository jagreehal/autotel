/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import RunTraceView from '../components/genai/RunTraceView.svelte';
import type { TraceNode } from '../genai/trace';

const node = (id: string, startMs: number): TraceNode => ({
  id,
  kind: 'tool',
  label: id,
  depth: 0,
  startMs,
  durationMs: 10,
  children: [],
});

// jsdom lays nothing out, so it has no scrollIntoView.
Element.prototype.scrollIntoView = () => {};

describe('RunTraceView', () => {
  afterEach(cleanup);

  it('keeps the keyboard cursor on its span when rows arrive above it', async () => {
    const view = render(RunTraceView, {
      props: { nodes: [node('a', 10), node('b', 20)], now: 100 },
    });
    const tree = screen.getByRole('tree');
    await fireEvent.keyDown(tree, { key: 'ArrowDown' });
    await fireEvent.keyDown(tree, { key: 'ArrowDown' });
    const active = () =>
      document
        .getElementById(tree.getAttribute('aria-activedescendant')!)
        ?.getAttribute('aria-label');
    expect(active()).toContain('b');

    await view.rerender({
      nodes: [node('first', 0), node('a', 10), node('b', 20)],
      now: 100,
    });
    expect(active()).toContain('b');
  });
});
