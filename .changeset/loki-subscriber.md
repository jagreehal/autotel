---
'autotel-subscribers': minor
'autotel-devtools': patch
---

Add a Grafana Loki subscriber: `autotel-subscribers/loki`.

`LokiSubscriber` pushes events to Loki's push API as JSON log lines, and works
against a self-hosted single-tenant instance, a multi-tenant deployment, and
Grafana Cloud. Auth follows what each expects: `user` plus `apiKey` is sent as
HTTP Basic for Grafana Cloud, `apiKey` alone as Bearer for an authenticating
proxy, and `tenantId` as `X-Scope-OrgID` independently of either.

The label split is the part worth knowing about. Loki indexes labels and bills
by their cardinality, while the log line is searched at query time, so only
`service`, `environment` and `level` become labels by default. Everything else —
request ids, paths, user ids, your own attributes — stays in the line where
`| json` reaches it. Fields holding objects or arrays are skipped rather than
stringified, because a serialised object is exactly the unbounded label value
that breaks an instance.

Events are buffered and pushed as grouped streams rather than one request per
event, with entries sorted by timestamp within each stream, since Loki rejects
out-of-order pushes. The flush timer is unref'd so a partial batch never holds
the process open. A missing endpoint warns once and drops events instead of
failing the caller's request path.

`sendToLoki()`, `sendBatchToLoki()`, `buildLokiPayload()`, `toLokiLabels()`,
`toLokiHeaders()` and `resolveLokiPushUrl()` are exported for direct use.

Adds `docker-compose.lgtm.yml`, running Grafana's all-in-one LGTM image so Loki,
Grafana, Tempo and Mimir come up in one container. `loki.integration.test.ts`
uses it for a real round trip: push events, query them back through Loki's range
API, and assert the labels, the JSON line and the timestamp survived. Without
`LOKI_ENDPOINT` it skips rather than passing silently.

Also fixes `autotel-devtools` publishing stale build artifacts. Its tsdown step
had `clean: false`, so files removed from a build were never deleted from
`dist` — which is how the source maps dropped in the previous change came back.
tsdown runs before the vite widget build, and that build already sets
`emptyOutDir: false`, so cleaning is safe and the widget is unaffected.
