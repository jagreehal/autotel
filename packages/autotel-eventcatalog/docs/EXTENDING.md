# Extending autotel-eventcatalog

The package extends in **one** direction: new renderers. Everything
else (the diff engine, the policy layer, the stamper) is stable by
design. See [CONTRIBUTING.md](../CONTRIBUTING.md#3-no-domain-specific-extensions-to-the-core)
for why.

## Writing a custom renderer

A renderer is a small adapter that turns a drift result into output
text. The built-ins are `markdown`, `terminal`, and `json`. To add a new
one (e.g. SARIF, Slack-flavoured markdown, GitHub Check Runs API JSON,
your in-house dashboard payload), implement the `Renderer` interface and
register it.

### Step 1: implement the interface

```typescript
// src/renderers/sarif.ts
import type { DriftReport } from '../diff';
import type { DriftDelta } from '../diff-vs-base';
import type { Renderer } from './types';

function renderReport(report: DriftReport): string {
  // SARIF (https://sarifweb.azurewebsites.net) wants a fixed envelope
  // with `runs[].results[]`. Each drift finding becomes one result.
  const results = [
    ...report.events.observedButUndocumented.map((name) => ({
      ruleId: 'autotel/event-undocumented',
      level: 'warning',
      message: { text: `Event \`${name}\` is emitted but not documented.` },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: `events/${name}` },
          },
        },
      ],
    })),
    // ... documented-but-unseen, field drift, services, channels
  ];

  return JSON.stringify(
    {
      version: '2.1.0',
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      runs: [
        {
          tool: {
            driver: {
              name: 'autotel-eventcatalog',
              informationUri: 'https://github.com/jagreehal/autotel',
            },
          },
          results,
        },
      ],
    },
    null,
    2,
  );
}

function renderDelta(delta: DriftDelta): string {
  // For PR-mode runs, emit results only for `delta.introduced`.
  // ... similar shape ...
  return JSON.stringify({
    /* ... */
  });
}

export const sarifRenderer: Renderer = {
  name: 'sarif',
  description:
    'Static Analysis Results Interchange Format (GitHub Code Scanning).',
  renderReport,
  renderDelta,
};
```

### Step 2: register it

Add the renderer to the registry in `src/renderers/index.ts`:

```typescript
import { sarifRenderer } from './sarif';

export const RENDERERS: readonly Renderer[] = [
  markdownRenderer,
  terminalRenderer,
  jsonRenderer,
  sarifRenderer, // ← new
];
```

The CLI's `--format sarif` works, the help text mentions it, and the
validator that catches bad `--format` values accepts it.

### Step 3: write the tests

```typescript
// src/renderers/sarif.test.ts
import { describe, it, expect } from 'vitest';
import { sarifRenderer } from './sarif';
import type { DriftReport } from '../diff';

const driftyReport: DriftReport = {
  snapshotGeneratedAt: '2026-05-22T00:00:00.000Z',
  snapshotService: 'fixture',
  events: {
    observedButUndocumented: ['order.cancelled'],
    documentedButUnseen: [],
    fieldDrift: [],
  },
  services: { observedButUndocumented: [] },
  channels: { observedButUndocumented: [] },
};

describe('sarifRenderer', () => {
  it('emits a valid SARIF v2.1.0 envelope', () => {
    const out = JSON.parse(sarifRenderer.renderReport(driftyReport));
    expect(out.version).toBe('2.1.0');
    expect(out.runs[0].tool.driver.name).toBe('autotel-eventcatalog');
    expect(out.runs[0].results).toHaveLength(1);
    expect(out.runs[0].results[0].ruleId).toBe('autotel/event-undocumented');
  });
});
```

### Step 4 (optional): document it

If the renderer will ship as a built-in, add a row to the "Renderers"
section in the README and bump the changeset (`pnpm changeset`).

## What a good renderer looks like

- **Pure function from input to string.** No I/O, no globals, no side
  effects. The CLI is responsible for writing output; the renderer is
  responsible for shaping it.
- **Handles both `renderReport` and `renderDelta`.** Even if you don't
  care about the delta mode, return _something_. Clean delta output is
  often "no new findings" plus the resolved section.
- **Self-contained.** A renderer should not import from `cli.ts`, from
  `policy.ts`, or from another renderer's internals. The core types
  (`DriftReport`, `DriftDelta`) are the only contract.
- **Deterministic.** Same input, same output. No timestamps from
  `Date.now()`, no random IDs. (The snapshot already carries
  `snapshotGeneratedAt` if you need a timestamp.)
- **Compact.** The Markdown renderer is ~120 lines. If yours is much
  longer, you're probably doing logic that belongs in the core. Push
  back to the renderer interface.

## When NOT to write a renderer

- **"I want to send drift to my dashboard."** Don't write a renderer for
  that. Your dashboard should poll the snapshot/drift endpoints (or
  parse the JSON envelope on its own). Renderers are for tools that
  consume the _output_, not the _event stream_.
- **"I want to gate CI differently."** That's a policy concern, not a
  rendering concern. See `policy.ts` and `evaluatePolicy`.
- **"I want field-level severity (P0/P1/P2)."** Severity classification
  is a policy decision that the renderer applies. A SARIF renderer can
  map every drift category to a SARIF level; that mapping lives in the
  renderer, not in the core types.

## A larger example: Slack Block Kit

```typescript
// src/renderers/slack.ts
import type { DriftReport } from '../diff';
import type { DriftDelta } from '../diff-vs-base';
import { countDriftReport } from '../diff';
import type { Renderer } from './types';

