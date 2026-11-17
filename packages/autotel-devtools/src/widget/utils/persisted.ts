// The one way widget code touches localStorage. Storage can be missing or
// throw (private mode, sandboxed iframe, SSR), and a preference that cannot
// be stored should still last the session rather than break the view.

/** The stored string, or undefined when absent or storage is unavailable. */
export function readStored(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Store a string; a no-op when storage is unavailable. */
export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* unavailable: the value lasts this session */
  }
}
