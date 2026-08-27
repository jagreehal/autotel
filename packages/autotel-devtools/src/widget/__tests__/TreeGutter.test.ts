/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import TreeGutter from '../components/TreeGutter.svelte';

describe('TreeGutter', () => {
  afterEach(cleanup);

  it('renders nothing but the container for a root row', () => {
    const { container } = render(TreeGutter, {
      props: { ancestorLines: [], isLast: true },
    });
    expect(container.querySelector('[data-testid="gutter-elbow"]')).toBeNull();
    expect(container.querySelector('[data-testid="gutter-tee"]')).toBeNull();
  });

  it('draws a tee for a root row that has siblings below', () => {
    const { container } = render(TreeGutter, {
      props: { ancestorLines: [], isLast: false },
    });
    expect(
      container.querySelector('[data-testid="gutter-tee"]'),
    ).not.toBeNull();
  });

  it('draws an elbow for a last child, so no line runs to a missing sibling', () => {
    const { container } = render(TreeGutter, {
      props: { ancestorLines: [true], isLast: true },
    });
    expect(
      container.querySelector('[data-testid="gutter-elbow"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="gutter-tee"]')).toBeNull();
  });

  it('draws one column per ancestor level', () => {
    const { container } = render(TreeGutter, {
      props: { ancestorLines: [true, false, true], isLast: true },
    });
    const lines = container.querySelectorAll('[data-testid="gutter-line"]');
    const blanks = container.querySelectorAll('[data-testid="gutter-blank"]');
    expect(lines).toHaveLength(2);
    expect(blanks).toHaveLength(1);
  });

  it('honours a custom indent width', () => {
    const { container } = render(TreeGutter, {
      props: { ancestorLines: [true], isLast: true, indent: 24 },
    });
    const column = container.querySelector('[data-testid="gutter-line"]');
    expect((column as HTMLElement).style.width).toBe('24px');
  });

  it('is hidden from assistive tech, since aria-level already conveys depth', () => {
    // Repeating the structure as a wall of nodes would make the row unreadable
    // to a screen reader without adding anything.
    render(TreeGutter, { props: { ancestorLines: [true], isLast: true } });
    expect(screen.getByTestId('tree-gutter').getAttribute('aria-hidden')).toBe(
      'true',
    );
  });
});
