# example-collector-pipeline

The app exports every span. An OpenTelemetry Collector sits between the app and
the backend, and decides what survives.

Other examples point autotel at a backend and stop there. This one shows the
layer in between, where you mask leaked PII, drop health checks, count requests,
and store a sample of the traces.

## Prerequisites

- Docker and Docker Compose
- pnpm

## Run it

You need two terminals.

Terminal 1 starts the collector and a viewer:

```bash
cd apps/example-collector-pipeline
docker compose up -d
```

Terminal 2 sends traffic:

```bash
cd apps/example-collector-pipeline
pnpm install
pnpm start
```

The app sends 30 health checks and 20 orders. Four orders fail.

Back in terminal 1, read what the collector exported:

```bash
docker compose logs otelcol | tail -20
```

```
Metrics ... "resource metrics": 1, "metrics": 2, "data points": 2
Traces  ... "resource spans": 7, "spans": 17
```

Twenty orders went in and seven traces came out, while the counters still report
20 requests and 4 exceptions. The 30 health checks left nothing behind.

Browse the traces:

```bash
docker compose attach oteltui
```

`Tab` moves between the Traces and Metrics tabs. `Ctrl+p` then `Ctrl+q` detaches
and leaves the container running.

Open any `POST /orders` span. The app set `user.email` to
`alice.chen@example.com` and `payment.card` to a 16 digit number. The collector
rewrote them to `***@example.com` and `[redacted-card]` before storage.

To see the masked attributes in the terminal instead, set
`verbosity: detailed` on the `debug` exporter in
[otelcol.yaml](./otelcol.yaml) and run `docker compose restart otelcol`.

Stop everything:

```bash
docker compose down
```

## The pipeline

Read [otelcol.yaml](./otelcol.yaml) next to this list.

### Mask what the app leaked

`transform/redact` rewrites two attributes with OTTL. One targets `user.email`
by name. The other scans every string attribute for a 13 to 16 digit run, so it
catches a card number no matter which attribute holds it.

Autotel redacts too. Its `default` preset masks emails, phone numbers, SSNs and
card numbers by value pattern, and `resolveAttributeRedactor` turns it on by
itself when `NODE_ENV` is `production`. Run this example with
`NODE_ENV=production` and both attributes reach the collector already masked, as
`a***@***.com` and `****1111`. The OTTL rule then trims the email down to
`***@***.com`, and it leaves the 4 digit card remnant alone.

So the collector rule earns its place on the values autotel's patterns do not
recognise: internal customer IDs, postal addresses, prompt and completion text,
anything shaped like ordinary prose. Write the app-side rule for what you know
about and the collector rule for what you find later, without redeploying the
app.

### Drop health checks

`filter/health` deletes any span with `http.route == "/healthz"`. Health checks
are the highest volume and lowest value traces most services produce, and
nothing downstream pays for them once the collector drops them.

### Count before sampling

The `count` connector emits `app.requests` from every root span and
`app.exceptions` from every exception event, and it runs before `tail_sampling`.
Request and error counts stay exact at any sample rate, so a dashboard built on
them does not move when you change how many traces you keep.

### Keep every failure

`tail_sampling` waits 5 seconds for a trace to finish, then applies two
policies: keep anything with an ERROR status, and keep 25% of the rest.

## Sampling in two places multiplies

Autotel's default preset keeps 10% of traces plus every error and every slow
request. This collector keeps 25%. Run both and you store 2.5%. Few teams
intend that. The app sets `sampling: 'development'` so the collector owns the
decision.

Put the decision in the collector once more than one service is involved. It
groups spans by trace ID across every service, so a failure in a downstream
service saves the whole trace. Autotel's tail sampler sees one process, so it
can only save the part of the trace that process produced.

## Point your own service at it

Change the app, keep the config:

```ts
init({
  service: 'your-service',
  endpoint: 'http://localhost:4318',
  sampling: 'development',
});
```

Set `http.route` on your spans, or let
`@opentelemetry/instrumentation-http` set it for you. Both the filter and the
counter key off it. If your health endpoint is not `/healthz`, edit the one
string in `filter/health`.

To send somewhere real, replace the `otlp_grpc/tui` exporter with your backend
and add credentials through
[`${env:}` substitution](https://opentelemetry.io/docs/collector/configuration/#environment-variables).
