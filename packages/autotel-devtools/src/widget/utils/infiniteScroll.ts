/**
 * Infinite-scroll sentinel, as a Svelte action.
 *
 * Attach to an element placed at the end of a list; when it scrolls into view,
 * `onReach` fires and the next page is fetched.
 *
 * Uses `IntersectionObserver` rather than a scroll handler: a scroll listener
 * fires on every frame of a flick and has to be throttled, and it needs to know
 * the scroll container's height, which a component that only owns the sentinel
 * has no business reading.
 *
 * Two guards matter. `onReach` is not called again until the sentinel has left
 * the viewport and returned — otherwise appending a short page leaves the
 * sentinel still visible and the list pages itself to the end in a tight loop.
 * And nothing fires while `disabled` is set, so a list that is loading or has no
 * further pages cannot queue up duplicate requests.
 */

export interface InfiniteScrollOptions {
  onReach: () => void;
  /** Suppress firing — while a page is in flight, or when there are no more. */
  disabled?: boolean;
  /** Distance ahead of the viewport to start loading. */
  rootMargin?: string;
  /** Scroll container. Defaults to the viewport. */
  root?: Element | null;
}

export interface ActionReturn<T> {
  update?: (options: T) => void;
  destroy?: () => void;
}

export function infiniteScroll(
  node: Element,
  options: InfiniteScrollOptions,
): ActionReturn<InfiniteScrollOptions> {
  let current = options;
  // Latched while the sentinel is visible, so one continuous appearance yields
  // exactly one `onReach`.
  let armed = true;

  // Not every environment provides IntersectionObserver (jsdom without a
  // polyfill, for one). Degrade to doing nothing rather than throwing on mount:
  // the list still works, it just needs its "load more" pressed.
  if (typeof IntersectionObserver === 'undefined') {
    return {
      update: (next) => {
        current = next;
      },
    };
  }

  const observer = new IntersectionObserver(
    (entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;

      if (!entry.isIntersecting) {
        // Left the viewport — ready to fire again next time it returns.
        armed = true;
        return;
      }
      if (!armed || current.disabled) return;
      armed = false;
      current.onReach();
    },
    { root: current.root ?? null, rootMargin: current.rootMargin ?? '200px' },
  );

  observer.observe(node);

  return {
    update(next: InfiniteScrollOptions) {
      const wasDisabled = current.disabled;
      current = next;
      // Re-arm when a page finishes loading: the sentinel may never have left
      // the viewport, and without this the list would stop paging after one.
      if (wasDisabled && !next.disabled) armed = true;
    },
    destroy() {
      observer.disconnect();
    },
  };
}
