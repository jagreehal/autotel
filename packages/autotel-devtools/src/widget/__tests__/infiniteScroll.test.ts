/**
 * @vitest-environment jsdom
 *
 * Infinite-scroll sentinel contract.
 *
 * Two failure modes drive these tests, and both are the kind that only show up
 * with real data: firing repeatedly while the sentinel stays visible pages a
 * list to its end in a tight loop, and failing to re-arm after a page loads
 * stops paging after the first one.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { infiniteScroll } from '../utils/infiniteScroll';

/** Capture the observer callback so tests can drive intersection directly. */
let trigger: ((entries: Array<{ isIntersecting: boolean }>) => void) | null;
let disconnected = false;

beforeEach(() => {
  trigger = null;
  disconnected = false;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(
        callback: (entries: Array<{ isIntersecting: boolean }>) => void,
      ) {
        trigger = callback;
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
      unobserve() {}
    },
  );
});

afterEach(() => vi.unstubAllGlobals());

const intersect = (isIntersecting: boolean) => trigger?.([{ isIntersecting }]);

describe('infiniteScroll', () => {
  it('fires when the sentinel comes into view', () => {
    const onReach = vi.fn();
    infiniteScroll(document.createElement('div'), { onReach });

    intersect(true);
    expect(onReach).toHaveBeenCalledOnce();
  });

  it('does not fire again while the sentinel stays visible', () => {
    // Appending a short page can leave the sentinel on screen; firing again
    // would page the list to its end in a loop.
    const onReach = vi.fn();
    infiniteScroll(document.createElement('div'), { onReach });

    intersect(true);
    intersect(true);
    intersect(true);
    expect(onReach).toHaveBeenCalledOnce();
  });

  it('fires again after the sentinel leaves and returns', () => {
    const onReach = vi.fn();
    infiniteScroll(document.createElement('div'), { onReach });

    intersect(true);
    intersect(false);
    intersect(true);
    expect(onReach).toHaveBeenCalledTimes(2);
  });

  it('does not fire while disabled', () => {
    const onReach = vi.fn();
    infiniteScroll(document.createElement('div'), { onReach, disabled: true });

    intersect(true);
    expect(onReach).not.toHaveBeenCalled();
  });

  it('re-arms when loading finishes, even if the sentinel never left view', () => {
    // Without this the list stops paging after the first page whenever the
    // sentinel remains on screen.
    const onReach = vi.fn();
    const action = infiniteScroll(document.createElement('div'), {
      onReach,
      disabled: true,
    });

    intersect(true);
    expect(onReach).not.toHaveBeenCalled();

    action.update?.({ onReach, disabled: false });
    intersect(true);
    expect(onReach).toHaveBeenCalledOnce();
  });

  it('uses the newest callback after an update', () => {
    const first = vi.fn();
    const second = vi.fn();
    const action = infiniteScroll(document.createElement('div'), {
      onReach: first,
    });

    action.update?.({ onReach: second });
    intersect(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('disconnects the observer on destroy', () => {
    const action = infiniteScroll(document.createElement('div'), {
      onReach: () => {},
    });
    action.destroy?.();
    expect(disconnected).toBe(true);
  });

  it('degrades to doing nothing where IntersectionObserver is absent', () => {
    // Mounting must not throw; the list still works with its explicit control.
    vi.stubGlobal('IntersectionObserver', undefined);
    expect(() =>
      infiniteScroll(document.createElement('div'), { onReach: () => {} }),
    ).not.toThrow();
  });
});
