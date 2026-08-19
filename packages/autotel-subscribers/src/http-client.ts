/** A parsed response body: whatever JSON the endpoint answered with. */
export type JsonBody =
  | string
  | number
  | boolean
  | null
  | Array<JsonBody>
  | { [key: string]: JsonBody };
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
  HttpSuccess<T> | HttpNetworkError | HttpStatusError<E>;

export type HttpRequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

async function parseBody(response: Response): Promise<JsonBody> {
  const text = await response.text();
  if (text.trim().length === 0) return null;

  try {
    // SAFETY: JSON.parse is typed `any`; asserting it to JsonBody says what a
    // successfully parsed body can be, and the caller narrows from there.
    return JSON.parse(text) as JsonBody;
  } catch {
    return text;
  }
}

function isTimeoutError(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  return cause.name === 'AbortError' || cause.name === 'TimeoutError';
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
          // SAFETY: the caller names the error shape its endpoint answers with; a
          // body that does not match still lands here, and only what the caller reads
          // from it is ever touched.
          const body = (await parseBody(response)) as E;
          return {
            ok: false,
            kind: 'http',
            status: response.status,
            statusText: response.statusText,
            body,
          };
        }

        // SAFETY: as above - the caller names the success shape.
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
