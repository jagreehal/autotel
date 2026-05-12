/**
 * HTTP client for sending webhook events
 *
 * Provides proper error handling, timeout support, and response parsing
 */

export type HttpRetryOptions = {
  retries?: number;
  delayMs?: number;
};

export type HttpClientOptions = {
  timeoutMs?: number;
  retry?: HttpRetryOptions;
};

export type HttpSuccess<T = unknown> = {
  ok: true;
  status: number;
  data: T | null;
};

export type HttpNetworkError = {
  ok: false;
  kind: 'network';
  timedOut: boolean;
  cause: Error;
};

export type HttpStatusError<E = unknown> = {
  ok: false;
  kind: 'http';
  status: number;
  statusText: string;
  body: E;
};

export type HttpResult<T = unknown, E = unknown> =
  | HttpSuccess<T>
  | HttpNetworkError
  | HttpStatusError<E>;

export type HttpRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim().length === 0) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'AbortError' || error.name === 'TimeoutError';
}

/**
 * Create an HTTP client with timeout and error handling
 *
 * @param options Configuration for timeout and retry behavior
 * @returns HTTP client with request method
 *
 * @example
 * ```typescript
 * const client = createHttpClient({ timeoutMs: 5000 })
 * const result = await client.request('https://example.com', {
 *   method: 'POST',
 *   body: JSON.stringify({ event: 'test' })
 * })
 * ```
 */
export function createHttpClient(options: HttpClientOptions = {}) {
  const defaultTimeoutMs = options.timeoutMs ?? 30_000;

  return {
    async request<T = unknown, E = unknown>(
      url: string,
      requestOptions: HttpRequestOptions = {},
    ): Promise<HttpResult<T, E>> {
      const timeoutMs = requestOptions.timeoutMs ?? defaultTimeoutMs;
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method: requestOptions.method ?? 'GET',
          headers: requestOptions.headers,
          body: requestOptions.body,
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = (await parseBody(response)) as E;
          return {
            ok: false,
            kind: 'http',
            status: response.status,
            statusText: response.statusText,
            body,
          };
        }

        const data = (await parseBody(response)) as T;
        return { ok: true, status: response.status, data };
      } catch (error) {
        const cause = error instanceof Error ? error : new Error(String(error));
        return {
          ok: false,
          kind: 'network',
          timedOut: isTimeoutError(error),
          cause,
        };
      } finally {
        clearTimeout(timeoutHandle);
      }
    },
  };
}
