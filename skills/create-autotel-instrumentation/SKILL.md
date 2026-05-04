---
name: create-autotel-instrumentation
description: >
  Auto-instrument a third-party library (Drizzle, Mongoose, Redis, Kysely,
  Prisma, BullMQ, …) so every call produces an OpenTelemetry-spec-compliant
  span. Covers operation naming, attribute conventions (db.system,
  messaging.system, http.*, rpc.*), error capture, sensitive-statement
  redaction, package layout, and tests.
type: create
library: autotel
license: MIT
---

# Create autotel instrumentation

Wrap a third-party library so every call it makes is captured as a span without users having to think about tracing. Patterns differ between database, messaging, RPC, and HTTP-style libraries — this skill covers all four.

## PR title

```
feat: add {library} instrumentation
```

## Touchpoints checklist

| # | File | Action |
| --- | --- | --- |
| 1 | `packages/autotel-{library}/src/index.ts` | Public API — `instrument{Library}(client)` |
| 2 | `packages/autotel-{library}/src/wrappers.ts` | Method-level wrapping using `Proxy` |
| 3 | `packages/autotel-{library}/src/attributes.ts` | OTel semantic-attribute mappers |
| 4 | `packages/autotel-{library}/src/index.test.ts` | Unit tests with `InMemorySpanExporter` |
| 5 | `packages/autotel-{library}/package.json` | Name, exports, peerDependency |
| 6 | `packages/autotel-{library}/tsup.config.ts` | Build entry |
| 7 | `packages/autotel-{library}/skills/autotel-{library}/SKILL.md` | Usage skill |
| 8 | `skills/index.json` | Add to skills manifest |
| 9 | `bundle-size-baseline.json` | Run `pnpm bundle-size:update` once green |

## Pick the right semantic conventions

Use OTel-spec attribute names — never invent your own. The right namespace depends on the library kind:

| Kind | Namespace | Examples |
| --- | --- | --- |
| Database / ORM | `db.*` | `db.system=postgresql`, `db.statement`, `db.collection.name`, `db.operation.name` |
| Message queue / pubsub | `messaging.*` | `messaging.system=rabbitmq`, `messaging.operation.name=publish`, `messaging.destination.name` |
| RPC / gRPC | `rpc.*` | `rpc.system=grpc`, `rpc.service`, `rpc.method` |
| HTTP client | `http.*` + `url.*` | `http.request.method`, `url.full`, `http.response.status_code` |
| AI / LLM | `gen_ai.*` | `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens` |
| Cache (Redis, Memcached) | `db.system=redis` + `db.operation.name` | (cache is modelled as a key-value DB in OTel) |
| Browser | `browser.*`, `device.*` | `browser.name`, `browser.version` |
| FaaS | `faas.*` | `faas.trigger`, `faas.coldstart`, `faas.cron` |

