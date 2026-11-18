# Express 5 tracing channel

Express 5's router (`router` 2.3+) publishes an `express.router.request`
[tracing channel](https://nodejs.org/api/diagnostics_channel.html#class-tracingchannel)
for every middleware, route handler and `router.param()` callback. This example
turns it into spans with autotel: no patching, no `--import` load-order rule,
and it keeps working when Express is bundled into your app.

```sh
pnpm start
curl localhost:3000/users/42
curl localhost:3000/orders/7
```

```text
✓ GET /users/:id                         11ms
├─ ✓ validateId                           1ms   express.type=param, express.param=id
├─ ✓ authenticate                         2ms
├─ ✓ jsonParser                           2ms
└─ ✓ getUser                              9ms
   └─ ✓ db.users.find                     6ms

✗ GET /orders/:id                         7ms   http.response.status_code=500
├─ ✗ loadOrder                            7ms   Error: connection refused
│  └─ ✗ db.orders.find                    6ms
└─ ✓ errorHandler                       234µs   express.type=error_handler
```

## How it works

`src/express-spans.ts` subscribes with `subscribeTracingChannel` from
`autotel/diagnostics`:

- The first handler of a request starts a `SERVER` span, continuing an
  incoming `traceparent`. It is named by the route pattern (`GET /users/:id`,
  never `/users/42`) when the response finishes.
- Each handler gets a child span, made active while it runs with
  `context.attach()`, so spans it starts, such as autotel's `trace()`, nest
  under it. Concurrent requests stay in their own traces.
- The channel's `error` event marks the handler where the error started.

```ts
import { init } from 'autotel';
import { instrumentExpress } from './express-spans.ts';

init({ service: 'my-api', endpoint: 'http://localhost:4318' });
instrumentExpress();
```

`pnpm test` checks the nesting, overlapping requests and error status against
an in-memory exporter.

Needs Node 22+ and `router` 2.3+. Every Express 5 app depends on `router`; a
fresh lockfile picks up 2.3.
