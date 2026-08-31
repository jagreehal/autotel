/**
 * Frustration signals: the clicks that did nothing, and the clicks that came
 * after.
 *
 * A dead click is a bug report nobody filed. It is also the one browser signal
 * no tracing backend can produce on its own, for a structural reason: a click
 * that does nothing runs no code, issues no request, and opens no span. The
 * trace is empty precisely when the user is most stuck, and the absence looks
 * exactly like a page nobody visited.
 *
 * Both detectors are heuristics, and the thresholds below are the interesting
 * part — they are ported from PostHog's, which have been tuned against real
 * traffic. Loosening them turns this into a noise generator; a "dead click"
 * that fires on working buttons teaches people to ignore the signal.
 *
 * ## How a click is judged dead
 *
 * A click is queued as a candidate and re-examined about a second later.
 * Something-happened-fast wins; otherwise nothing-happened-in-time loses.
 *
 * **Gates** (never even a candidate): a non-element target or the `<html>`
 * node, the same node clicked again within a second, a modifier key held, an
 * anchor (following a link is a legitimate activation the DOM need not react
 * to), or a match for the caller's ignore selector.
 *
 * **Liveness** — any one, inside its window, means the click did something, so
 * the candidate is dropped: a DOM mutation under 2500ms, a scroll under 100ms,
 * a `selectionchange` under 100ms, or a visibility/focus change within 1000ms
 * either side of the click. Visibility and focus count on *both* sides because
 * a click that opens a new tab may only ever surface as this window losing
 * focus — and because a click that hides the tab suspends the check timer, so
 * the transition has to be recorded onto the candidate as it fires rather than
 * read from a shared timestamp that a later transition would overwrite.
 *
 * **Timeouts** — with no liveness signal, any one of these makes it dead: a
 * mutation but only after 2500ms, a scroll after 100ms, a selection change
 * after 100ms, or nothing at all within 2750ms (the backstop). Visibility and
 * focus are deliberately absent: they may only ever suppress.
 *
 * Touch (dead swipes) is not covered. It needs its own gesture tracking and an
 * exclusion for surfaces whose repaints are invisible to a MutationObserver —
 * canvas, video, WebGL — where a swipe can never be fairly judged.
 */

import { emitEvent } from './emit-event';
import { clickAttributes, widgetName } from './user-interaction';
import { AUTOTEL_WEB } from './semconv';

const DEFAULTS = {
  /** A mutation later than this is a timeout rather than a response. */
  mutationThresholdMs: 2500,
  scrollThresholdMs: 100,
  selectionThresholdMs: 100,
  /** Repeat clicks on one node inside this window are the same gesture. */
  repeatClickMs: 1000,
  /** Tab/window transitions this close to a click belong to it. */
  livenessWindowMs: 1000,
  /** How often queued candidates are re-examined. */
  checkIntervalMs: 1000,
  rageThresholdPx: 30,
  rageTimeoutMs: 1000,
  rageClickCount: 3,
} as const;

export interface DeadClickConfig {
  mutationThresholdMs?: number;
  scrollThresholdMs?: number;
  selectionThresholdMs?: number;
  /** Clicks on elements matching this selector are never judged. */
  ignoreSelector?: string;
  /** Judge clicks held with ctrl/meta/alt/shift. Off by default. */
  captureWithModifierKeys?: boolean;
}

export interface RageClickConfig {
  thresholdPx?: number;
  timeoutMs?: number;
  clickCount?: number;
}

export interface FrustrationConfig {
  debug: boolean;
  /** `false` disables dead-click detection. */
  deadClicks?: DeadClickConfig | false;
  /** `false` disables rage-click detection. */
  rage?: RageClickConfig | false;
}

interface Candidate {
  element: Element;
  x: number;
  y: number;
  timestamp: number;
  /** Recorded as the event fires, not computed later — see the module doc. */
  scrollDelayMs?: number;
  visibilityDelayMs?: number;
  focusDelayMs?: number;
}

/** A delay only counts as click-correlated inside the suppression window. */
function withinLivenessWindow(delay: number): number | undefined {
  return delay >= 0 && delay < DEFAULTS.livenessWindowMs ? delay : undefined;
}

