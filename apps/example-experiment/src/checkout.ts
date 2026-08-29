/**
 * The checkout the blog post describes: one traced unit of work that names the
 * experiment it is part of, writes one wide event, and keeps the traces it
 * cannot afford to lose.
 *
 * Nothing here reaches a network. The latencies are simulated so the planted
 * cause is known, which is what lets the drivers assert that the analysis
 * finds it.
 */
import { withTracing, getRequestLogger, experiment, forceKeep } from 'autotel';
import { bucket } from 'autotel/analysis';

export type Variant = 'v1' | 'v2';
export type Plan = 'free' | 'pro' | 'enterprise';
export type Region = 'uk' | 'us' | 'eu';

export interface CheckoutInput {
  cartItems: number;
  plan: Plan;
  region: Region;
  /** Which arm of the pricing experiment this request took. */
  variant: Variant;
  /** 0-1, drawn by the caller so a run is reproducible. */
  roll: number;
}

export interface CheckoutResult {
  status: 'paid' | 'declined';
  latencyMs: number;
  fxProvider: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The planted cause. `v2` routes a large cart through the old FX service,
 * which is slow. Nothing else in the run knows that, including the analysis.
 */
function priceCart(input: CheckoutInput) {
  const legacyFx = input.variant === 'v2' && input.cartItems > 20;
  return {
    fxProvider: legacyFx ? 'legacy-fx' : 'fx-2',
    latencyMs: legacyFx ? 520 + input.roll * 260 : 60 + input.roll * 90,
  };
}

/**
 * The instrumented checkout. Sampling is `init()`'s business: compare.ts keeps
 * every trace to analyse them, keep.ts turns production sampling on, and this
 * function does not change between the two.
 */
export const checkout = withTracing({ name: 'checkout' })(
  (ctx) =>
    async (input: CheckoutInput): Promise<CheckoutResult> => {
      experiment({
        name: 'checkout-pricing',
        variant: input.variant,
        expect: 'p95 drops, conversion holds',
      });

      const log = getRequestLogger(ctx);
      log.set({
        'user.plan': input.plan,
        'user.region': input.region,
        // A raw count takes a near-unique value per request, so it describes
        // no group. Bucketing at instrumentation time is what makes it
        // analysable; `cart.items` stays to show what happens without it.
        'cart.size': bucket(input.cartItems, [1, 5, 20, 100]),
        'cart.items': input.cartItems,
      });

      const quote = priceCart(input);
      // A real call would take this long. The demo records the number and
      // sleeps a fraction of it, so a run finishes in seconds.
      await sleep(quote.latencyMs / 100);

      const status = input.roll < 0.04 ? 'declined' : 'paid';
      log.set({
        'fx.provider': quote.fxProvider,
        'payment.provider': input.region === 'us' ? 'stripe-us' : 'stripe-eu',
        'payment.status': status,
        'checkout.latency_ms': quote.latencyMs,
        'checkout.latency': bucket(quote.latencyMs, [100, 250, 500, 1000]),
      });

      // A declined payment is a successful request that returned bad news,
      // so the sampler has no reason to keep it. This is the trace you want.
      if (status === 'declined') forceKeep();

      log.emitNow();
      return {
        status,
        latencyMs: quote.latencyMs,
        fxProvider: quote.fxProvider,
      };
    },
);
