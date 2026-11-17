// src/widget/components/hoverCard.svelte.ts
//
// One hover card per list, anchored under the hovered cell: the waterfall's
// span rows and the trace list's operation names share it. Delayed on first
// entry so scanning down a list does not flash cards; moving between rows
// while one is open swaps immediately.

/**
 * The card's largest size: placement keeps that width inside the container
 * and opens above when there is less than that height below the cell.
 */
export interface CardSize {
  width: number;
  height: number;
}
const SPAN_CARD: CardSize = { width: 428, height: 240 };
const OPEN_DELAY = 250;

export interface CardPlacement {
  top: number;
  left: number;
  above: boolean;
}

/** Where a card for `cell` goes inside `root`. Pure, for the tests. */
export function placeCard(
  root: DOMRect,
  cell: DOMRect,
  size: CardSize = SPAN_CARD,
): CardPlacement {
  const below = root.bottom - cell.bottom;
  const above = below < size.height && cell.top - root.top > below;
  return {
    above,
    top: (above ? cell.top : cell.bottom) - root.top,
    left: Math.min(cell.left - root.left, Math.max(0, root.width - size.width)),
  };
}

export interface HoverCard<T> {
  /** The shown item and its placement, or null. */
  readonly card: (CardPlacement & { item: T }) | null;
  /** Inline style for the absolutely positioned card wrapper. */
  readonly style: string;
  /** Show `item` under `target`; null target hides. Delay defaults to the hover rule. */
  show(item: T, target: HTMLElement | null, delay?: number): void;
  hide(): void;
}

/** `root` is the positioned (`relative`) element the card is drawn in. */
export function useHoverCard<T>(
  root: () => HTMLElement | undefined,
  size: CardSize = SPAN_CARD,
): HoverCard<T> {
  let card = $state<(CardPlacement & { item: T }) | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;

  function hide() {
    clearTimeout(timer);
    card = null;
  }
  // A timer must not fire into an unmounted view.
  $effect(() => hide);

  return {
    get card() {
      return card;
    },
    get style() {
      if (!card) return '';
      return `top: ${card.top}px; left: ${card.left}px;${card.above ? ' transform: translateY(-100%);' : ''}`;
    },
    show(item, target, delay = card ? 0 : OPEN_DELAY) {
      const el = root();
      if (!target || !el) return hide();
      clearTimeout(timer);
      const next = {
        item,
        ...placeCard(
          el.getBoundingClientRect(),
          target.getBoundingClientRect(),
          size,
        ),
      };
      timer = setTimeout(() => (card = next), delay);
    },
    hide,
  };
}
