# Contract Testing Observability Demo

Production-grade observability for contract testing workflows using Autotel. This demo shows how to instrument contract testing pipelines (`contract-check`, `contract-test`, `pact-verify`) with comprehensive traces, structured logging, and product events for better reliability and faster triage.

## Why This Matters

Contract testing failures are hard to debug without proper observability. This demo shows how to:

- **Trace workflow phases** — Each step (generate, sync, normalize, verify) has its own span with timing
- **Identify failures quickly** — Deterministic error codes and attributes power automated triage and gating
- **Track trends over time** — Product events show drift patterns, sync behavior, and verification success rates
- **Correlate across systems** — Trace IDs link contract checks to deployment events and service changes

## Features

✅ **Phase Tracing** — `consumer.generate`, `pacts.sync`, `pacts.normalize`, `provider.verify`, `contract.health.audit`

✅ **Structured Errors** — Typed error codes (`PROVIDER_VERIFY_FAILED`, `CONTRACT_MISSING_PROVIDER_COPY`) with remediation guidance

✅ **Rich Attributes** — Contract-specific span attributes for triage: `contract.consumer`, `contract.provider`, `contract.diff_type`, `contract.check`

✅ **Product Events** — `contract_check_completed`, `contract_sync_performed`, `contract_verification_failed` for trend analysis

✅ **Request Snapshots** — One-shot execution log via `getRequestLogger().emitNow()` showing full execution context

✅ **Built-in Redaction** — Automatic masking of tokens, authorization headers, and sensitive fields

## Prerequisites

- Node.js 22+
- pnpm (or npm/yarn)
- Optional: OTLP-compatible backend (e.g., Jaeger, Datadog, Grafana Cloud)

## Setup

```bash
# From repository root
pnpm install

# Optional: set OTLP endpoint if not using localhost:4318
export OTLP_ENDPOINT=https://your-otel-backend.example.com:4318
```

## Running the Demo

```bash
# From repository root
pnpm --filter @jagreehal/example-contract-testing start
```

You'll see:
- Console table of contract pair statuses
- Trace summary with counts (healthy, stale, uncommitted, sync gaps, failures)
- Log output showing each pair audit with structured error details
- Telemetry events sent to your OTLP endpoint

### What Gets Traced

The demo simulates three contract pairs:

| Pair | Status | Purpose |
|------|--------|---------|
| `admin → account` | ✅ Healthy | Shows clean contract check with all attributes |
| `digest → membership` | ⚠️ Warn | Stale + uncommitted with UUID-only diff noise |
| `reconciler → messagequeue` | ❌ Fail | Missing provider copy + verification failure |

## Architecture

```
┌─────────────────────────────────┐
│  Contract Health Audit Span     │ (runId, workflow_id, mode)
│  ├─ Consumer.generate Span      │ (consumer_count)
│  ├─ Pacts.sync Span             │ (uncommitted_count)
│  ├─ Pacts.normalize Span        │
│  ├─ Provider.verify Span        │ (verify_failed_count)
│  └─ Pair Audit Loop             │
│     ├─ contract.pair.audit (x3) │ (consumer, provider, status, diff_type)
│     │  └─ Error log (on fail)   │ (code, reason, fix)
│     └─ Product event emission   │ (contract_check_completed, etc)
└─────────────────────────────────┘
```

## Key Patterns

### 1. Workflow Tracing

```typescript
const summary = await span('contract.demo.run', async () => {
  return runner.run(config, async () => {
    await trace('consumer.generate', async () => { ... });
    await trace('pacts.sync', async () => { ... });
    // ... other phases
  });
});
```

### 2. Pair-level Audits with Attributes

```typescript
pairSpan.setAttributes({
  'contract.consumer': pair.consumer,
  'contract.provider': pair.provider,
  'contract.status': inferStatus(pair),
  'contract.diff_type': pair.diffType,
});
```

### 3. Structured Errors with Remediation

