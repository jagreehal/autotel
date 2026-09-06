# example-distributed-tail-sampling

Three services share one trace, and one of them fails. You run the same traffic
twice: once with each service deciding for itself what to keep, once with the
collector deciding for all of them. Each run prints what the collector stored.

## The system

```
api-gateway :3001  ->  checkout-service :3002  ->  inventory-service :3003
     200                      200                        throws
```

`inventory-service` fails on some requests. `checkout-service` catches that and
falls back to a cached price, so it returns 200, and so does `api-gateway`.
The fallback is correct behaviour. It also means two of the three services look
healthy from inside their own process, and only the last span records that
anything went wrong.

## Run it

```bash
docker compose up -d          # collector on :4318, writes to ./out
pnpm install

pnpm start                    # the collector decides
pnpm start:in-process         # each service decides
```

Each run starts the three services, sends six requests through them, shuts the
services down, waits out the collector's `decision_wait`, and prints what the
collector stored.

With `pnpm start`, the collector decides:

```
  48904c00…  3 spans   api-gateway -> checkout-service -> inventory-service
  93626035…  3 spans   api-gateway -> checkout-service -> inventory-service
```

With `pnpm start:in-process`, each service decides:

```
  e1824093…  1 span    inventory-service
  71913aeb…  1 span    inventory-service
```

Same traffic, same collector, same two failing requests. One run stores the
whole trace. The other stores the error on its own, with nothing to show how
the request reached it.

Stop everything:

```bash
docker compose down
```

## What changes between the runs

One `init()` option, in [src/service.ts](./src/service.ts):

```ts
// pnpm start: export everything, let the collector decide
init({ service: role.service, sampling: 'development' });

// pnpm start:in-process: decide here, after the operation finishes
init({
  service: role.service,
  sampler: samplingPresets.production({
    baselineSampleRate: 0,
    alwaysSampleSlow: false,
  }),
});
```

The second is tail sampling. `AdaptiveSampler` starts every span, runs the
operation, then decides. `TailSamplingSpanProcessor` drops the spans it rules
against on the way out. For a single service that is the right tool, and you
need no collector for it.

`baselineSampleRate: 0` makes the demo deterministic: keep failures, drop the
rest. In production you would leave the 10% default, which loses the
surrounding trace nine times out of ten.

## What the in-process sampler can see

Autotel hands `shouldKeepTrace()` one thing: the result of the operation _this
process_ just ran. In `api-gateway` that operation returned 200, because
`checkout-service` returned 200, because the fallback worked. The gateway's
sampler has no question it could ask that would reveal a failure two hops down.
The information never enters the process.

Each service answers correctly, and the answers do not compose:

```
Trace ABC
  api-gateway        succeeded -> DROP
  checkout-service   succeeded -> DROP
  inventory-service  failed    -> KEEP
```

You keep the error and lose the spans that explain how the request reached it.

## What the collector sees

`tail_sampling` in [otelcol.yaml](./otelcol.yaml) buffers spans by trace ID for
`decision_wait`, then evaluates its policies against the whole trace and applies
one verdict to every span in it:

```yaml
tail_sampling:
  decision_wait: 5s
  num_traces: 1000
  policies:
    - name: keep-traces-containing-an-error
      type: status_code
      status_code:
        status_codes: [ERROR]
```

One span in the trace has status ERROR, so the collector keeps the trace,
gateway span included. Healthy requests match no policy, so it drops them
whole. Neither outcome is a fragment. A kept child whose parent was dropped
renders as an orphan in your backend.

## Where the buffering cost lands

Buffering has to happen somewhere. `decision_wait: 5s` and `num_traces: 1000`
set how much memory this collector spends holding traces before it decides, and
you tune both on a process you scale apart from your services.

In-process, that buffering comes out of your service's heap. `decision_wait`
has to exceed your slowest trace, and a serverless or edge runtime often exits
first. [autotel-edge](../../packages/autotel-edge/src/core/spanprocessor.ts)
flushes per request for that reason: it has no other option.

## When in-process sampling is enough

With one service, and the question "was this request slow or broken?", decide
in the process. Autotel's default preset keeps every error and every slow
request plus a 10% baseline, and nothing has to buffer.

Move the decision to the collector when it depends on something the process
cannot see: a downstream failure, or a latency budget spanning the whole trace.

## Do not do both

Autotel's default keeps 10%. A collector keeping 25% of what arrives leaves you
2.5%. Pick one place. These services set `sampling: 'development'` in the
collector run, so the collector owns the decision.

For masking leaked PII, dropping health checks and counting requests before
sampling, see
[example-collector-pipeline](../example-collector-pipeline/README.md).