When in doubt, search [opentelemetry-specification/semantic-conventions](https://github.com/open-telemetry/semantic-conventions) for the exact key. **Never** invent `library.thing` keys when an OTel-spec key exists.

## Step 1: Wrap with Proxy, not subclassing

`Proxy` lets you intercept every method call without freezing the library's API surface. Subclassing breaks when the library adds new methods or generic constraints.

```typescript
import { trace, SpanKind, SpanStatusCode } from '@opentelemetry/api'

export function instrument{Library}<T extends object>(client: T): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof value !== 'function') return value
      if (typeof prop !== 'string') return value
      if (NON_INSTRUMENTED.has(prop)) return value

      return function instrumented(this: unknown, ...args: unknown[]) {
        const tracer = trace.getTracer('autotel-{library}')
        return tracer.startActiveSpan(
          `{library}.${prop}`,
          { kind: SpanKind.CLIENT, attributes: spanAttrs(prop, args) },
          async (span) => {
            try {
              const result = await value.apply(target, args)
              span.setStatus({ code: SpanStatusCode.OK })
              return result
            } catch (err) {
              span.recordException(err as Error)
              span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message })
              throw err
            } finally {
              span.end()
            }
          },
        )
      }
    },
  })
}
```

## Step 2: Span name + attribute conventions

Span name format: `<library>.<operation>` for low-level methods, `<library>.<entity>.<verb>` for ORMs:

| Library | Span name |
| --- | --- |
| `redis` | `redis.GET`, `redis.SET`, `redis.HSET` |
| `mongoose` | `mongoose.User.find`, `mongoose.User.findOne` |
| `drizzle` | `drizzle.select`, `drizzle.insert`, `drizzle.update` |
| `bullmq` | `bullmq.Queue.add`, `bullmq.Worker.process` |

Attributes always include:

- `<namespace>.system` (e.g. `db.system=postgresql`)
- `<namespace>.operation.name` (e.g. `db.operation.name=SELECT`)
- The library version: `db.client.connections.{library_name=...}` or a `library.version` resource attribute

## Step 3: Sensitive data — three levels

Database statements / queue payloads / HTTP bodies routinely contain PII. Honour `dataSafety.captureDbStatement`:

```typescript
import { getActiveConfig } from 'autotel-edge'
import { obfuscateSql } from 'autotel/db'

function captureStatement(raw: string): string | undefined {
  const mode = getActiveConfig()?.dataSafety?.captureDbStatement ?? 'full'
  if (mode === 'off') return undefined
  if (mode === 'obfuscated') return obfuscateSql(raw)
  return raw
}
```

For queue payloads, default to `messaging.message.body.size` (length) only; let users opt in to body capture explicitly.

## Step 4: Don't double-wrap

Stamp the proxy so a second `instrument{Library}(client)` call returns the same proxy:

```typescript
const INSTRUMENTED = Symbol.for('autotel-{library}/instrumented')

export function instrument{Library}<T extends object>(client: T): T {
  if ((client as any)[INSTRUMENTED]) return client
  const proxy = new Proxy(client, { /* … */ })
  Object.defineProperty(proxy, INSTRUMENTED, { value: true, enumerable: false })
  return proxy
}
```

## Step 5: Tests

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { InMemorySpanExporter } from 'autotel/exporters'
import { SimpleSpanProcessor } from 'autotel/processors'
import { init } from 'autotel'
import { instrument{Library} } from './index'

const exporter = new InMemorySpanExporter()
init({ service: 'test', spanProcessors: [new SimpleSpanProcessor(exporter)] })

describe('autotel-{library}', () => {
  beforeEach(() => exporter.reset())

  it('records a span per call with OTel-spec attributes', async () => {
    const client = instrument{Library}(makeFakeClient())
    await client.get('foo')

    const [span] = exporter.getFinishedSpans()
    expect(span.name).toBe('{library}.get')
    expect(span.attributes['db.system']).toBe('{library}')
    expect(span.attributes['db.operation.name']).toBe('GET')
  })

  it('records exceptions and sets ERROR status', async () => {
    const client = instrument{Library}(makeFakeClientThatThrows())
    await expect(client.get('boom')).rejects.toThrow()

    const [span] = exporter.getFinishedSpans()
    expect(span.status.code).toBe(2)
  })

  it('does not double-wrap', () => {
    const a = makeFakeClient()
    const once = instrument{Library}(a)
    const twice = instrument{Library}(once)
    expect(once).toBe(twice)
  })
})
```

## Anti-patterns

| Anti-pattern | Fix |
| --- | --- |
| Inventing new attribute namespaces (`drizzle.query`) | Use `db.statement`, `db.operation.name` |
| Recording raw bodies / SQL by default | Honour `dataSafety.captureDbStatement` |
| Subclassing the library client | `Proxy` instead — keeps generics intact |
| Spanning private methods | Stick to public surface; users don't expect spans for `_internal()` |
| Spanning every getter | Only methods; getters are property reads |
| Forgetting `recordException` + `ERROR` status | Wrap the call in `try/catch/finally` and call both on failure |
| Re-instrumenting on every request | Stamp with a `Symbol.for(...)` and short-circuit |
