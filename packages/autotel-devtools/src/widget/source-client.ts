// Fetching source lines for a stack frame from the receiver.
//
// The base URL is derived from the live WebSocket URL rather than `location`:
// in embedded mode the widget runs inside the developer's own app, so the page
// origin is the app's, not the receiver's.

import type { StackFrame } from '../server/parse-stack';
import type { SourceWindow } from '../server/source-file';

export type SourceLoader = (
  frame: StackFrame,
  context: number,
) => Promise<SourceWindow | null>;

/** `ws://host:port/ws` → `http://host:port`. `null` if it is not a ws URL. */
export function httpBaseFromWsUrl(wsUrl: string): string | null {
  try {
    const url = new URL(wsUrl);
    if (url.protocol === 'ws:') return `http://${url.host}`;
    if (url.protocol === 'wss:') return `https://${url.host}`;
    return null;
  } catch {
    return null;
  }
}

/**
 * A loader bound to one receiver.
 *
 * `fetchImpl` is injected so the caller — and the tests — decide what performs
 * the request. Every failure resolves to `null`: a missing source window is a
 * normal outcome (the file may be outside the project, generated, or the route
 * disabled), not an error the UI should handle differently in each case.
 */
export function createSourceLoader(
  base: string,
  fetchImpl: typeof fetch = fetch,
): SourceLoader {
  return async (frame, context) => {
    // Dependency and runtime frames have no file we would be allowed to read,
    // so skip the round trip entirely.
    if (frame.kind !== 'app') return null;

    const url = new URL('/source', base);
    url.searchParams.set('file', frame.file);
    url.searchParams.set('line', String(frame.line));
    url.searchParams.set('context', String(context));

    try {
      const res = await fetchImpl(url.toString());
      if (!res.ok) return null;
      return (await res.json()) as SourceWindow;
    } catch {
      return null;
    }
  };
}

// Views reached through the tab bar get no props, so the app-wide loader is
// configured once from `Widget.svelte` (which is the only place that knows the
// WebSocket URL) and read from here.
let configured: SourceLoader | null = null;

/** Point the shared loader at a receiver, or `null` to disable source lookup. */
export function configureSourceLoader(base: string | null): void {
  configured = base === null ? null : createSourceLoader(base);
}

/** The shared loader. Resolves `null` until configured — never throws. */
export const loadSourceWindow: SourceLoader = (frame, context) =>
  configured === null ? Promise.resolve(null) : configured(frame, context);