```typescript
if (pair.verificationFailed) {
  const err = createStructuredError({
    message: 'Contract verification failed',
    why: 'Pair digest→membership failed checks',
    fix: 'Sync pacts, normalize values, re-run verification',
    code: 'PROVIDER_VERIFY_FAILED',
  });
  log.error(err, { pair, contract_file: pair.file });
}
```

### 4. Product Events for Trends

```typescript
track('contract_check_completed', {
  run_id: runId,
  service: input.service,
  status: summary.status,
  checked_pairs: summary.checkedPairs,
  // ... additional context
});
```

## Extending the Demo

### Adding Custom Contract Pairs

Edit `src/index.ts` to add your contract pairs:

```typescript
const scenarios: ContractPairResult[] = [
  {
    consumer: 'your-service',
    provider: 'their-api',
    file: 'contracts/your-service-their-api.json',
    stale: false,
    syncGap: false,
    missingProviderCopy: false,
    uncommitted: false,
    verificationFailed: false,
    diffType: 'none',
  },
];
```

**Field Reference:**

| Field | Type | Purpose |
|-------|------|---------|
| `consumer` | string | Consumer service name |
| `provider` | string | Provider service name |
| `file` | string | Path to pact file |
| `stale` | boolean | Contract older than threshold |
| `syncGap` | boolean | Consumer version not synced to broker |
| `missingProviderCopy` | boolean | Provider hasn't downloaded contract |
| `uncommitted` | boolean | Local changes not committed |
| `verificationFailed` | boolean | Provider verification failed |
| `diffType` | 'none' \| 'uuid-noise' \| 'timestamp-noise' \| 'semantic-change' | Type of difference |
| `diffNoiseFields?` | string[] | Fields that are just noise (optional) |
| `reason?` | string | Failure explanation (optional) |

### Customizing Trace Phases

Modify workflow phases in `src/index.ts`:

```typescript
await trace('consumer.generate', async () => {
  // Your custom generation logic
  await yourConsumerGeneration();
});

await trace('pacts.sync', async () => {
  // Your custom sync logic
  await yourPactSync();
});
```

### Adding Custom Span Attributes

Enhance pair audits with custom attributes:

```typescript
pairSpan.setAttributes({
  'contract.team': 'platform',
  'contract.sla': '1h',
  'contract.owner': 'my-team',
});
```

### Customizing Error Codes

Modify error creation in `src/contract-observability.ts`:

```typescript
const err = createStructuredError({
  message: 'Your message',
  why: 'Why it happened',
  fix: 'How to fix it',
  code: 'YOUR_ERROR_CODE', // SCREAMING_SNAKE_CASE
});
```

### Change OTLP Endpoint

```bash
OTLP_ENDPOINT=https://your-backend.example.com:4318 pnpm start
```

Or modify `src/index.ts`:

```typescript
init({
  service: 'example-contract-testing',
  endpoint: process.env.OTLP_ENDPOINT || 'http://localhost:4318',
});
```

### Disable Telemetry (Local Testing)

```typescript
init({
  disabled: true, // Disables trace/event export
  debug: true,    // Logs to console instead
});
```

### Custom Redaction Policies

Extend sensitive field masking:

```typescript
init({
  attributeRedactor: {
    keyPatterns: [/authorization/i, /token/i, /api[_-]?key/i],
    valuePatterns: [
      {
        name: 'custom-pattern',
        pattern: /your_regex_here/g,
        replacement: '[REDACTED]',
      },
    ],
  },
});
```

### Emit Custom Product Events

Track metrics specific to your workflow:

```typescript
track('contract_audit_completed', {
  run_id: runId,
  service: input.service,
  team: 'platform',
  custom_metric: value,
});
```

## Expected Output

```
Contract Health Demo Summary
┌─────────────────────┬────────────────┐
│ runId               │ abc123...      │
│ status              │ warn           │
│ staleCount          │ 1              │
│ missingProviderCount│ 0              │
│ uncommittedCount    │ 1              │
│ syncGapCount        │ 0              │
│ verifyFailedCount   │ 0              │
│ checkedPairs        │ 3              │
└─────────────────────┴────────────────┘

Pair Statuses
┌─────────────────────────┬──────────────────────────────┬───────┐
│ pair                    │ file                         │ ...   │
│ admin->account          │ admin-consumer-account-...   │ ok    │
│ digest->membership      │ digest-consumer-membership.. │ warn  │
│ reconciler->messagequeue│ reconciler-consumer-message..│ fail  │
└─────────────────────────┴──────────────────────────────┴───────┘
```

