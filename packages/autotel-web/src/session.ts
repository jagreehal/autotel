/**
 * Browser session identity.
 *
 * Everything this package already captures — web vitals, long tasks, network
 * timing, clicks, errors — is emitted as an independent span. Without a session
 * id none of it can be stitched back into "what this person was doing when it
 * broke", which is the question every RUM backend (and every support ticket)
 * actually asks. `session.id` is the join key they all use.
 *
 * Tab-scoped by design: `sessionStorage` survives a reload but not a new tab,
 * which is the same boundary users perceive as "a visit". The id is a random
 * UUID with nothing derived from the person, so it identifies a visit rather
 * than a visitor.
 *
 * Minting an id is the fallback, not the goal. Where another SDK on the page
 * already owns a session — a replay recorder, a product-analytics client — its
 * id is the one worth carrying, because that is what everything else on the
 * page is keyed on. Hand it in through `session.id` and this module steps
 * aside.
 */

const STORAGE_KEY = 'autotel.session';

/** Idle gap that ends a session. 30 minutes is the analytics convention. */
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

interface SessionState {
  id: string;
  lastActivity: number;
  /**
   * Set only when a session just rolled over, and cleared once emitted:
   * `session.previous_id` exists to link the new session to the old one on the
   * first span, not to ride along on every span for the next half hour.
   */
  previousId?: string;
}

export type SessionIdProvider = () => string | undefined;

let enabled = true;
let timeoutMs = DEFAULT_TIMEOUT_MS;
let idProvider: SessionIdProvider | undefined;
let state: SessionState | undefined;

function newId(): string {
  // `randomUUID` needs a secure context; a page served over plain HTTP still
  // deserves a session id, it just does not need a cryptographic one.
  if (globalThis.crypto !== undefined && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 14)}`;
}

/**
 * `sessionStorage` throws outright in some privacy modes and in sandboxed
 * iframes, so every access is guarded and falls back to memory: a session id
 * that lives only for this page is still better than a thrown error inside a
 * fetch handler.
 */
function readStored(): SessionState | undefined {
  try {
    const raw = globalThis.sessionStorage?.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    // SAFETY: this key is written by saveSession() below and by nothing else;
    // both fields are checked on the next lines before the value is trusted.
    const parsed = JSON.parse(raw) as Partial<SessionState>;
    if (
      typeof parsed.id !== 'string' ||
      typeof parsed.lastActivity !== 'number'
    )
      return undefined;
    return { id: parsed.id, lastActivity: parsed.lastActivity };
  } catch {
    return undefined;
  }
}

function writeStored(next: SessionState): void {
  try {
    globalThis.sessionStorage?.setItem(
      STORAGE_KEY,
      JSON.stringify({ id: next.id, lastActivity: next.lastActivity }),
    );
  } catch {
    // Memory-only session; nothing to recover.
  }
}

/**
 * Configure session tracking. Called by `init()` / `initFull()`; exported so a
 * host app can turn it off or lengthen the window without re-initializing.
 */
export function configureSession(
  config: false | { timeoutMs?: number; id?: SessionIdProvider } = {},
): void {
  if (config === false) {
    enabled = false;
    idProvider = undefined;
    state = undefined;
    return;
  }
  enabled = true;
  timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  idProvider = config.id;
}

/**
 * Current session attributes, refreshing the idle timer as a side effect.
 * Returns `undefined` when disabled or off-browser, so callers can spread it
 * unconditionally.
 */
export function getSessionAttributes(): Record<string, string> | undefined {
  if (!enabled || globalThis.window === undefined) return undefined;

  // A provider owns its own lifecycle — rollover, storage, the lot — so its id
  // is returned as-is and never written to `sessionStorage`, where a stale copy
  // could outlive the session it came from. A provider that is still starting
  // up returns nothing, and rather than emit spans with no session at all, the
  // locally minted id below covers the gap.
  const provided = idProvider?.();
  if (provided !== undefined && provided.length > 0) {
    return { 'session.id': provided };
  }

  const now = Date.now();
  const restored = state ?? readStored();

  if (!restored) {
    state = { id: newId(), lastActivity: now };
  } else if (now - restored.lastActivity > timeoutMs) {
    state = { id: newId(), lastActivity: now, previousId: restored.id };
  } else {
    state = { ...restored, lastActivity: now };
  }

  writeStored(state);

  const previousId = state.previousId;
  state.previousId = undefined;
  return previousId
    ? { 'session.id': state.id, 'session.previous_id': previousId }
    : { 'session.id': state.id };
}

/** @internal Reset for testing */
export function resetSessionForTesting(): void {
  enabled = true;
  timeoutMs = DEFAULT_TIMEOUT_MS;
  idProvider = undefined;
  state = undefined;
  try {
    globalThis.sessionStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored.
  }
}
