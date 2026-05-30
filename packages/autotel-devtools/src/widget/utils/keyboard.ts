/**
 * Returns true when the currently focused element accepts text input.
 * Used as a guard to prevent global keyboard shortcuts from firing while the
 * user is typing in a search box, textarea, or contenteditable element.
 */
export function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    !!(el as HTMLElement).isContentEditable
  );
}

/**
 * Keyboard handler that activates a click-like action on Enter or Space, for
 * elements given `role="button"` that aren't native buttons (e.g. clickable
 * rows/nodes). Prevents the Space-scroll default. Pairs with `tabindex="0"`.
 */
export function activateOnKey(handler: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  };
}

/**
 * True when running on macOS. Used to display platform-appropriate key labels
 * (e.g. "Option+Delete" on Mac vs "Alt+Delete" on Windows/Linux).
 */
export const isMac: boolean =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform);
