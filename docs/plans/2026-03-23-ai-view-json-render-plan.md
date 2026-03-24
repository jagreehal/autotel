# AI View with json-render Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the AI sidebar with a full-width AI view (`A` key) that renders rich terminal UI via `@json-render/ink` when the AI calls a `render_ui` tool.

**Architecture:** Add `@json-render/ink` and `@json-render/core` as dependencies. Create a minimal 9-component catalog. Add a `render_ui` tool to the AI tools. Replace the `a` sidebar toggle with an `A` full-width view mode. The AI view shows chat history + a json-render `Renderer` for the latest spec.

**Tech Stack:** TypeScript, React/Ink, @json-render/ink, @json-render/core, vitest, zod

---

### Task 1: Install dependencies

**Files:**
- Modify: `packages/autotel-terminal/package.json`

**Step 1: Install @json-render/ink and @json-render/core**

Run: `pnpm --filter autotel-terminal add @json-render/ink @json-render/core`

**Step 2: Verify installation**

Run: `pnpm --filter autotel-terminal build`
Expected: Build succeeds (no code changes yet, just deps)

**Step 3: Commit**

```bash
git add packages/autotel-terminal/package.json pnpm-lock.yaml
git commit -m "chore(terminal): add @json-render/ink and @json-render/core dependencies"
```

---

### Task 2: Create the json-render catalog

**Files:**
- Create: `packages/autotel-terminal/src/ai/catalog.ts`
- Create: `packages/autotel-terminal/src/ai/catalog.test.ts`

**Step 1: Write failing test**

Create `packages/autotel-terminal/src/ai/catalog.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { catalog, InkRenderer } from './catalog';

describe('AI catalog', () => {
  it('exports a catalog with component definitions', () => {
    expect(catalog).toBeDefined();
    expect(typeof catalog.prompt).toBe('function');
  });

  it('exports an InkRenderer component', () => {
    expect(InkRenderer).toBeDefined();
    expect(typeof InkRenderer).toBe('function');
  });

  it('generates a system prompt describing available components', () => {
    const prompt = catalog.prompt({
      system: 'You are a test assistant',
    });
    expect(prompt).toContain('Table');
    expect(prompt).toContain('Badge');
    expect(prompt).toContain('BarChart');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter autotel-terminal test -- src/ai/catalog.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the catalog**

Create `packages/autotel-terminal/src/ai/catalog.ts`:

```typescript
import { defineCatalog } from '@json-render/core';
import { schema } from '@json-render/ink/schema';
import {
  standardComponentDefinitions,
  standardActionDefinitions,
} from '@json-render/ink/catalog';
import { createRenderer, standardComponents } from '@json-render/ink';

// Define catalog with only the components we need
const allowedComponents = new Set([
  'Table',
  'KeyValue',
  'Badge',
  'BarChart',
  'Text',
  'Box',
  'Heading',
  'Divider',
  'Card',
]);

// Filter to our minimal set
const filteredComponents = Object.fromEntries(
  Object.entries(standardComponentDefinitions).filter(([name]) =>
    allowedComponents.has(name),
  ),
);

export const catalog = defineCatalog(schema, {
  components: filteredComponents,
  actions: standardActionDefinitions,
});

