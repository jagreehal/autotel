---
'autotel': minor
'autotel-plugins': minor
'autotel-mcp': minor
---

Add experimental Telemetry Policy support, and close the BigQuery job, stream, and cost gaps.

**Telemetry Policies (OTEP 4738)** — policies are portable, fail-open rules
describing what telemetry to keep and how to transform it. The same JSON runs in
an SDK, a Collector, or any other conforming implementation. Point `init()` at a
policy file or directory:

```typescript
init({ service: 'api', policies: './policies' });
```

```json
{
  "id": "drop-debug-logs",
  "log": {
    "match": [{ "log_field": "severity_text", "regex": "^(DEBUG|TRACE)$" }],
    "keep": "none"
  }
}
```

Policies compile onto autotel's existing `spanFilter` and log record processors —
no new pipeline. Files are watched, so the policy set can change without a
restart. Supported stages are `trace.keep.percentage` (deterministic per-trace
sampling), `log.keep`, and `log.transform` (`remove` → `redact` → `rename` →
`add`). Unsupported stages cause the *policy* to be skipped, never the
telemetry: `metric` targets, and `trace.keep.mode` / `sampling_precision` /
`hash_seed` / `fail_closed` (OTEP 235 consistent-probability sampling). Adds a
`policies:` key to `autotel.yaml` and a new `autotel/policy` export.

**BigQuery plugin** — three call paths were previously untraced. `createJob()`,
the generic escape hatch used for GCS-to-BigQuery load jobs built from an
explicit configuration, now gets a span, as does `Job.promise()`, the wait for
that job to finish. Without the latter a multi-minute load looked instantaneous:
job creation was traced and the work was not. `createQueryStream()` is now
instrumented for result sets too large to buffer, with the span held open and
closed when the stream ends, errors, or closes, so its duration is the read
rather than the few milliseconds of setup.

`JOB_WAIT` and `GET_QUERY_RESULTS` spans now carry job cost statistics —
`gcp.bigquery.job.total_bytes_processed`, `total_bytes_billed`, `total_slot_ms`
and `cache_hit` — answering which query burned the bytes and slots. These are
read from job metadata that is already present, so there is no extra API round
trip.
