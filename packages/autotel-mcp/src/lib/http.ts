// Shared HTTP for read backends.
//
// Localhost backends (Jaeger, Tempo, Prometheus, Loki) rarely rate-limit, but
// hosted vendor read APIs do so aggressively — on the order of ten queries a
// minute — and an investigation naturally fires bursts. Retrying 429 here means
// a rate limit shows up as a slightly slower answer rather than a failed
// investigation. Nothing else is retried: a 500 or a 404 is the caller's to
// report, and silently repeating a non-idempotent failure would be worse.

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10_000;

/** Delay before the next attempt: `Retry-After` if the server sent one, else exponential. */
function retryDelayMs(response: Response, attempt: number): number {
  const header = response.headers?.get?.('Retry-After');
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

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `fetch` that transparently rides out backend rate limiting. */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let response = await fetch(url, init);
  for (
    let attempt = 0;
    response.status === 429 && attempt < MAX_ATTEMPTS - 1;
    attempt++
  ) {
    await sleep(retryDelayMs(response, attempt));
    response = await fetch(url, init);
  }
  return response;
}

/**
 * Carries the status code so a backend can turn a bare status into advice.
 * The message is unchanged, so existing callers keep reading the same text.
 */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
  }
}

async function parseOrThrow<T>(response: Response, url: string): Promise<T> {
  if (!response.ok) {
    throw new HttpError(response.status, url);
  }
  return (await response.json()) as T;
}

export async function jsonGet<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetchWithRetry(url, {
    ...init,
    headers: {
      accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  return parseOrThrow<T>(response, url);
}

/** POST a JSON body. Used by the query-language backends (Logfire SQL, Honeycomb, Datadog). */
export async function jsonPost<T>(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  init?: RequestInit,
): Promise<T> {
  const response = await fetchWithRetry(url, {
    ...init,
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      ...headers,
      ...(init?.headers ?? {}),
    },
    body: JSON.stringify(body),
  });
  return parseOrThrow<T>(response, url);
}