export const InkRenderer = createRenderer(catalog, standardComponents);
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter autotel-terminal test -- src/ai/catalog.test.ts`
Expected: All pass

**Step 5: Commit**

```bash
git add packages/autotel-terminal/src/ai/catalog.ts packages/autotel-terminal/src/ai/catalog.test.ts
git commit -m "feat(terminal): create json-render catalog with 9 terminal components"
```

---

### Task 3: Add render_ui tool

**Files:**
- Modify: `packages/autotel-terminal/src/ai/tools.ts`
- Modify: `packages/autotel-terminal/src/ai/types.ts`

**Step 1: Add InkSpec type to types.ts**

Add to `packages/autotel-terminal/src/ai/types.ts`:

```typescript
/** json-render spec for rich AI output */
export type InkSpec = {
  root: string;
  elements: Record<
    string,
    {
      type: string;
      props?: Record<string, unknown>;
      children?: string[];
    }
  >;
};
```

**Step 2: Add render_ui tool to tools.ts**

Add a new `onRenderUI` callback parameter to `createTelemetryTools` and add the tool. Update the function signature:

```typescript
export function createTelemetryTools(
  ctx: ToolContext,
  onRenderUI?: (spec: InkSpec) => void,
) {
```

Import `InkSpec`:
```typescript
import type { InkSpec } from './types';
```

Add the tool after `searchLogs` (before the closing `}` of the return):

```typescript
    renderUI: t({
      description:
        'Render rich terminal UI (tables, charts, badges) to display structured data. Use this when showing tabular data, comparisons, or metrics — not for short text answers. Available components: Table (columns + rows), KeyValue (key-value pairs), Badge (status labels: default/info/success/warning/error), BarChart (horizontal bars with labels), Card (grouped content with title), Heading (section title), Divider (separator), Text (styled text), Box (layout container).',
      parameters: z.object({
        spec: z
          .object({
            root: z.string().describe('ID of the root element'),
            elements: z
              .record(
                z.object({
                  type: z.string().describe('Component name'),
                  props: z.record(z.unknown()).optional(),
                  children: z.array(z.string()).optional(),
                }),
              )
              .describe('Map of element ID to component definition'),
          })
          .describe('json-render spec defining the UI to display'),
      }),
      execute: async ({ spec }: { spec: InkSpec }) => {
        onRenderUI?.(spec);
        return { rendered: true };
      },
    }),
```

**Step 3: Run tests**

Run: `pnpm --filter autotel-terminal test`
Expected: All pass (existing callers of `createTelemetryTools` don't pass `onRenderUI`, which is optional)

**Step 4: Commit**

```bash
git add packages/autotel-terminal/src/ai/tools.ts packages/autotel-terminal/src/ai/types.ts
git commit -m "feat(terminal): add render_ui tool for AI to output json-render specs"
```

---

### Task 4: Update system prompt with catalog and render_ui guidance

**Files:**
- Modify: `packages/autotel-terminal/src/ai/system-prompt.ts`

**Step 1: Update buildSystemPrompt to include render_ui guidance**

Replace the content of `system-prompt.ts`:

```typescript
import { catalog } from './catalog';