export const slackRenderer: Renderer = {
  name: 'slack',
  description: 'Slack Block Kit JSON. Post directly to a webhook.',
  renderReport(report) {
    const counts = countDriftReport(report);
    return JSON.stringify({
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: `${counts.total} drift findings` },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              report.events.observedButUndocumented.length > 0
                ? `*Undocumented:* ${report.events.observedButUndocumented.map((n) => `\`${n}\``).join(', ')}`
                : '_No new events to document._',
          },
        },
      ],
    });
  },
  renderDelta(delta) {
    /* ... */
    return JSON.stringify({ blocks: [] });
  },
};
```

Register, test, ship. Now `--format slack` produces JSON you can `curl`
straight to a Slack webhook URL.

## Library-mode renderers (out-of-tree)

If you don't want to upstream your renderer, the library API lets you
plug one in at runtime in your own code:

```typescript
import {
  diffCatalogAgainstSnapshot,
  readCatalogState,
  loadSnapshot,
} from 'autotel-eventcatalog';
import { myRenderer } from './my-renderer';

const snapshot = await loadSnapshot('./snapshot.json');
const catalog = await readCatalogState('./catalog');
const report = diffCatalogAgainstSnapshot(snapshot, catalog);

console.log(myRenderer.renderReport(report));
```

You don't have to modify the package to use your own renderer. Upstreaming
is for when the renderer has general value to other users.

## CLI-mode custom renderers

The CLI accepts `--register-renderer <module>` as a global option (any
subcommand). It dynamically imports the module, expects either a
`default` export or a named `renderer` export matching the `Renderer`
shape, and registers it. The renderer's `name` then works with `--format`.

```bash
# in your repo
cat > slack-renderer.mjs <<'EOF'
export const renderer = {
  name: 'slack',
  description: 'Slack Block Kit JSON.',
  renderReport(report) { /* return JSON string */ },
  renderDelta(delta) { /* return JSON string */ },
};
EOF

npx autotel-eventcatalog \
  --register-renderer ./slack-renderer.mjs \
  drift \
  --snapshot ./snapshot.json \
  --catalog ./catalog \
  --format slack \
  > slack-blocks.json

curl -X POST -H 'Content-Type: application/json' \
  --data @slack-blocks.json \
  "$SLACK_WEBHOOK_URL"
```

Pass `--register-renderer` more than once to load multiple renderers in
the same invocation. The loader refuses to overwrite a built-in name
(`markdown`, `terminal`, `json`, `eventcatalog-snapshot-diff`): pick a
unique `name` for your renderer.

Either ESM (`.mjs`) or compiled JavaScript works. TypeScript users should
compile to ESM first; the loader uses Node's native `import()` against a
file URL, so it cannot transpile on the fly.

## What's NOT extendable (and why)

| Surface             | Extension allowed?            | Why                                                                                                       |
| ------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| Renderers           | Yes (registry pattern)        | Output targets vary; core data does not                                                                   |
| New CLI commands    | No (without a user)           | See [CONTRIBUTING.md invariant #1](../CONTRIBUTING.md#1-no-new-top-level-commands-without-a-user)         |
| New diff categories | No (without ecosystem buy-in) | Each category cascades through diff/delta/counts/renderers/schemas                                        |
| Custom policies     | Yes, but file an issue first  | `evaluatePolicy` is small; an extension might earn its place but probably wants a new policy mode in core |
| Snapshot format     | No                            | Owned by `autotel-subscribers`; this package only consumes                                                |
| Stamp marker syntax | No                            | Backwards compatibility with previously-stamped catalogs                                                  |

If you want to extend something marked "no", file an issue describing the
use case. We'll figure out whether it belongs in this package, in
`autotel-subscribers`, in a new sister package, or in your own downstream
code.
