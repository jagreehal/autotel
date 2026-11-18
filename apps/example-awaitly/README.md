# awaitly + autotel

awaitly 7.1 traces its own workflows. `init()` from autotel registers the tracer, meter and context manager, and awaitly reads them: no adapter and no `onEvent` bridge.

```bash
pnpm --filter @jagreehal/example-awaitly start
```

With no endpoint, `debug: 'pretty'` prints each trace as a tree. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to send them to a collector instead.

## What each run shows

| Run                 | What to look for                                                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `checkout`          | `run checkout` with a `step` span per step. `attributes` on `createWorkflow()` and `workflow.run()` reach every span; `annotateSpan()` adds `payment.provider` to the charge step |
| `load-account`      | A typed error: the step and run spans fail with `error.type=USER_NOT_FOUND`, and the error payload stays out of telemetry                                                         |
| `charge-with-retry` | An `attempt` span per try and `awaitly.step.retry` events on the step                                                                                                             |
| `offers`            | `step.if()` records an `awaitly.decision` event with the branch taken                                                                                                             |
| `profile`           | The second step with the same `key` is an `awaitly.step.cache_hit` event, not another span                                                                                        |
| `POST /checkout`    | autotel's `trace()` on the handler that calls the workflow; `run checkout` nests under it                                                                                         |

Every run and step span carries `code.file.path` and `code.line.number` for the line that started it. With an endpoint set, autotel registers a meter too, and awaitly records `awaitly.workflow.duration`, `awaitly.step.duration` and `awaitly.step.retries` on it.

`createVisualizer` and `createConsoleLogger` from `awaitly-visualizer` read the same runs through `onEvent` and draw them as ASCII and Mermaid.

## Setup

```typescript
// instrumentation.ts, loaded with --import
import 'autotel/register';
import { init } from 'autotel';

init({ service: 'example-awaitly', debug: 'pretty' });
```

```typescript
import { createWorkflow } from 'awaitly';

const checkout = createWorkflow('checkout', deps);

await checkout.run(async ({ step, deps }) => {
  const user = await step('fetchUser', () => deps.fetchUser('user-1'));
  return step('chargeCard', () => deps.chargeCard(99.99));
});
```

Put autotel's `trace()` on entry points no step calls, such as route handlers. awaitly already opens the run and step spans, so a `trace()` around a step adds a second span for the same work.