export function buildSystemPrompt(
  viewMode: string,
  contextJson: string,
): string {
  const catalogPrompt = catalog.prompt({
    system: '',
  });

  return `You are an OpenTelemetry expert assistant analyzing live telemetry data from a running application.
The user is viewing their ${viewMode} dashboard in a terminal TUI.

You have tools to query the telemetry data precisely. Use them to answer questions:
- getOverviewStats: high-level stats (spans, errors, latency)
- listServices: all services with error rates and p95
- findSlowestSpans: find slow spans, optionally by service
- findErrorTraces: find traces with errors
- getTraceDetail: deep dive into a specific trace
- searchSpans: search spans by name
- searchLogs: search logs by message content
- renderUI: display rich terminal UI (tables, charts, badges)

## Workflow
1. Use data tools first to gather data
2. Use renderUI to display structured results as tables, charts, or cards
3. Add a brief text explanation after the rendered UI

## When to use renderUI
- Tables: service lists, span comparisons, error summaries
- BarChart: latency distributions, service comparisons
- Badge: status indicators (OK/ERROR), severity levels
- Card + KeyValue: trace details, span attributes
- Do NOT use renderUI for short text answers or simple yes/no questions

## renderUI component reference
${catalogPrompt}

Keep text responses under 300 words.
Use specific span names, durations, and attribute values from the data.

Current dashboard summary:
${contextJson}`;
}
```

**Step 2: Run tests**

Run: `pnpm --filter autotel-terminal test`
Expected: All pass

**Step 3: Commit**

```bash
git add packages/autotel-terminal/src/ai/system-prompt.ts
git commit -m "feat(terminal): update AI system prompt with render_ui guidance and catalog"
```

---

### Task 5: Add 'ai' to ViewMode and A key handler

**Files:**
- Modify: `packages/autotel-terminal/src/lib/dashboard-keymap.ts`
- Modify: `packages/autotel-terminal/src/lib/dashboard-keymap.test.ts`

**Step 1: Write failing test**

Add to `dashboard-keymap.test.ts`:

```typescript
it('toggles AI view on A', () => {
  const state: DashboardState = {
    viewMode: 'trace',
    paused: false,
    recording: false,
    spanFilters: { statusGroup: 'all' },
  };
  const result = handleKey(state, 'A');
  expect(result.next.viewMode).toBe('ai');
  expect(result.actions).toContainEqual({
    type: 'toggleViewMode',
    viewMode: 'ai',
  });

  const result2 = handleKey(result.next, 'A');
  expect(result2.next.viewMode).toBe('trace');
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter autotel-terminal test -- src/lib/dashboard-keymap.test.ts`
Expected: FAIL

**Step 3: Implement**

In `dashboard-keymap.ts`:

Update ViewMode:
```typescript
export type ViewMode = 'trace' | 'span' | 'log' | 'service-summary' | 'errors' | 'topology' | 'ai';
```

Add handler after the `G` handler:
```typescript
if (input === 'A') {
  const viewMode = state.viewMode === 'ai' ? 'trace' : 'ai';
  next = { ...state, viewMode };
  actions.push({ type: 'toggleViewMode', viewMode });
  return { next, actions };
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter autotel-terminal test -- src/lib/dashboard-keymap.test.ts`
Expected: All pass

**Step 5: Commit**

```bash
git add packages/autotel-terminal/src/lib/dashboard-keymap.ts packages/autotel-terminal/src/lib/dashboard-keymap.test.ts
git commit -m "feat(terminal): add AI view mode (A key) to dashboard keymap"
```

---

### Task 6: Wire full-width AI view into index.tsx and remove sidebar

**Files:**
- Modify: `packages/autotel-terminal/src/index.tsx`

This is the largest task. It involves:

**Step 1: Update ViewMode in useState**

Find the `useState` for viewMode (line ~167) and add `'ai'`:
```typescript
const [viewMode, setViewMode] = useState<
  'trace' | 'span' | 'log' | 'service-summary' | 'errors' | 'topology' | 'ai'
>('trace');
```

**Step 2: Add aiSpec state and import InkRenderer**

Add import at top:
```typescript
import { InkRenderer } from './ai/catalog';
import type { InkSpec } from './ai/types';
```

Add state after existing AI state (line ~190):
```typescript
const [aiSpec, setAiSpec] = useState<InkSpec | null>(null);
```

**Step 3: Pass onRenderUI callback to createTelemetryTools**

In `sendAIQuery` (line ~502), update the call:
```typescript
const tools = createTelemetryTools(toolCtx, (spec) => setAiSpec(spec));
```

Also clear the previous spec when starting a new query — add before the streaming section:
```typescript
setAiSpec(null);
```

**Step 4: Replace `a` key handler with `A` key handler**

Find the `if (input === 'a')` block (line ~677). Replace it with:

```typescript
if (input === 'A') {
  const newMode = viewMode === 'ai' ? 'trace' : 'ai';
  setViewMode(newMode as typeof viewMode);
  if (newMode === 'ai') {
    if (aiState.status !== 'unconfigured') {
      setAiInputMode(true);
    }
  } else {
    setAiInputMode(false);
  }
  setSelected(0);
  setDrilldownTraceId(null);
  setDrilldownSelectedIndex(0);
  setDrilldownScrollOffset(0);
  return;
}
```

**Step 5: Update headerModeLabel**

Add `'ai'` to the ternary chain:
```typescript
: viewMode === 'ai'
  ? 'AI'
```

**Step 6: Update help text**

Change `Views: t/l/v/E/G` to `Views: t/l/v/E/G/A`

**Step 7: Update counts display**

Add to the counts ternary:
```typescript
: viewMode === 'ai'
  ? `messages ${aiMessages.length}`
```

**Step 8: Add full-width AI view rendering**

After the topology view block (`{viewMode === 'topology' && ...}`), add:

```tsx
{viewMode === 'ai' && (
  <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={0}>
    <Box marginBottom={1} justifyContent="space-between">
      <Text bold>AI Assistant</Text>
      <Text dimColor>
        {aiState.status === 'streaming'
          ? '(streaming...)'
          : aiState.status === 'unconfigured'
            ? '(no provider)'
            : aiState.status === 'error'
              ? '(error)'
              : ''}
      </Text>
    </Box>

    {aiState.status === 'unconfigured' ? (
      <Box flexDirection="column">
        <Text dimColor>No AI provider configured.</Text>
        <Text dimColor>Set AI_PROVIDER and AI_MODEL env vars, or start Ollama locally.</Text>
        <Text dimColor>Press A to close this view.</Text>
      </Box>
    ) : (
      <>
        {aiMessages.length === 0 && aiState.status !== 'error' && (
          <Text dimColor>Ask a question about your telemetry data. Press Enter to send.</Text>
        )}
        {aiMessages.slice(-10).map((msg, i) => (
          <Box key={i} flexDirection="column" marginBottom={msg.role === 'assistant' ? 1 : 0}>
            <Text color={msg.role === 'user' ? 'cyan' : undefined}>
              {msg.role === 'user' ? '> ' : ''}
              {msg.content.slice(0, 1000)}
              {msg.content.length > 1000 ? '...' : ''}
            </Text>
          </Box>
        ))}
        {aiSpec && (
          <Box flexDirection="column" marginBottom={1} borderStyle="single" borderColor="gray" paddingX={1}>
            <InkRenderer spec={aiSpec} state={{}} />
          </Box>
        )}
        {aiState.status === 'error' && (
          <Text color="red">Error: {aiState.message}</Text>
        )}
        <Box marginTop={1} borderStyle="single" borderColor="cyan" paddingX={1}>
          <Text color="cyan">&gt; </Text>
          <Text>
            {aiInput || (aiInputMode ? '(type your question)' : '(press A to focus)')}
          </Text>
        </Box>
      </>
    )}
  </Box>
)}
```

**Step 9: Remove AI from the sidebar (right panel)**

In the 45%-width right panel (line ~1656), remove the `{aiActive ? (...) : (` conditional. The right panel should ONLY render the Details section now. Remove:
- The `aiActive` conditional wrapper
- The entire AI assistant JSX block inside the sidebar
- The `aiActive` state variable (line ~186) — it's no longer needed

Keep the Details panel as the only content of the right panel.

**Step 10: Guard the two-column layout**

The two-column layout (line ~1398, the `<Box flexDirection="row" gap={2}>` with 55%/45% split) should NOT render when viewMode is `'topology'` or `'ai'`. Update the existing guard:

```tsx
{viewMode !== 'topology' && viewMode !== 'ai' && (drilldownTraceId != null ? (
```

**Step 11: Run tests**

Run: `pnpm --filter autotel-terminal test`
Expected: All pass

**Step 12: Commit**

```bash
git add packages/autotel-terminal/src/index.tsx
git commit -m "feat(terminal): full-width AI view with json-render output, remove sidebar AI panel"
```

---

### Task 7: Final quality check

**Step 1: Run full quality suite**

Run: `pnpm --filter autotel-terminal quality`
Expected: type-check, test, lint, format, build, check-exports all pass

**Step 2: Fix any issues**

If formatting fails: `npx prettier --write packages/autotel-terminal/src/**/*.ts`
If lint fails: fix the specific errors
If type-check fails: fix the type issues

**Step 3: Commit fixes if any**

**Step 4: Create changeset**

Run: `pnpm changeset`
Select: `autotel-terminal` → minor
Summary: "Replace AI sidebar with full-width AI view (A key) using @json-render/ink for rich terminal output"
