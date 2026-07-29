---
name: autotel-custom-exporter
description: >
  Use this skill when shipping autotel spans to a backend that has no preset and no plain OTLP endpoint — implement the OpenTelemetry SpanExporter interface and pass it through init({ spanExporters }) so autotel wraps it in tail-sampling and batching, or add a custom SpanProcessor via init({ spanProcessors }) for redaction or enrichment on the way out.
---

# autotel-custom-exporter

Most backends accept OTLP HTTP/JSON or protobuf, so you just point `init({ endpoint, headers })` at them and need no exporter. Reach for a custom exporter only when the backend needs a bespoke envelope on top of OTLP, or a non-OTLP transport. Reach for a custom processor when you want to transform, redact, or enrich spans before export.

## When to use

- Send spans to a backend with a proprietary ingest shape or transport.
- Redact or rewrite attributes on every span before it leaves the process.
- Add your own sampling or filtering stage to the pipeline.

## Custom exporter

Implement the OTel `SpanExporter` interface, then hand it to `init({ spanExporters })`. Autotel wraps each entry in a `TailSamplingSpanProcessor` and a `BatchSpanProcessor`, so you get batching and tail-sampling for free.

```ts
import type { SpanExporter, ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { ExportResultCode, type ExportResult } from '@opentelemetry/core';
import { init } from 'autotel';

class MyExporter implements SpanExporter {
  export(spans: ReadableSpan[], done: (result: ExportResult) => void): void {
    void this.send(spans).then(
      () => done({ code: ExportResultCode.SUCCESS }),
      (error) => done({ code: ExportResultCode.FAILED, error: error as Error }),
    );
  }
  async shutdown(): Promise<void> {}
  async forceFlush(): Promise<void> {}

  private async send(spans: ReadableSpan[]) {
    const body = JSON.stringify(
      spans.map((s) => ({
        name: s.name,
        traceId: s.spanContext().traceId,
        spanId: s.spanContext().spanId,
        startTime: s.startTime,
        attributes: s.attributes,
      })),
    );
    const res = await fetch('https://ingest.example.com/spans', {
      method: 'POST',
      body,
    });
    if (!res.ok) throw new Error(`ingest ${res.status}`);
  }
}

init({ service: 'my-app', spanExporters: [new MyExporter()] });
```

Use `globalThis.fetch`, not `node:http`, so the exporter also runs on Workers and edge.

## Custom span processor

To transform spans rather than transport them, pass a `SpanProcessor` to `init({ spanProcessors })`. Do the work in `onEnd`, where all attributes are set.

```ts
import type {
  SpanProcessor,
  ReadableSpan,
} from '@opentelemetry/sdk-trace-base';
import {
  SimpleSpanProcessor,
  ConsoleSpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { init } from 'autotel';

const redactor: SpanProcessor = {
  onStart() {},
  onEnd(span: ReadableSpan) {
    if (span.attributes['user.email']) {
      (span.attributes as Record<string, unknown>)['user.email'] = '[redacted]';
    }
  },
  async shutdown() {},
  async forceFlush() {},
};

init({
  service: 'my-app',
  spanProcessors: [
    redactor,
    new SimpleSpanProcessor(new ConsoleSpanExporter()),
  ],
});
```

Pass `spanExporters` OR `spanProcessors`, not both — with `spanProcessors` you own the full pipeline, including the exporter stage.

## Common mistakes

### HIGH: Calling the `done` callback more than once, or not at all

The SDK waits on exactly one `done(result)` per `export()`. Miss it and the `BatchSpanProcessor` stalls; call it twice and you corrupt its queue accounting.

### HIGH: Importing `node:http` in an exporter you run on Workers or edge

Those runtimes have no `node:http`, and it won't tree-shake out. Use `globalThis.fetch`.

### MEDIUM: Retrying inside the exporter when using `spanExporters`

Autotel's `BatchSpanProcessor` already retries on `ExportResultCode.FAILED`. Add your own retry only for backend-specific rules (for example, honoring `Retry-After`).

## Related

- `autotel-backends` — presets for Honeycomb, Datadog, Google Cloud, Grafana Cloud; check before writing an exporter.
- `autotel-custom-subscriber` — the equivalent extension point for product events.