## Integration with CI/CD

### Use Status for Gating

```bash
status=$(pnpm start | grep -A 1 'status' | tail -1)
if [ "$status" != "ok" ]; then
  echo "⚠️  Contract warnings detected"
  exit 0  # Warnings don't block
fi
```

### Report Events to Slack/Teams

Connect your OTLP backend to send alerts on `contract_verification_failed` events.

## Troubleshooting

### No Telemetry Received

1. Check `OTLP_ENDPOINT` — defaults to `http://localhost:4318`
2. Run locally: `docker run -p 4317:4317 -p 4318:4318 otel/opentelemetry-collector`
3. Set `debug: true` in `init()` to see console logs

### Spans Not Appearing

- Confirm `init()` is called before any `trace()` or `span()` calls
- Check `shutdown()` is called to flush traces

### Memory/Performance Issues

The demo stores all pair results in memory. For large contract suites, stream results instead of collecting.

## Files

- `src/index.ts` — Runnable demo with 3 contract pair scenarios
- `src/contract-observability.ts` — Reusable `ContractObservabilityRunner` abstraction
- `package.json` — Dependencies and scripts
- `tsconfig.json` — TypeScript configuration

## Testing & Debugging

### Local Testing (No OTLP Backend)

```bash
DEBUG=true pnpm start
```

All traces and events log to console instead of sending to OTLP.

### With Jaeger (Docker)

```bash
# Start Jaeger locally
docker run -p 4317:4317 -p 4318:4318 -p 16686:16686 otel/opentelemetry-collector

# Run demo
pnpm start

# View traces at http://localhost:16686
```

### Debugging Tips

Enable verbose logging:

```bash
DEBUG=true NODE_DEBUG=opentelemetry pnpm start
```

Check trace context in code:

```typescript
import { trace } from 'opentelemetry-api';

const span = trace.getActiveSpan();
console.log('Trace ID:', span?.spanContext().traceId);
console.log('Span ID:', span?.spanContext().spanId);
```

## Performance Considerations

For large contract suites (100+ pairs):

1. **Stream results** instead of collecting in memory
2. **Emit events incrementally** per pair
3. **Use sampling** to reduce event volume
4. **Batch spans** if needed for throughput

## File Structure

```
src/
  ├── index.ts                    # Main demo (edit to customize)
  └── contract-observability.ts   # Reusable runner (extend as needed)

Configuration:
  ├── package.json                # Dependencies
  ├── tsconfig.json               # TypeScript config
  ├── .env.example                # Environment template
  └── .gitignore                  # Git ignore rules

Documentation:
  ├── README.md                   # This file
```

## Real-World Integration Examples

### Slack Alerts

Connect your OTLP backend to post alerts on failures:

```typescript
track('contract_verification_failed', {
  run_id: runId,
  pair: `${pair.consumer}->${pair.provider}`,
  slack_channel: '#contracts',
});
```

### GitHub Issues

Auto-create issues from failed checks:

```typescript
if (pair.verificationFailed) {
  track('contract_needs_attention', {
    pair: `${pair.consumer}->${pair.provider}`,
    reason: pair.reason,
    github_repo: 'my-org/contracts',
  });
}
```

### Dashboard Metrics

Tag events for dashboard filtering:

```typescript
track('contract_check_completed', {
  run_id: runId,
  service: input.service,
  env: 'staging',
  status: summary.status,
});
```

## Related Documentation

- [Autotel Docs](https://autotel.dev)
- [Pact Testing](https://docs.pact.foundation)
- [OpenTelemetry](https://opentelemetry.io)
- [OTLP Protocol](https://opentelemetry.io/docs/specs/otel/protocol/)

## License

MIT
