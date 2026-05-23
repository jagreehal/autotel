---
'autotel-eventcatalog': minor
---

Add a `stamp` subcommand to `autotel-eventcatalog` that writes a runtime
evidence block into each event mdx between
`<!-- autotel:stamp-start -->` and `<!-- autotel:stamp-end -->` markers.

The block carries everything autotel observed in the snapshot for that
event — volume, last-seen, producer, channel, and the full list of dotted
field paths — so the static catalog page itself shows runtime evidence
alongside the hand-written narrative, not in a separate dashboard.

```bash
autotel-eventcatalog stamp \
  --snapshot ./services/test/snapshot.json \
  --catalog ./catalog
```

Subsequent runs are idempotent: content between the markers is replaced,
not duplicated. `--dry-run` prints the update plan without writing files,
suitable for a CI sanity check. The library also exposes `stampCatalog()`
and `buildStampBlock()` for programmatic use.
