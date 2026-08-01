// Shared fetch for every backend adapter.
//
// Observability vendors rate-limit their read APIs aggressively — Logfire
// returns 429 after ~10 queries/minute, LangSmith after 10 requests/10s — so a
// burst of UI queries hits one routinely. Retrying here means each adapter
// doesn't have to, and a transient 429 never surfaces to the user as a failure.

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

/** Delay before the next attempt: `Retry-After` if the server sent one, else exponential. */
function retryDelayMs(res: Response, attempt: number): number {
  const header = res.headers?.get?.('Retry-After');
  if (header !== null && header !== undefined && header.trim() !== '') {
    const seconds = Number(header);
    // `Retry-After` is either delta-seconds or an HTTP date.
    const ms = Number.isFinite(seconds)
      ? seconds * 1000
      : Date.parse(header) - Date.now();
    if (Number.isFinite(ms) && ms >= 0) return Math.min(ms, MAX_BACKOFF_MS);
  }
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * `fetch` that transparently rides out backend rate limiting.
 *
 * Retries only on 429 — other failures are returned to the caller unchanged so
 * each adapter keeps its own error message. Gives up after {@link MAX_ATTEMPTS},
 * returning the final rate-limited response for the caller to report.
 */
export async function backendFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  let res = await fetch(url, init);
  for (
    let attempt = 0;
    res.status === 429 && attempt < MAX_ATTEMPTS - 1;
    attempt++
  ) {
    await sleep(retryDelayMs(res, attempt), init.signal);
    res = await fetch(url, init);
  }
  return res;
}
