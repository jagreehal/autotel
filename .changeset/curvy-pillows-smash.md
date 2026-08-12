---
'autotel-devtools': minor
'autotel-docs': patch
---

Errors tab: browsable stack frames with the failing source line.

A stack trace was a `<pre>` block. Reading it meant scanning for the one frame
that was your code, then opening the file yourself. The tab now parses the
stack and lists frames classified by origin — your code, `node_modules`, or
runtime (`node:*`, `[eval]`). Only app frames are clickable, because they are
the only ones with a file we could show. Picking one fetches the lines around
the failure, numbered as they are on disk. The raw text stays under **Raw
stack** with the copy button.

`autotel`'s structured errors were showing no frames at all: they write the
stack to `error.stack` rather than emitting an `exception` event, and the
aggregator read only `exception.stacktrace` / `exception.stack` / the event.
It now reads `error.stack` too.

Source reading is a new `GET /source`, gated three ways: it is confined to
`AUTOTEL_DEVTOOLS_SOURCE_ROOT` (default: the receiver's working directory) with
symlinks resolved, so a link pointing out of the project is refused; it sits
behind the existing loopback/Origin guard; and every refusal is an
indistinguishable 404, so the route cannot be used to probe for files. Set
`AUTOTEL_DEVTOOLS_SOURCE_ROOT=false` to disable it — the route then 404s and
devtools never touches the filesystem.

That default holds only on a loopback bind. `--host 0.0.0.0` flips it to off,
because the Origin guard alone does not carry this route: a request with no
`Origin` at all passes it, and the root holds whatever else is in the project,
`.env` included. An explicit root is still honoured there.

`createDevtools()` takes a `sourceRoot` option and follows the same rule, so the
embedded widget gets the same Errors tab as the CLI dashboard rather than
silently degrading to no source.

Stack parsing lives in one `node:`-free module shared by the server and the
widget; the aggregator's fingerprint now composes from it rather than
re-matching frames and discarding the positions.
