/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, fireEvent, screen } from '@testing-library/svelte';
import StackFrameList from '../components/StackFrameList.svelte';
import { parseStackTrace } from '../../server/parse-stack';

// Built by the real parser from a real stack, so these frames cannot drift into
// a shape V8 never produces.
const STACK =
  'TypeError: cannot read property x of undefined\n' +
  '    at deep (file:///proj/src/app.ts:2:9)\n' +
  '    at emitErrorAndClose (/proj/node_modules/ws/lib/websocket.js:1060:13)\n' +
  '    at ClientRequest.emit (node:events:509:28)';

const FRAMES = parseStackTrace(STACK);

afterEach(cleanup);

describe('StackFrameList', () => {
  it('shows each frame with its function and position', () => {
    render(StackFrameList, { frames: FRAMES });

    expect(screen.getByText('deep')).toBeTruthy();
    expect(screen.getByText('/proj/src/app.ts:2:9')).toBeTruthy();
    expect(screen.getByText('ClientRequest.emit')).toBeTruthy();
  });

  it('offers only app frames as openable, since the rest have nothing useful to show', () => {
    const onselect = vi.fn();
    render(StackFrameList, { frames: FRAMES, onselect });

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);

    fireEvent.click(buttons[0]);
    expect(onselect).toHaveBeenCalledWith(
      expect.objectContaining({ file: '/proj/src/app.ts', line: 2 }),
    );
  });

  it('labels why a frame is not your code', () => {
    render(StackFrameList, { frames: FRAMES });

    expect(screen.getByText('node_modules')).toBeTruthy();
    expect(screen.getByText('runtime')).toBeTruthy();
  });
});
