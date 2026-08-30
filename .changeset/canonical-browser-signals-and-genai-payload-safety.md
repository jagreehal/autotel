---
'autotel-web': minor
'autotel': minor
'autotel-posthog': minor
'autotel-genai': minor
---

Emit browser telemetry under the names and signal types OpenTelemetry already
defines, add the signals it has no name for, and stop losing data on the way out.

## Canonical names, emitted as events

Every browser signal had a specification name and was going out under a
homegrown one — so a dashboard built on the conventions found an empty panel and
read it as "this never happened".

| before                                    | now                                                     |
| ----------------------------------------- | ------------------------------------------------------- |
| span `click: x`, `user.interaction.type`  | `app.widget.click` + `app.widget.*` / `app.screen.*`    |
| `web_vitals.lcp` on one shared span       | `browser.web_vital` per metric, with `delta` and `id`   |
| span `long_task`, `long_task.duration_ms` | `app.jank` + `app.jank.period` / `.threshold` (seconds) |
| `session.id` only                         | plus `session.start` / `session.end`                    |
| `feature_flag.<key>` (autotel-posthog)    | canonical `feature_flag.*` + `feature_flag.evaluation`  |

**These are log records, not spans.** An OpenTelemetry event _is_ a log record;
a zero-duration span is invisible to event dashboards and produces nothing at
all in lean mode. Query them where your logs are. `packages/autotel-web/src/semconv.ts`
is the source of truth, pinned by a test.

**Breaking for queries, not for types.** Anything matching the old span names or
attributes needs updating.

## New in autotel-web

- **`captureFrustration`** — dead and rage clicks as
  `app.widget.click.frustration`. A click that does nothing runs no code, so the
  trace is empty exactly where the user is stuck; no tracing backend can produce
  this for itself.
- **`breadcrumbs`** — a byte-bounded trail of clicks and console output,
  attached to exceptions as `exception.breadcrumbs`.
- **`captureEngagement`** — `browser.page_engagement` with scroll depth **and**
  content depth: on a page shorter than the viewport nothing scrolls, so scroll
  depth alone reads a fully-read page as a bounce.
- **`captureConsoleLogs`** — `console.*` as OTLP log records. The package had a
  trace signal and no log signal at all.
- **`remoteConfigUrl`** — sampling and capture toggles from a JSON file you
  already serve, cached and applied synchronously on the next visit. Capture
  toggles let remote win both ways; suppression rules are additive only, because
  there the failure mode is silently losing errors.
- **`browser.*` resource context**. `user_agent.*` is left to the collector,
  which has a real UA database.
- **Session-consistent sampling.** `sampleRate` hashes `session.id` (or a
  private page key when sessions are off) and covers spans, logs and events
  alike. Random per-span sampling kept a tenth of every session and left none
  reconstructable.

## New in autotel

`autotel/feature-flags` — `recordFeatureFlag()` and `autotelOpenFeatureHook()`
emit the canonical `feature_flag.*` attributes plus a `feature_flag.evaluation`
log record, so a rollout can be split by variant in any backend. Values keep
their type, reasons are normalised to the registry's lower snake case, and
`feature_flag.error.message` replaces the deprecated
`feature_flag.evaluation.error.message`.

## Delivery

Browser spans were posted once and dropped on failure — silently, and
indistinguishably from a user who never showed up. Now: jittered backoff,
offline queueing, a 1000-record cap, and `fetch` while the page is alive so
there is a status to retry against. `sendBeacon` is kept for unload, clears the
queue only when it returns `true`, and carries the batch mid-backoff. Retry
exhaustion discards only the exhausted batch. A responseless failure while
online is treated as blocked, not broken — that is an ad blocker, and retrying
it forever only burns battery.

Lean mode grows from ~3.7KB to ~5.4KB gzipped for this; full mode from ~34KB to
~39KB.

## autotel-genai

- **Inline binary is redacted, not inflated.** Buffers and data URLs were being
  base64-encoded into `gen_ai.input.messages`, so one multimodal call produced a
  multi-megabyte attribute that collectors truncate mid-string. They now become
  `[base64 image/png redacted]`.
- **Content is capped at 200KB and stays valid JSON** — long string leaves are
  cut first, keeping every message, role and part in place. Slicing serialised
  JSON at a byte offset lands mid-token, and autotel's own devtools then drop
  the attribute entirely.
- **Server-side tools are priced.** `serverToolCalls` bills web search and file
  search, which fall outside the token counts. Only per-call-billed tools are in
  the table: pricing a session-billed tool per call overstates it by two orders
  of magnitude, and a confident wrong number is harder to catch than a missing
  one — unpriced tools surface as `gen_ai.usage.cost.unpriced_tools`.
- **`cacheTokensExclusive`** for providers that report cache tokens on top of
  `inputTokens` rather than inside it, and **`tokenSource`** labelling counts as
  observed or estimated.
- **Prompt versions** — `gen_ai.prompt.version` / `.label` / `.hash`.
- Repeated object references are no longer mistaken for cycles: redaction
  tracked visited objects globally, so one message appearing twice became
  `[message, null]`.

**Breaking in effect, not in types:** anything reading `{"__type":"base64"}` out
of `gen_ai.input.messages` now finds a placeholder string.
