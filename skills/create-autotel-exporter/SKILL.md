---
name: create-autotel-exporter
description: >
  Ship a new vendor exporter for autotel — for backends that need a custom
  envelope shape on top of OTLP (Sentry, Axiom, HyperDX, Better Stack,
  PostHog, …) or a non-OTLP transport entirely. Covers retry, batching,
  error handling, auth resolution, and cross-runtime support
  (Node + Workers + edge).
license: MIT
---

# Create autotel exporter

Most backends today accept OTLP HTTP/JSON or HTTP/protobuf — for those, no exporter is needed; just point `init({ exporter: { url, headers } })` at them. This skill is for backends that need:

- A custom envelope wrapping OTLP spans (Sentry envelope, PostHog event shape).
- A non-OTLP transport entirely (proprietary binary protocol, gRPC with custom auth).
- Vendor-specific batching / retry semantics.

## PR title

```
feat: add {vendor} exporter
```

## Touchpoints checklist

| # | File | Action |
| --- | --- | --- |
| 1 | `packages/autotel-{vendor}/src/index.ts` | `{Vendor}SpanExporter` class |
| 2 | `packages/autotel-{vendor}/src/encode.ts` | Span → vendor envelope conversion |
| 3 | `packages/autotel-{vendor}/src/index.test.ts` | Unit tests (encoding, retry, error) |
| 4 | `packages/autotel-{vendor}/package.json` | Name, exports, peerDeps, `files` includes `skills` |
| 5 | `packages/autotel-{vendor}/tsdown.config.ts` | Build entry |
| 6 | `packages/autotel-{vendor}/skills/autotel-{vendor}/SKILL.md` | Per-vendor skill (auto-discovered via the `files` `skills` entry) |
| 7 | `packages/autotel-backends/skills/autotel-backends/SKILL.md` | Add vendor row |
| 8 | `bundle-size-baseline.json` | Update on green CI |

## Cross-runtime constraint

The exporter MUST run in:

- **Node** (file system, async hooks available)
- **Cloudflare Workers** (no `node:fs`, fetch-only HTTP, `ctx.waitUntil` for tail flushes)
- **Vercel Edge / Deno Deploy** (limited Node compat layer)

→ Use `globalThis.fetch`. Never import `node:http`, `node:https`, or anything that won't tree-shake out of Worker bundles.

## Step 1: Implement the SpanExporter contract

```typescript
import type {
  ReadableSpan,
  SpanExporter,
} from '@opentelemetry/sdk-trace-base'
import { ExportResultCode, type ExportResult } from '@opentelemetry/core'
import { encode{Vendor} } from './encode'

export interface {Vendor}ExporterConfig {
  apiKey: string
  endpoint?: string  // override default ingest URL
  timeout?: number   // default 10_000ms
  /** Override fetch implementation (for testing). */
  fetch?: typeof fetch
}

const DEFAULT_TIMEOUT = 10_000
const DEFAULT_ENDPOINT = 'https://ingest.{vendor}.com/v1/spans'

export class {Vendor}SpanExporter implements SpanExporter {
  private shutdownFlag = false

  constructor(private readonly config: {Vendor}ExporterConfig) {
    if (!config.apiKey) {
      throw new Error('[autotel-{vendor}] apiKey is required')
    }
  }

  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    if (this.shutdownFlag) {
      resultCallback({ code: ExportResultCode.FAILED, error: new Error('exporter shut down') })
      return
    }
    if (spans.length === 0) {
      resultCallback({ code: ExportResultCode.SUCCESS })
      return
    }

    void this.send(spans).then(
      () => resultCallback({ code: ExportResultCode.SUCCESS }),
      (error) => resultCallback({ code: ExportResultCode.FAILED, error: error as Error }),
    )
  }

  async forceFlush(): Promise<void> {
    /* Stateless — nothing buffered here; the SDK's BatchSpanProcessor handles queueing */
  }

  async shutdown(): Promise<void> {
    this.shutdownFlag = true
  }

  private async send(spans: ReadableSpan[]): Promise<void> {
    const fetcher = this.config.fetch ?? globalThis.fetch
    const url = this.config.endpoint ?? DEFAULT_ENDPOINT
    const body = encode{Vendor}(spans, this.config)

    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), this.config.timeout ?? DEFAULT_TIMEOUT)

    try {
      const response = await fetcher(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body,
        signal: controller.signal,
      })
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`{Vendor} ingest failed: ${response.status} ${response.statusText} ${text.slice(0, 200)}`)
      }
    } finally {
      clearTimeout(t)
    }
  }
}
```