function delaySince(
  clickAt: number,
  signalAt: number | undefined,
): number | undefined {
  return signalAt !== undefined && clickAt <= signalAt
    ? signalAt - clickAt
    : undefined;
}

function firedAfter(delay: number | undefined, threshold: number): boolean {
  return delay !== undefined && delay >= threshold;
}

function firedWithin(delay: number | undefined, threshold: number): boolean {
  return delay !== undefined && delay < threshold;
}

function emit(
  element: Element,
  event: { clientX?: number; clientY?: number },
  extra: Record<string, string | number>,
): void {
  emitEvent(AUTOTEL_WEB.CLICK_FRUSTRATION, {
    ...clickAttributes(element, event),
    ...extra,
  });
}

/**
 * Start watching for dead and rage clicks. Returns a teardown that removes
 * every listener and observer it installed.
 */
export function setupFrustrationSignals(config: FrustrationConfig): () => void {
  if (globalThis.document === undefined) return () => {};

  const dead =
    config.deadClicks === false ? undefined : (config.deadClicks ?? {});
  const rage = config.rage === false ? undefined : (config.rage ?? {});
  if (!dead && !rage) return () => {};

  const mutationThresholdMs =
    dead?.mutationThresholdMs ?? DEFAULTS.mutationThresholdMs;
  const scrollThresholdMs =
    dead?.scrollThresholdMs ?? DEFAULTS.scrollThresholdMs;
  const selectionThresholdMs =
    dead?.selectionThresholdMs ?? DEFAULTS.selectionThresholdMs;
  const absoluteThresholdMs = mutationThresholdMs * 1.1;

  const ragePx = rage?.thresholdPx ?? DEFAULTS.rageThresholdPx;
  const rageMs = rage?.timeoutMs ?? DEFAULTS.rageTimeoutMs;
  const rageCount = rage?.clickCount ?? DEFAULTS.rageClickCount;

  let candidates: Candidate[] = [];
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  let lastMutation: number | undefined;
  let lastSelectionChange: number | undefined;
  let lastVisibilityChange: number | undefined;
  let lastFocusChange: number | undefined;
  let lastClick: { element: Element; timestamp: number } | undefined;
  let burst: { x: number; y: number; timestamp: number }[] = [];

  function scheduleCheck(): void {
    if (checkTimer !== undefined || candidates.length === 0) return;
    checkTimer = setTimeout(checkCandidates, DEFAULTS.checkIntervalMs);
  }

  function checkCandidates(): void {
    checkTimer = undefined;
    const pending = candidates;
    candidates = [];

    for (const candidate of pending) {
      const now = Date.now();
      const mutationDelay = delaySince(candidate.timestamp, lastMutation);
      const selectionDelay = delaySince(
        candidate.timestamp,
        lastSelectionChange,
      );
      const absoluteDelay = now - candidate.timestamp;

      const alive =
        firedWithin(candidate.scrollDelayMs, scrollThresholdMs) ||
        firedWithin(mutationDelay, mutationThresholdMs) ||
        firedWithin(selectionDelay, selectionThresholdMs) ||
        // Already filtered to the suppression window when recorded, so their
        // presence alone is the verdict.
        candidate.visibilityDelayMs !== undefined ||
        candidate.focusDelayMs !== undefined;
      if (alive) continue;

      const verdict = firedAfter(candidate.scrollDelayMs, scrollThresholdMs)
        ? 'scroll'
        : firedAfter(mutationDelay, mutationThresholdMs)
          ? 'mutation'
          : firedAfter(selectionDelay, selectionThresholdMs)
            ? 'selection'
            : firedAfter(absoluteDelay, absoluteThresholdMs)
              ? 'absolute'
              : undefined;

      if (verdict) {
        emit(
          candidate.element,
          { clientX: candidate.x, clientY: candidate.y },
          {
            [AUTOTEL_WEB.CLICK_OUTCOME]: 'dead',
            [AUTOTEL_WEB.CLICK_VERDICT_SIGNAL]: verdict,
          },
        );
        if (config.debug) {
          console.debug(
            '[autotel-web] dead click:',
            widgetName(candidate.element),
            verdict,
          );
        }
      } else if (absoluteDelay < mutationThresholdMs) {
        // Undecided and still inside the window worth waiting out.
        candidates.push(candidate);
      }
    }
    scheduleCheck();
  }

  /** Record a signal that fired after the click, onto every waiting candidate. */
  function recordOnCandidates(field: keyof Candidate, at: number): void {
    for (const candidate of candidates) {
      if (candidate[field] !== undefined) continue;
      const delay = at - candidate.timestamp;
      const inWindow =
        field === 'scrollDelayMs' ? delay : withinLivenessWindow(delay);
      if (inWindow !== undefined && delay >= 0) {
        (candidate[field] as number | undefined) = delay;
      }
    }
  }

  function ignored(target: Element, event: MouseEvent): boolean {
    if (target === document.documentElement) return true;
    if (target.closest('a')) return true;
    if (dead?.ignoreSelector && target.closest(dead.ignoreSelector))
      return true;
    if (
      !dead?.captureWithModifierKeys &&
      (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
    ) {
      return true;
    }
    // The same node clicked again is the same gesture, not a second verdict.
    return (
      lastClick?.element === target &&
      Date.now() - lastClick.timestamp < DEFAULTS.repeatClickMs
    );
  }

  function onClick(event: MouseEvent): void {
    const target = event.target as Element | null;
    if (!target || typeof target.closest !== 'function') return;
    const now = Date.now();

    if (rage) {
      const previous = burst.at(-1);
      if (
        previous &&
        Math.abs(event.clientX - previous.x) +
          Math.abs(event.clientY - previous.y) <
          ragePx &&
        now - previous.timestamp < rageMs
      ) {
        burst.push({ x: event.clientX, y: event.clientY, timestamp: now });
        if (burst.length === rageCount) {
          emit(target, event, {
            [AUTOTEL_WEB.CLICK_OUTCOME]: 'rage',
            [AUTOTEL_WEB.CLICK_RAGE_COUNT]: burst.length,
          });
          if (config.debug) {
            console.debug('[autotel-web] rage click:', widgetName(target));
          }
          // Not reset: the burst keeps growing and the `=== rageCount` test
          // only holds once, so a long hammering session reports one event, not
          // one per click after the third.
        }
      } else {
        burst = [{ x: event.clientX, y: event.clientY, timestamp: now }];
      }
    }

    if (!dead) return;
    if (ignored(target, event)) return;
    lastClick = { element: target, timestamp: now };
    candidates.push({
      element: target,
      x: event.clientX,
      y: event.clientY,
      timestamp: now,
      // A tab/window transition just *before* the click is the click that woke
      // or refocused the page, and suppresses it the same way.
      visibilityDelayMs:
        lastVisibilityChange === undefined
          ? undefined
          : withinLivenessWindow(now - lastVisibilityChange),
      focusDelayMs:
        lastFocusChange === undefined
          ? undefined
          : withinLivenessWindow(now - lastFocusChange),
    });
    scheduleCheck();
  }

  const onScroll = (): void => recordOnCandidates('scrollDelayMs', Date.now());
  const onSelectionChange = (): void => {
    lastSelectionChange = Date.now();
  };
  const onVisibilityChange = (): void => {
    lastVisibilityChange = Date.now();
    recordOnCandidates('visibilityDelayMs', lastVisibilityChange);
  };
  const onFocusChange = (): void => {
    lastFocusChange = Date.now();
    recordOnCandidates('focusDelayMs', lastFocusChange);
  };

  document.addEventListener('click', onClick, { capture: true, passive: true });
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  document.addEventListener('selectionchange', onSelectionChange, {
    passive: true,
  });
  document.addEventListener('visibilitychange', onVisibilityChange, {
    passive: true,
  });
  window.addEventListener('focus', onFocusChange, { passive: true });
  window.addEventListener('blur', onFocusChange, { passive: true });

  let observer: MutationObserver | undefined;
  if (dead && typeof MutationObserver === 'function') {
    observer = new MutationObserver(() => {
      lastMutation = Date.now();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
  }

  return () => {
    document.removeEventListener('click', onClick, { capture: true });
    window.removeEventListener('scroll', onScroll, { capture: true });
    document.removeEventListener('selectionchange', onSelectionChange);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('focus', onFocusChange);
    window.removeEventListener('blur', onFocusChange);
    observer?.disconnect();
    if (checkTimer !== undefined) clearTimeout(checkTimer);
    checkTimer = undefined;
    candidates = [];
    burst = [];
  };
}
