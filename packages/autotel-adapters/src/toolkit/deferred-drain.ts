/**
 * Extend drain lifetime on serverless runtimes without blocking the HTTP response.
 *
 * The drain always runs in the background (its rejection is logged, never
 * thrown). When `waitUntil` is provided, the promise is also handed to the
 * platform so the isolate stays alive until the drain settles. When it is
 * omitted there is no keep-alive guarantee: on a freezing runtime the drain may
 * not finish, so callers that need delivery must supply `waitUntil`.
 */
export function extendDeferredDrain(
  drainPromise: Promise<unknown>,
  waitUntil?: (promise: Promise<unknown>) => void,
): void {
  void drainPromise.catch((err) => {
    console.error('[autotel-adapters] background drain failed:', err);
  });
  if (typeof waitUntil === 'function') {
    waitUntil(drainPromise);
  }
}
