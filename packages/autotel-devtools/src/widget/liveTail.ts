/**
 * Live-tail freeze state.
 *
 * The viewer streams by default, which is most of its value during local
 * development — but a list that reorders while you are reading it is worse than
 * one that does not update at all. So the view freezes the moment the user does
 * something a reorder would disturb, and counts new matches instead of
 * inserting them.
 *
 * Freezing is a *consequence*, not a mode: there is no Live/Search toggle to
 * get wrong, and no "why is nothing updating" state to explain. Each reason is
 * tracked independently, because they overlap — clearing a selection while a
 * query is still active must not resume the stream.
 *
 * The one explicit control is the pill: `resumed` clears every reason at once,
 * because "catch me up" means exactly that.
 */

export interface TailState {
  /** Independent reasons the view is currently held. Empty ⇒ live. */
  reasons: {
    query: boolean;
    scrolled: boolean;
    selected: boolean;
    window: boolean;
  };
  /** Matches that arrived while frozen. Meaningless while live. */
  pending: number;
}

export type TailAction =
  | { type: 'query-changed'; query: string }
  | { type: 'scrolled'; atTop: boolean }
  | { type: 'row-selected' }
  | { type: 'row-deselected' }
  | { type: 'window-changed'; bounded: boolean }
  | { type: 'arrived'; count: number }
  | { type: 'resumed' };

export function initialTail(): TailState {
  return {
    reasons: { query: false, scrolled: false, selected: false, window: false },
    pending: 0,
  };
}

export function isLive(state: TailState): boolean {
  return !Object.values(state.reasons).some(Boolean);
}

export function pendingCount(state: TailState): number {
  return isLive(state) ? 0 : state.pending;
}

export function reduceTail(state: TailState, action: TailAction): TailState {
  switch (action.type) {
    case 'query-changed':
      // An empty query is not a filter, so it releases this reason rather than
      // leaving the view frozen on a box the user has just cleared.
      return withReason(state, 'query', action.query.trim().length > 0);

    case 'scrolled':
      return withReason(state, 'scrolled', !action.atTop);

    case 'row-selected':
      return withReason(state, 'selected', true);

    case 'row-deselected':
      return withReason(state, 'selected', false);

    case 'window-changed':
      return withReason(state, 'window', action.bounded);

    case 'arrived': {
      // While live the rows are already on screen; there is nothing pending.
      if (isLive(state)) return state;
      return {
        ...state,
        pending: Math.max(0, state.pending + action.count),
      };
    }

    case 'resumed':
      // Deliberately clears *every* reason, including a query the user still
      // has typed: the pill means "show me the newest matches now".
      return initialTail();
  }
}

/**
 * Set or clear one reason, resetting the pending count when the view goes live.
 *
 * Resetting on the transition matters: a stale count shown the instant the view
 * resumes would claim there are rows to catch up on that are already visible.
 */
function withReason(
  state: TailState,
  reason: keyof TailState['reasons'],
  held: boolean,
): TailState {
  if (state.reasons[reason] === held) return state;
  const next: TailState = {
    reasons: { ...state.reasons, [reason]: held },
    pending: state.pending,
  };
  if (isLive(next)) next.pending = 0;
  return next;
}
