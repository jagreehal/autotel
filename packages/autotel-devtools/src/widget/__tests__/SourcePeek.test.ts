/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import SourcePeek from '../components/SourcePeek.svelte';
import type { SourceWindow } from '../../server/source-file';

const WINDOW: SourceWindow = {
  file: 'src/carrier.ts',
  line: 42,
  startLine: 40,
  lines: [
    'const quote = await carrier.quote(shipment);',
    'if (!quote) {',
    '  throw new TypeError("no quote");',
    '}',
    'return quote;',
  ],
};

afterEach(cleanup);

describe('SourcePeek', () => {
  it('numbers the lines from the real start of the window, not from one', () => {
    render(SourcePeek, { window: WINDOW });

    expect(screen.getByText('40')).toBeTruthy();
    expect(screen.getByText('44')).toBeTruthy();
    expect(screen.queryByText('1')).toBeNull();
  });

  it('marks the line the frame pointed at', () => {
    render(SourcePeek, { window: WINDOW });

    const marked = document.querySelectorAll('[aria-current="true"]');
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toContain('throw new TypeError');
  });

  // Guards against the component trimming each line. Whether the indentation
  // then *renders* is a CSS claim (`whitespace-pre`) that jsdom cannot see —
  // textContent keeps the spaces either way — so that belongs to the story
  // catalogue, not here.
  it('emits each line verbatim rather than trimming it', () => {
    render(SourcePeek, { window: WINDOW });

    // getByText collapses whitespace by default, which would pass on a trimmed
    // line — so compare the raw text node.
    expect(
      screen.getByText('  throw new TypeError("no quote");', {
        normalizer: (text) => text,
      }),
    ).toBeTruthy();
  });

  it('says why there is nothing to show when the file could not be read', () => {
    render(SourcePeek, { window: null });

    expect(screen.getByText(/could not be read/i)).toBeTruthy();
  });
});
