# Experiment, compare, keep

The runnable version of [I Wrote Autotel to Help Companies
Survive](https://arrangeactassert.com/posts/i-wrote-autotel-to-help-companies-survive/).
The post argues that a change with no way to check it is a gamble. This example
runs the check.

One instrumented checkout in [`src/checkout.ts`](src/checkout.ts) does what the
post describes: `experiment()` names the guess, one wide event carries the
dimensions, `bucket()` makes the numeric ones analysable, and `forceKeep()`
holds on to a trace that the sampler would drop.

Nothing here reaches a network. The latencies are simulated, so the cause of
the slowdown is known before the run starts, and both scripts **assert** that
autotel finds it. They exit non-zero when it does not.

## Mark, change, compare

```bash
pnpm start
```

800 checkouts across both arms of a `checkout-pricing` experiment, then
`compareCohorts()` on the slow ones:

```
800 checkouts, 261 slower than 400ms

What is different about the slow ones:

  fx.provider=legacy-fx                  100% of slow,   0% of normal
  fx.provider=fx-2                         0% of slow, 100% of normal
  experiment.variant=v2                  100% of slow,  26% of normal
  experiment.variant=v1                    0% of slow,  74% of normal
  cart.size=20-100                       100% of slow,  53% of normal
  cart.size=5-20                           0% of slow,  36% of normal
```

The planted cause was `v2` routing carts over 20 items through the old FX
service. The analysis was told none of that. Note what is missing from the
ranking: `cart.items`, the raw count, which takes a near-unique value per
request and so describes no group. `cart.size` is the same number through
`bucket()`, and it ranks.

## The trace you cannot afford to lose

```bash
pnpm start:keep
```

Same checkout with production sampling on: a 10% baseline, errors always kept.
A declined payment is not an error, so the sampler has no reason to keep it.

```
600 checkouts: 578 paid, 22 declined
Exported after sampling: 63 paid, 22 declined
```

Every decline survived, because `forceKeep()` claimed it before the tail
sampler ran. The rest were sampled, which is what makes always-on affordable.
The baseline is probabilistic, so the paid count moves a little between runs.

## The same loop in devtools

```bash
npx autotel-devtools     # in another terminal
AUTOTEL_DEVTOOLS=1 pnpm start
```

The spans land in the local UI. Compare lists the experiments in the store and
offers the arms of the one you pick, so the two cohorts above come from
choosing `checkout-pricing` rather than from typing two queries.