## Step 2: Encode vendor envelope

```typescript
// src/encode.ts
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base'
import type { {Vendor}ExporterConfig } from './index'

export function encode{Vendor}(spans: ReadableSpan[], config: {Vendor}ExporterConfig): string {
  const events = spans.map((s) => ({
    timestamp: hrTimeToISOString(s.startTime),
    operation: s.name,
    duration_ms: hrDuration(s.startTime, s.endTime),
    trace_id: s.spanContext().traceId,
    span_id: s.spanContext().spanId,
    parent_span_id: s.parentSpanId,
    status: s.status.code === 2 ? 'error' : 'ok',
    attributes: s.attributes,
  }))
  return JSON.stringify({ events })
}
```

Keep `encode` pure (no side effects, no I/O) so tests are simple.

## Step 3: Retry + back-off (optional)

The `BatchSpanProcessor` already retries on `ExportResultCode.FAILED`. Don't double-retry inside the exporter unless you have vendor-specific guidance (e.g. respect a `retry-after` header).

If you do need vendor-aware retry:

```typescript
async function withRetry<T>(fn: () => Promise<T>, opts: { tries: number; backoffMs: number }): Promise<T> {
  let last: unknown
  for (let i = 0; i < opts.tries; i++) {
    try {
      return await fn()
    } catch (err) {
      last = err
      const status = (err as { status?: number }).status
      if (status && status < 500 && status !== 429) throw err  // 4xx — don't retry
      await new Promise((r) => setTimeout(r, opts.backoffMs * 2 ** i))
    }
  }
  throw last
}
```

## Step 4: Tests

Cover:

- `encode{Vendor}([])` → empty events array.
- `encode{Vendor}([span])` produces the exact envelope shape (snapshot test).
- A 200 response → `ExportResultCode.SUCCESS`.
- A 401 response → `ExportResultCode.FAILED` with auth error in `result.error.message`.
- Timeout → `ExportResultCode.FAILED`.
- `shutdown()` makes subsequent exports fail fast.

```typescript
import { describe, it, expect, vi } from 'vitest'
import { ExportResultCode } from '@opentelemetry/core'
import { {Vendor}SpanExporter } from './index'

describe('{Vendor}SpanExporter', () => {
  it('reports SUCCESS on 200', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    const exporter = new {Vendor}SpanExporter({ apiKey: 't', fetch: fetcher as never })
    const result = await new Promise<ExportResult>((resolve) => exporter.export([fakeSpan()], resolve))
    expect(result.code).toBe(ExportResultCode.SUCCESS)
  })

  it('reports FAILED on 401', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('unauthorized', { status: 401 }))
    const exporter = new {Vendor}SpanExporter({ apiKey: 't', fetch: fetcher as never })
    const result = await new Promise<ExportResult>((resolve) => exporter.export([fakeSpan()], resolve))
    expect(result.code).toBe(ExportResultCode.FAILED)
    expect(result.error?.message).toMatch(/401/)
  })
})
```

## Step 5: Wire into autotel

```typescript
import { init } from 'autotel'
import { BatchSpanProcessor } from 'autotel/processors'
import { {Vendor}SpanExporter } from 'autotel-{vendor}'

init({
  service: 'my-app',
  spanProcessors: [
    new BatchSpanProcessor(
      new {Vendor}SpanExporter({ apiKey: process.env.{VENDOR}_API_KEY! }),
    ),
  ],
})
```

## Anti-patterns

| Anti-pattern | Fix |
| --- | --- |
| Importing `node:http` for transport | Use `globalThis.fetch` |
| Buffering inside the exporter | Let `BatchSpanProcessor` buffer |
| Throwing instead of `resultCallback({ code: FAILED, error })` | The SDK uses callbacks, not promises |
| Hard-coding endpoint with no env-var support | Read from constructor `config` |
| No timeout | Always `AbortController` with a timeout |
| Logging on every batch | Silent on success; log only when `console.error`-worthy |
| Double-retry | The SDK retries on FAILED; don't compound it |
