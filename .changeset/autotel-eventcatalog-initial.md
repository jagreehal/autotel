---
'autotel-eventcatalog': minor
---

Initial release of `autotel-eventcatalog`. Diffs an autotel architecture
snapshot against an EventCatalog and reports the drift: events observed but
undocumented, events documented but never observed, field paths in payloads
not declared in the schema, and producers / channels seen but not catalogued.

Ships as a library and a CLI:

```bash
autotel-eventcatalog drift \
  --snapshot ./services/test/snapshot.json \
  --catalog ./catalog \
  --output drift.md \
  --fail-on-drift   # exit 1 when drift is detected — wire this into CI
```

v0 covers existence drift and field-path drift. Type drift, value drift, and
auto-writing missing catalog entries are deferred to later releases.
