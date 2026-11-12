import { flush } from 'autotel';
import * as Context from 'effect/Context';
import { CurrentBaggage, parseBaggage } from './baggage.js';

// A serverless platform (Vercel, Lambda) can freeze the function once its response is sent. This wraps
// `HttpRouter.toWebHandler`'s handler so batched spans and work after the response (a Slack bot answering after its
// 200) finish first.

type Work = (promise: Promise<unknown>) => void;

/** Keeps the function alive for work started after the response. A long-running server needs nothing: the default. */
export const WaitUntil = Context.Reference<Work>('autotel-effect/WaitUntil', {
  defaultValue: () => () => {},
});

type VercelRequestContext = {
  readonly get?: () => { readonly waitUntil?: Work } | undefined;
};
const VERCEL_REQUEST_CONTEXT = Symbol.for('@vercel/request-context');

/**
 * Vercel's `waitUntil` for the current request, read from the request context the runtime puts on globalThis (the
 * slot @vercel/functions reads). Read it at the entry point, where the request's async context exists; an Effect
 * fiber may run outside it.
 */
export const vercelWaitUntil = (): Work | undefined =>
  // SAFETY: the Vercel runtime stores its request context under this symbol; elsewhere the slot is empty.
  (
    globalThis as typeof globalThis & {
      readonly [VERCEL_REQUEST_CONTEXT]?: VercelRequestContext;
    }
  )[VERCEL_REQUEST_CONTEXT]?.get?.()?.waitUntil;

export interface WebHandlerOptions {
  /** The platform's waitUntil for this request. Default: Vercel's, when running there. */
  readonly waitUntil?: () => Work | undefined;
}

/**
 * A serverless entry point around `HttpRouter.toWebHandler(...).handler`:
 *
 * - the request's W3C baggage is active from the server span down (see `CurrentBaggage`);
 * - `WaitUntil` is the platform's, so work after the response keeps the function alive;
 * - spans are flushed after the response, and after that work, through waitUntil. Without one (Lambda), work
 *   registered on `WaitUntil` is awaited and spans flushed before the response is returned, since nothing would keep
 *   the function alive for them. A failed flush never fails the request.
 */
export function webHandler(
  handler: (
    request: Request,
    context?: Context.Context<never>,
  ) => Promise<Response>,
  options: WebHandlerOptions = {},
): (request: Request) => Promise<Response> {
  const findWaitUntil = options.waitUntil ?? vercelWaitUntil;
  return async (request) => {
    const platform = findWaitUntil();
    // No platform hook (Lambda): hold the work here and await it before returning, since the function freezes then.
    const pending: Promise<unknown>[] = [];
    const waitUntil: Work = platform
      ? (work) => platform(work.finally(safeFlush))
      : // Observed at once: a rejection while the handler still runs must not go unhandled.
        (work) => void pending.push(work.catch(() => {}));
    const baggage = parseBaggage(request.headers.get('baggage'));
    let context = Context.add(Context.empty(), WaitUntil, waitUntil);
    if (baggage) context = Context.add(context, CurrentBaggage, baggage);

    try {
      return await handler(request, context);
    } finally {
      if (platform) waitUntil(Promise.resolve());
      else {
        // Work can register more work: drain until a pass adds nothing.
        while (pending.length > 0) await Promise.all(pending.splice(0));
        await safeFlush();
      }
    }
  };
}

// flush() rejects on timeout and already logs it; a telemetry failure must never replace the request's own outcome.
const safeFlush = (): Promise<void> => flush().catch(() => {});
