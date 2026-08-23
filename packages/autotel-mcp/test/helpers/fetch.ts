/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-known-value-widening -- Test helpers that build a Response from any JSON body the test wants to serve. */

/**
 * Stubbing `fetch` for the backend adapters.
 *
 * Each adapter is exercised by installing a fetch that answers with a canned
 * body and then asserting on what it was called with. Building the stub here
 * means the one assertion that makes it possible - vitest's mock type is not
 * the DOM's `fetch` - is stated once, next to the reason.
 */
import { vi, type Mock } from 'vitest';

/** A JSON body a stubbed endpoint answers with. */
export type ResponseBody =
  | string
  | number
  | boolean
  | null
  | Array<ResponseBody>
  | { [key: string]: ResponseBody };

/** A fetch spy that answers every call with the same JSON body. */
export function respondWith(body: ResponseBody, status = 200): Mock {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

/** Installs a spy as the global fetch and hands it back. */
export function installFetch(spy: Mock): typeof fetch {
  // A vitest mock is not the DOM's fetch type, but the adapters call only
  // fetch(url, init) and read `ok`, `status`, `headers` and `json()` off what
  // it resolves to - which is what respondWith provides.
  Object.assign(globalThis, { fetch: spy });
  return globalThis.fetch;
}

/** The url, init and parsed body of a recorded call. */
export function recordedCall(
  spy: Mock,
  index = 0,
): {
  url: string;
  init: RequestInit;
  headers: RequestInit['headers'];
  body: string | undefined;
} {
  const [url, init] = spy.mock.calls[index] ?? [];
  // SAFETY: the second fetch argument is RequestInit; the mock records what
  // the code under test passed, and an absent init reads as an empty one.
  const request = (init ?? {}) as RequestInit;
  return {
    url: String(url),
    init: request,
    headers: request.headers,
    body: request.body === undefined ? undefined : String(request.body),
  };
}

/** The url a fetch call was made with, whatever form the caller used. */
export function urlOf(input: Parameters<typeof fetch>[0]): string {
  return String(input);
}

/**
 * Installs a fetch that answers from a handler, for the tests that vary their
 * response by url. The handler receives the url already resolved to a string.
 */
export function installFetchHandler(
  handler: (url: string) => Response | Promise<Response>,
): void {
  // SAFETY: the code under test calls fetch(url) and reads a Response; this
  // supplies a real Response, so nothing else of the fetch surface is reached.
  globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) =>
    handler(urlOf(input))) as typeof fetch;
}

/**
 * The JSON body a recorded call was made with, parsed back.
 *
 * SAFETY: the caller passes the shape it is about to assert on; the request
 * body is JSON this same test's backend built, so a mismatch shows up as a
 * failed expectation rather than a wrong type.
 */
export function requestBody<TBody = UnknownJson>(spy: Mock, index = 0): TBody {
  const { body } = recordedCall(spy, index);
  // SAFETY: TBody is the shape the caller is about to assert on, parsed from
  // JSON this same test's backend built. A mismatch fails the expectation.
  return JSON.parse(body ?? 'null') as TBody;
}

/** A parsed JSON body, before a test says what it expects of it. */
export type UnknownJson = { [key: string]: ResponseBody };
