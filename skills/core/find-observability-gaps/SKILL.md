---
name: find-observability-gaps
description: >
  Scores the observability of every entry point in a codebase with `autotel map`
  and closes the gaps it reports. Use this skill when asked which handlers are
  uninstrumented or dark, what an app's observability coverage is, how to raise
  an observability score, or how to gate CI so instrumentation cannot regress.
  Do not use for judgement calls the scanner cannot make (span naming,
  cardinality, what belongs in a wide event) — use skill `review-otel-patterns`;
  for spans that exist in code but never reach a backend — use skill
  `debug-missing-spans`; or for first-time setup — use skill `autotel-cli`.
---

# find-observability-gaps

`autotel map` reads the source, finds every entry point for the detected
framework, and reports what context each would carry when it breaks. Static
analysis only: nothing runs, nothing leaves the machine.

## Critical rules

- Run with `--json` and act on the data. Every failing check carries `evidence` (file, line, snippet) and `fix` (the code that makes it pass). Do not guess what a handler is missing.
- Pass `--no-write` unless the user wants `autotel.map.json` updated. A regression run refuses to overwrite the baseline it compared against, but an ordinary run rewrites the file.
- Fix the failures the tool names. Do not raise a score by deleting routes, lowering `--min-score`, or adding waiver comments the user did not ask for.
- A waiver needs a reason: `// autotel-map-disable <check> -- why this is fine`. Waived checks cost no score and are counted apart from real coverage in `summary.suppressedChecks`.
- The scan reports what the source says. A handler wrapped by middleware registered somewhere the scan does not recognise as wiring reads as untraced; confirm against a real trace before rewriting working code.

## Workflow

1. Run `npx autotel map --json --no-write`. An unsupported framework exits with a validation error naming the supported list; pass `--framework <name>` when detection is wrong.
2. Read `summary` (instrumented / partial / dark / exempt) and `map.score` for the shape of the problem.
3. Work `map.routes` sorted by `score` ascending, weighting `sensitivity.level === 'high'` first. Money and auth routes count double in the project score.
4. For each failing check apply its `fix` at its `evidence.line`. Re-run to confirm the check flipped to `pass`.
5. Report the score before and after, and name anything you left because it needed a product decision.

## Checks

Requirements cost score points. A handler starts at 100 and loses the weight of each failure.

| Check                 | Weight | Applies to | Passes when                                                           |
| --------------------- | ------ | ---------- | --------------------------------------------------------------------- |
| `trace`               | 40     | handlers   | `trace()`, `span()`, `instrument()`, or a framework wrapper covers it |
| `context`             | 25     | handlers   | `getRequestLogger()` plus `.set()` / `.info()`                        |
| `audit`               | 25     | handlers   | `withAudit()` or `securityEvent()` on money and auth paths            |
| `page-error-handling` | 20     | pages      | Every fetch on the page has an error path                             |
| `structured-errors`   | 15     | handlers   | `createStructuredError()` carrying `why` and `fix`                    |
| `error-handling`      | 10     | handlers   | Catch blocks log the error or rethrow                                 |

Five opportunities never cost points and stay quiet until the project already has the thing they suggest: `audit-coverage` (state change with no security event), `error-catalog` (the same error repeated across files), `genai` (LLM call with no `gen_ai.*` span), `validation` (Zod parse with no telemetry), `redaction` (sensitive routes, no `attributeRedactor`).

Health checks, probes, metrics endpoints, and pages that fetch nothing are exempt. Exempt entries are excluded from the score, so they cannot inflate it.

## Reading a finding

```jsonc
{
  "path": "/checkout",
  "method": "POST",
  "score": 40,
  "sensitivity": { "level": "high", "reasons": ["money: imports stripe"] },
  "checks": {
    "trace": { "status": "pass" },
    "context": {
      "status": "fail",
      "message": "no request-scoped attributes — the span says what failed, not for whom",
      "fix": "const log = getRequestLogger(); log.set({ 'user.id': userId });",
      "evidence": {
        "file": "src/routes/checkout.ts",
        "line": 24,
        "snippet": "app.post('/checkout', async (c) => {",
      },
    },
  },
}
```

`status` is `pass`, `fail`, or `n/a`. An `n/a` with `suppressed: true` was waived by a comment; an `n/a` without it means the question does not apply here.

## Gating CI

```bash
npx autotel map --min-score 70                            # a floor
npx autotel map --baseline git:origin/main                # a ratchet
```

`--min-score` fails below an absolute bar. `--baseline` compares check by check, so a refactor that instruments one route and breaks another still fails even though the average did not move. Turning a passing check into a disable comment counts as a regression. New dark routes are reported without failing the build; that bar belongs to `--min-score`.

`--baseline` reads from disk or through `git show`. No network and no token, so a private repo gates like a public one.

## Frameworks

`next`, `nitro`, `sveltekit`, `tanstack-start`, `cloudflare`, `hono`, `express`, `fastify`, `elysia`. Detection reads `package.json` and the `wrangler` config.

For frameworks that register many routes in one file, each handler is scored on its own body, so forty routes in one `index.ts` get forty scores.

## Common mistakes

### HIGH: Treating the score as ground truth about production

The map reads source. A route it calls dark may be traced by middleware it could not see. Check a real trace before rewriting a handler that works.

### HIGH: Waiving a check to make CI pass

A waiver is a decision with a reason, recorded next to the code. Reaching for one to clear a gate hides the gap and still shows up in `summary.suppressedChecks`.

### MEDIUM: Fixing every finding at once

The default view names three for a reason. Sensitive routes weigh double; a dark payment endpoint moves the number further than four dark search endpoints.

## Related

- Skill `autotel-cli` for the rest of the command surface, including `doctor`.
- Skill `review-otel-patterns` for the judgement the scanner cannot make.
- Skill `autotel-request-logging` and skill `autotel-structured-errors` for the APIs most fixes reach for.
