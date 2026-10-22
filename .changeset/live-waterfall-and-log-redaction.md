---
'autotel': minor
'autotel-adapters': major
'autotel-devtools': minor
'autotel-cli': minor
'autotel-mcp': patch
---

**autotel**

- Log records follow the span redactor's rules when you set `init({ attributeRedactor })`: key rules, paths, built-in patterns and a custom `redactor`. The redactor walks object bodies and nested attributes under dotted keys (`customer.password`), and a sensitive key covers everything beneath it, binary values included. Each log processor gets a redacted view of the record, and a value stays redacted for every processor after it. `init({ logRecordProcessors })` processors get redacted too. `createStringRedactor()` applies the full value rules.
- `autotel/register` wraps only `node_modules` and Node builtins, so your own modules load as written. `autotel/auto` registers through `autotel/register`.
- Tail sampling decides each local root (no parent, or a remote one) on its own. A `spanFilter` that drops Next.js's `next.bubble` span keeps the request beside it, and two requests under one browser trace each get their own verdict.

**autotel-adapters**

- `http.route` holds the matched route template and request spans take the name `{METHOD} {route}`, per the OpenTelemetry HTTP conventions. The raw path goes to `url.path`. Next and Cloudflare set `url.path`; pass `http.route` through `enrichRequest` to name the route. The `http.get`, `express.GET`, `fastify.GET`, `nitro.GET`, `cloudflare.GET`, `next.request` and `nestjs.Controller.handler` span names give way to this format.
- A 5xx response ends the span with status ERROR, and Hono records the error it caught on `c.error`. `markOutcome()` records status and error without emitting the snapshot, and `finishResponse()` takes an `error` option.

**autotel-devtools**

- The GenAI Trace view shows each run as a live waterfall: model calls, tool calls and sub-agents on a time axis with duration and cost, folded rows, the slowest and failed calls marked, and keyboard navigation. A run in progress draws its open parents as running.
- Clear empties the server's store as well as the browser's. The Traces tab returns to the trace list.
- Queries match nested attributes by dotted key: `bound.id = 2` finds `{ bound: { id: 2 } }`.

**autotel-cli**

- `autotel map` credits `autotelMiddleware()` per app: inside app factories, through aliases, and on parent apps, when its path pattern matches and it runs before the route. `.use()` calls stay out of the route map. The redactor check follows `init()` into the helpers it calls.

**autotel-mcp**

- Nested attributes come back as dotted keys (`nested.id: 1`) on every backend, and arrays as JSON. The built-in collector decodes OTLP `kvlistValue` and `arrayValue`.
