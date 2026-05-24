# example-eventcatalog

A worked example of an [EventCatalog](https://www.eventcatalog.dev) kept in
sync with a running system using
[`autotel-eventcatalog`](../../packages/autotel-eventcatalog).

> **First time here?** [autotel](https://github.com/jagreehal/autotel) is an
> OpenTelemetry wrapper for Node.js. The services in `services/src/`
> (`orders`, `payments`, `inventory`, `recommendations`) wrap their business
> logic in `trace()`, `span()` and `track(eventName, payload)`. A test run
> with `ArchitectureSnapshotSubscriber` attached produces
> `services/test/snapshot.json` — every domain event that fired, what
> fields and types its payload had, who produced it, on what channel.
> `autotel-eventcatalog drift` then diffs that snapshot against the
> EventCatalog in `catalog/`.

The catalog is hand-curated today and acts as the **specification** for
what an autotel-driven generator should produce from snapshots. Build the
destination first; build the generator that reaches it second.

## What's inside

```
example-eventcatalog/
├── catalog/                  # Static EventCatalog (Astro-based)
│   └── domains/E-Commerce/
│       ├── services/         # 4 services: Orders, Payment, Inventory, Recommendations
│       ├── channels/         # 3 Kafka topics
│       └── flows/            # 2 flows: CheckoutFlow + PaymentRecoveryFlow
├── assets/demo/              # Captured frames for screenshots / talk slides
│   ├── 01-dashboard-steady.png
│   ├── 02-drift-banner-particles.png
│   ├── 03-pr-view.png
│   └── 04-catalog-stamped.png
└── services/
    ├── src/
    │   ├── orders/           # placeOrder() with trace() + traceProducer + track()
    │   ├── payments/         # payment.capture span() + retries
    │   ├── inventory/        # WMS reservation
    │   ├── recommendations/  # LLM call instrumented with autotel gen-ai
    │   ├── live/             # Live HTTP+SSE server + dashboard runner
    │   │   ├── stream.ts     #   subscriber that emits per-event to listeners
    │   │   ├── server.ts     #   http server: /snapshot.json, /drift.json, /events (SSE), /demo/pr
    │   │   ├── replay.ts     #   record / replay (deterministic demo)
    │   │   └── runner.ts     #   fires checkouts, simulates failures, introduces drift
    │   ├── build-snapshot.ts # produces services/test/snapshot.json
    │   └── demo.ts           # single end-to-end run, no server
    ├── public/
    │   ├── live.html         # the dashboard
    │   └── pr.html           # mock GitHub PR view at /demo/pr
    └── test/
        ├── snapshot.json     # committed snapshot — input to the drift CLI
        └── demo.jsonl        # committed event recording — input to REPLAY mode
```

## What this catalog shows that a hand-drawn diagram can't

A static sequence diagram of the checkout flow names the steps. It does
not know:

- That `payment.capture` retries soft declines **2.3% of the time** in production.
- That the LLM step costs **$0.0005 per call** and uses **412 prompt tokens** on average.
- That a `personalization_seed` field has appeared in payloads but is **not declared** in the event schema.

Those facts live in autotel spans and events. The catalog pages here
render them as evidence callouts, so the diagram and the runtime can't
silently disagree.

## Quick start

### Watch it happen — live demo

```bash
pnpm install
cd apps/example-eventcatalog
pnpm services:live
```

Open <http://localhost:4000>. Also visit <http://localhost:4000/demo/pr> for
the **mock GitHub PR view** showing what the drift report looks like when it
lands on a real PR — conversation page chrome, sticky bot comment, failing
status check.

You will see, in real time:

- **Event tiles** with counts ticking up as each checkout completes
- **An activity feed** scrolling new events the instant they fire
- **Channel-coloured badges** (orders, payments, inventory) showing producer/consumer attribution
- **A `payments.failed` tile** appearing once the first card decline lands (default 18% failure rate)
- **A drift panel** that is empty at first, then fills in after ~25 seconds when the runner deliberately introduces a `_drift_demo_field` into recommendation payloads — autotel-eventcatalog detects it and surfaces it on the dashboard within a few seconds

The dashboard, the snapshot, and the drift report all read the same SSE stream — so what you see ticking on screen is the same data the CLI fails CI on.

### Deterministic replay (for recording, conference demos, anywhere wifi is unreliable)

A 50-second session is committed at `services/test/demo.jsonl`. Replay it on loop:

```bash
REPLAY_PATH=services/test/demo.jsonl pnpm services:live
# or faster, for compressed time:
REPLAY_PATH=services/test/demo.jsonl REPLAY_SPEED=2 pnpm services:live
```

The dashboard sees an identical SSE stream to a live run — particles flow,
counts tick, drift banner fires at the same beat every time. No live PSP, no
random order generation, no network surprises. The runner doesn't talk to
the outside world.

To record your own session (e.g. for a talk-specific narrative):

```bash
RECORD_PATH=my-demo.jsonl DRIFT_AFTER_MS=20000 INTERVAL_MS=900 pnpm services:live
# ...let it run as long as you want, then Ctrl+C...
REPLAY_PATH=my-demo.jsonl pnpm services:live
```

### Recording a 15-second MP4 / GIF

Once a replay is running, you have a deterministic, repeatable surface to
record against. macOS:

```bash
# Cmd+Shift+5 → "Record selected portion" → choose the browser window
# Or via the command line:
screencapture -v -V 15 -R 0,0,1600,1100 demo.mov  # 15-second video
# Convert to GIF (requires ffmpeg + gifski, or use any GIF converter):
ffmpeg -i demo.mov -vf "fps=18,scale=1280:-1:flags=lanczos" -c:v gifski demo.gif
```

A good 15-second cut:

| Time   | Window                                                     |
|--------|------------------------------------------------------------|
| 0–3s   | Static catalog page (`localhost:3000/docs/events/RecommendationGenerated/1.0.0`) — show the stamped runtime evidence at the bottom |
| 3–5s   | Cut to dashboard (`localhost:4000`) — counts ticking, particles flowing |
| 5–9s   | Press **Trigger drift** button (or let the replay's natural drift fire) — banner slides in, diff panel highlights the new field |
| 9–13s  | Cut to mock PR view (`localhost:4000/demo/pr`) — the bot comment rendered with the new finding, the check turning red |
| 13–15s | Hold on the PR comment with the failing status check       |

That's the story arc. Open with the doc that looks calm and complete; show
the live runtime; introduce drift; cut to the PR being blocked.

### View the static catalog

```bash
pnpm catalog:dev
```

Open <http://localhost:3000>.

### Walk the headline path

1. **Start here**: <http://localhost:3000/docs/flows/CheckoutFlow/1.0.0> —
   the happy-path checkout, with evidence callouts at every step.
2. **Failure path**: <http://localhost:3000/docs/flows/PaymentRecoveryFlow/1.0.0> —
   what happens when payment is declined, including the retry budget and
   recovery email.
3. **A live drift example**:
   <http://localhost:3000/docs/events/RecommendationGenerated/1.0.0> — the
   `personalization_seed` field shows up in payloads but is not declared in
   the schema. The page surfaces this as a drift callout with a suggested fix.
4. **Visualiser**: <http://localhost:3000/visualiser/domains/E-Commerce/1.0.0> —
   the full architecture rendered as a node graph.

### Run the illustrative demo

```bash
pnpm services:demo
```

This walks one synthetic order through `placeOrder` → `handleOrderPlaced` →
`generateRecommendation` → `handlePaymentCaptured`. Each function call
corresponds 1:1 to a node in `CheckoutFlow`.

### Produce the architecture snapshot

```bash
pnpm services:snapshot       # writes services/test/snapshot.json
pnpm test                    # integration tests prove the snapshot covers
                             # everything the catalog claims
```

The snapshot is committed in `services/test/snapshot.json` so the contract
between code and catalog is reviewable in PRs.

### Diff the catalog against the snapshot

```bash
pnpm catalog:drift           # human-readable drift report
pnpm catalog:drift:ci        # writes catalog-drift.md and exits 1 on drift
```

### Generate/refresh catalog scaffolding from snapshot

```bash
autotel-eventcatalog generate \
  --snapshot ./services/test/snapshot.json \
  --catalog ./catalog
```

This scaffolds missing services/events/channels, infers event schemas from
`fieldStats`, and creates producer→event and event→channel relationships.

To see *only the drift this branch introduces* compared to another snapshot
(this is the PR-check semantic):

```bash
node ../../packages/autotel-eventcatalog/dist/cli.js drift \
  --base-snapshot /tmp/main-snapshot.json \
  --snapshot ./services/test/snapshot.json \
  --catalog ./catalog \
  --fail-on-drift
```

The same comparison runs automatically on every PR via
`.github/workflows/eventcatalog-drift.yml` — see the workflow for the full
setup.

The example app deliberately ships with real drift so the value prop is
visible immediately. Two findings you should see:

1. **`PaymentFailed` documented but never observed** — the demo exercises only
   the happy path, so the failure event never fires. Real coverage gap.
2. **`recommendation.generated` has extra field `personalization_seed`** —
   the service emits it; the catalog schema does not declare it. Real
   schema drift that autotel-eventcatalog catches directly from runtime
   telemetry vs declared catalog schema.

In `autotel-eventcatalog` v1, drift detection also covers:

1. **Type drift** — runtime field type differs from declared schema type
2. **Value drift** — runtime primitive value falls outside declared enum

Both checks rely on `fieldStats` captured by `ArchitectureSnapshotSubscriber`
for each observed event field path. The contract that this actually works
end-to-end lives in
[`services/test/snapshot-fieldstats.integration.test.ts`](services/test/snapshot-fieldstats.integration.test.ts).
That test:

1. Calls `init()` with a real `ArchitectureSnapshotSubscriber`.
2. Drives the same four-service checkout flow used by the demo
   (`placeOrder` → `handleOrderPlaced` / `generateRecommendation` →
   `handlePaymentCaptured`).
3. Asserts on the snapshot the subscriber produces, e.g.:
   ```ts
   expect(snap.events['order.placed'].fieldStats?.totalCents?.types)
     .toContain('number');
   expect(snap.events['order.placed'].fieldStats?.currency?.sampleValues)
     .toContain('GBP');
   ```

If autotel ever stops capturing those runtime types and sample values,
this test fails — which means `autotel-eventcatalog`'s type and value
drift detection has nothing to compare against, and *that* failure
would surface as a separate broken test in the catalog package. Two
tests, two packages, one contract.

## How this becomes "generated, not maintained"

The build sequence the catalog is designed to support:

| Step | Status | Output |
|---|---|---|
| 1. Hand-curate the destination catalog | done | the `catalog/` you see |
| 2. `ArchitectureSnapshotSubscriber` in `autotel-subscribers` | done | `services/test/snapshot.json` from a real test run |
| 3. `autotel-eventcatalog` drift diff + CLI | done | `pnpm catalog:drift` reports real findings |
| 3a. `autotel-eventcatalog` catalog scaffolding (`generate`) | done | services/events/channels + producer↔event↔channel edges generated from snapshot |
| 4. Live HTTP+SSE dashboard | done | `pnpm services:live` → real-time updates at :4000 |
| 5. Snapshot-vs-base PR comparison + GitHub Action | done | the workflow at `.github/workflows/eventcatalog-drift.yml` |
| 6. Frontmatter-level annotations + opt-in writes | in progress | `stamp` writes evidence blocks between markers in event pages |

Steps 2–5 are the engineering work. Step 1 is the proof that the destination
is worth reaching.

## The pitch (90 seconds)

EventCatalog goes stale. Someone adds an event in code and forgets to update
the catalog. Someone deprecates a producer and the diagram still shows it.

Autotel already sees everything: `track()` is named domain events,
`traceProducer`/`traceConsumer` is producer→consumer edges,
`autotel/gen-ai-events` is LLM steps with token counts and cost.

`autotel-eventcatalog` turns the autotel snapshot into EventCatalog flows,
service pages, and event schemas — and keeps them fresh on every PR. If
your tests emit an event your catalog doesn't know about, the PR fails.

Same model as Pact, for event architectures.
