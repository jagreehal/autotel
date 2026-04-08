# autotel-devtools Monorepo Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `autotel-devtools` from `autotel-extras` into the main autotel monorepo, aligned with monorepo conventions and with `autotel-ai-insights` removed.

**Architecture:** Copy source files, replace Vite server build with tsup, keep Vite for the widget IIFE bundle, remove AIInsightsView and all ai-insights references, add CJS output for server exports, wire into Turbo pipeline.

**Tech Stack:** tsup, Vite, Preact, Tailwind CSS, vitest, TypeScript, pnpm workspaces

---

### Task 1: Copy source files into monorepo

**Files:**
- Create: `packages/autotel-devtools/` (entire directory tree)

- [ ] **Step 1: Copy the source directory**

```bash
cp -r /Users/jreehal/dev/node-examples/autotel-extras/packages/autotel-devtools /Users/jreehal/dev/node-examples/autotel/packages/autotel-devtools
```

- [ ] **Step 2: Remove node_modules and dist from the copy**

```bash
rm -rf /Users/jreehal/dev/node-examples/autotel/packages/autotel-devtools/node_modules
rm -rf /Users/jreehal/dev/node-examples/autotel/packages/autotel-devtools/dist
```

- [ ] **Step 3: Verify directory exists with expected structure**

```bash
ls /Users/jreehal/dev/node-examples/autotel/packages/autotel-devtools/src/
```

Expected: `cli.ts  index.ts  server/  widget/`

- [ ] **Step 4: Commit**

```bash
git add packages/autotel-devtools/
git commit -m "chore: copy autotel-devtools from autotel-extras"
```

---

### Task 2: Remove autotel-ai-insights references

**Files:**
- Delete: `packages/autotel-devtools/src/widget/components/AIInsightsView.tsx`
- Modify: `packages/autotel-devtools/src/widget/components/Panel.tsx`
- Modify: `packages/autotel-devtools/src/widget/components/TabContainer.tsx`
- Modify: `packages/autotel-devtools/src/widget/types.ts`
- Modify: `packages/autotel-devtools/package.json`

- [ ] **Step 1: Delete AIInsightsView.tsx**

```bash
rm packages/autotel-devtools/src/widget/components/AIInsightsView.tsx
```

- [ ] **Step 2: Remove AIInsightsView from Panel.tsx**

In `packages/autotel-devtools/src/widget/components/Panel.tsx`:

Remove the import line:
```typescript
import { AIInsightsView } from './AIInsightsView';
```

Remove the `Sparkles` icon import (change line 12 from):
```typescript
  Sparkles,
```
(delete this line)

Remove the ai-insights tab entry from the `tabs` array (delete this line):
```typescript
      { id: 'ai-insights', label: 'AI Insights', icon: Sparkles },
```

Remove the ai-insights case from `renderTabContent` switch (delete these lines):
```typescript
      case 'ai-insights': {
        return <AIInsightsView />;
      }
```

- [ ] **Step 3: Remove AIInsightsView from TabContainer.tsx**

In `packages/autotel-devtools/src/widget/components/TabContainer.tsx`:

Remove the import line:
```typescript
import { AIInsightsView } from './AIInsightsView'
```

Remove `Sparkles` from the lucide-preact import (change from):
```typescript
import { Database, Boxes, Network, BarChart, FileText, AlertTriangle, Sparkles } from 'lucide-preact'
```
to:
```typescript
import { Database, Boxes, Network, BarChart, FileText, AlertTriangle } from 'lucide-preact'
```

Remove the ai-insights tab from the `TABS` array (delete this line):
```typescript
  { id: 'ai-insights', label: 'AI Insights', icon: Sparkles },
```

Remove the ai-insights case from `TabContent` switch (delete this line):
```typescript
    case 'ai-insights': return <AIInsightsView />
```

- [ ] **Step 4: Remove 'ai-insights' from TabType in types.ts**

In `packages/autotel-devtools/src/widget/types.ts`, change:
```typescript
export type TabType =
  | 'traces'
  | 'resources'
  | 'service-map'
  | 'metrics'
  | 'logs'
  | 'errors'
  | 'ai-insights';
```
to:
```typescript
export type TabType =
  | 'traces'
  | 'resources'
  | 'service-map'
  | 'metrics'
  | 'logs'
  | 'errors';
```

- [ ] **Step 5: Remove autotel-ai-insights from package.json**

In `packages/autotel-devtools/package.json`, remove from `peerDependencies`:
```json
    "autotel-ai-insights": "workspace:*"
```

And remove from `peerDependenciesMeta`:
```json
    "autotel-ai-insights": {
      "optional": true
    }
```

- [ ] **Step 6: Search for any remaining ai-insights references**

```bash
cd /Users/jreehal/dev/node-examples/autotel && grep -r "ai-insights\|ai_insights\|AIInsights\|autotel-ai-insights" packages/autotel-devtools/src/ --include="*.ts" --include="*.tsx"
```

Expected: no output. If any found, remove them.

- [ ] **Step 7: Commit**

```bash
git add -A packages/autotel-devtools/
git commit -m "feat(autotel-devtools): remove autotel-ai-insights dependency and AIInsightsView"
```

---

### Task 3: Replace Vite server build with tsup

**Files:**
- Create: `packages/autotel-devtools/tsup.config.ts`
- Modify: `packages/autotel-devtools/vite.config.ts` (remove build config, keep vitest only)
- Modify: `packages/autotel-devtools/package.json`

- [ ] **Step 1: Create tsup.config.ts**

Create `packages/autotel-devtools/tsup.config.ts`:

```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    cli: 'src/cli.ts',
    'server/index': 'src/server/index.ts',
    'server/exporter': 'src/server/exporter.ts',
    'server/log-exporter': 'src/server/log-exporter.ts',
    'server/remote-exporter': 'src/server/remote-exporter.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  treeshake: true,
  splitting: false,
  minify: false,
  external: [
    'ws',
    '@opentelemetry/api',
    '@opentelemetry/sdk-trace-base',
    '@opentelemetry/sdk-logs',
    '@opentelemetry/core',
    'autotel',
  ],
})
```

- [ ] **Step 2: Replace vite.config.ts with vitest-only config**

Replace `packages/autotel-devtools/vite.config.ts` with:

```typescript
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'

const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        plugins: [
          storybookTest({
            configDir: path.join(dirname, '.storybook'),
          }),
        ],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
```

- [ ] **Step 3: Remove 'autotel-ai-insights' from vite externals**

Check the new `vite.config.ts` — since we replaced the file, the old `rollupOptions.external` with `'autotel-ai-insights'` is already gone. No action needed.

- [ ] **Step 4: Update package.json scripts and add tsup dev dep**

In `packages/autotel-devtools/package.json`, change scripts:

```json
"scripts": {
  "build": "tsup && vite build --config vite.widget.config.ts",
  "dev": "tsup --watch",
  "type-check": "tsc --noEmit",
  "lint": "eslint src/",
  "test": "vitest run",
  "test:watch": "vitest",
  "storybook": "storybook dev -p 6006",
  "build-storybook": "storybook build"
}
```

Add `tsup` to devDependencies:
```json
"tsup": "^8.4.0"
```

Remove `vite-plugin-dts` from devDependencies (tsup generates its own .d.ts):
```json
"vite-plugin-dts": "^4.5.4"
```
(delete this line)

- [ ] **Step 5: Add CJS exports to package.json**

Update the exports field to include CJS:

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js",
    "require": "./dist/index.cjs"
  },
  "./server": {
    "types": "./dist/server/index.d.ts",
    "import": "./dist/server/index.js",
    "require": "./dist/server/index.cjs"
  },
  "./exporter": {
    "types": "./dist/server/exporter.d.ts",
    "import": "./dist/server/exporter.js",
    "require": "./dist/server/exporter.cjs"
  }
}
```

Also add `"sideEffects": false` at the top level of package.json.

- [ ] **Step 6: Verify CLI shebang will be preserved**

The bin field stays as:
```json
"bin": {
  "autotel-devtools": "./dist/cli.js"
}
```

`src/cli.ts` has `#!/usr/bin/env node` on line 1. tsup detects and preserves shebangs from source files automatically. No extra config needed.

If the shebang is missing after build (verified in Task 5 Step 4), create `packages/autotel-devtools/bin/cli.js` as a fallback:

```javascript
#!/usr/bin/env node
import '../dist/cli.js'
```

And update package.json bin to `"./bin/cli.js"`.

- [ ] **Step 7: Update autotel peer dep version**

In `packages/autotel-devtools/package.json`, change:
```json
"autotel": "^2.21.0"
```
to:
```json
"autotel": "workspace:*"
```

- [ ] **Step 8: Commit**

```bash
git add packages/autotel-devtools/tsup.config.ts packages/autotel-devtools/vite.config.ts packages/autotel-devtools/package.json
git commit -m "feat(autotel-devtools): migrate server build to tsup, add CJS output"
```

---

### Task 4: Align TypeScript and vitest config

**Files:**
- Modify: `packages/autotel-devtools/tsconfig.json`
- Modify: `packages/autotel-devtools/vitest.shims.d.ts` (keep as-is if needed by storybook tests)

- [ ] **Step 1: Update tsconfig.json to match monorepo conventions**

Replace `packages/autotel-devtools/tsconfig.json` with:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "jsx": "react-jsx",
    "jsxImportSource": "preact"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.test.tsx"]
}
```

Changes from original:
- Added `isolatedModules: true` (monorepo convention)
- Removed `esModuleInterop: true` (not needed with bundler resolution)

- [ ] **Step 2: Keep vitest.shims.d.ts**

The file contains `/// <reference types="@vitest/browser-playwright" />` which is needed for Storybook browser tests. Keep it.

- [ ] **Step 3: Verify type-check passes**

```bash
cd /Users/jreehal/dev/node-examples/autotel && pnpm --filter autotel-devtools type-check
```

Expected: no errors. If there are errors from removing `esModuleInterop`, add it back.

- [ ] **Step 4: Commit**

```bash
git add packages/autotel-devtools/tsconfig.json
git commit -m "chore(autotel-devtools): align tsconfig with monorepo conventions"
```

---

### Task 5: Install dependencies and verify build

**Files:**
- Modify: root lockfile (via pnpm install)

- [ ] **Step 1: Install dependencies**

```bash
cd /Users/jreehal/dev/node-examples/autotel && pnpm install
```

Expected: successful install, autotel-devtools appears in workspace packages.

- [ ] **Step 2: Run the build**

```bash
pnpm --filter autotel-devtools build
```

Expected: tsup builds server files to `dist/` (index.js, index.cjs, cli.js, cli.cjs, server/*.js, server/*.cjs, plus .d.ts files), then Vite builds widget to `dist/widget.global.js`.

- [ ] **Step 3: Verify build output**

```bash
ls /Users/jreehal/dev/node-examples/autotel/packages/autotel-devtools/dist/
```

Expected files:
- `index.js`, `index.cjs`, `index.d.ts`
- `cli.js`, `cli.cjs`, `cli.d.ts`
- `server/index.js`, `server/index.cjs`, `server/index.d.ts`
- `server/exporter.js`, `server/exporter.cjs`, `server/exporter.d.ts`
- `server/log-exporter.js`, `server/log-exporter.cjs`, `server/log-exporter.d.ts`
- `server/remote-exporter.js`, `server/remote-exporter.cjs`, `server/remote-exporter.d.ts`
- `widget.global.js`

- [ ] **Step 4: Verify CLI shebang**

```bash
head -1 /Users/jreehal/dev/node-examples/autotel/packages/autotel-devtools/dist/cli.js
```

Expected: `#!/usr/bin/env node`

If missing, create `packages/autotel-devtools/bin/cli.js`:

```javascript
#!/usr/bin/env node
import '../dist/cli.js'
```

And update `package.json` bin to `"./bin/cli.js"`.

- [ ] **Step 5: Verify type-check**

```bash
pnpm --filter autotel-devtools type-check
```

Expected: no errors.

- [ ] **Step 6: Fix any build issues**

Address any errors from steps 2-5. Common issues:
- Missing externals in tsup (add to external array)
- Widget build can't find `__dirname` (Vite widget config uses it — should work since it's a Vite build, not tsup)
- Type errors from stricter config (fix in source)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(autotel-devtools): install deps and verify build"
```

---

### Task 6: Run tests and lint

**Files:**
- No file changes expected (fix issues if found)

- [ ] **Step 1: Run unit tests**

```bash
pnpm --filter autotel-devtools test
```

Expected: all 12 test files pass. If AIInsightsView had tests, they would fail since we deleted it — but the exploration showed it had no test file.

- [ ] **Step 2: Run lint**

```bash
pnpm --filter autotel-devtools lint
```

Expected: no errors. The eslint config references storybook plugin — verify it works.

- [ ] **Step 3: Run type-check**

```bash
pnpm --filter autotel-devtools type-check
```

Expected: no errors.

- [ ] **Step 4: Fix any failures**

Common issues:
- Tests importing from paths that changed (shouldn't happen — we didn't move files)
- Lint errors from unused imports after AIInsightsView removal (fix them)
- Type errors from stricter config

- [ ] **Step 5: Commit fixes if any**

```bash
git add -A packages/autotel-devtools/
git commit -m "fix(autotel-devtools): resolve test and lint issues after migration"
```

---

### Task 7: Add CLAUDE.md for the package

**Files:**
- Create: `packages/autotel-devtools/CLAUDE.md`

- [ ] **Step 1: Create CLAUDE.md**

Create `packages/autotel-devtools/CLAUDE.md`:

```markdown
# autotel-devtools

Standalone OTLP receiver with a Preact-based web UI for local development observability.

## Architecture

Two build outputs:
- **Server** (tsup): Node.js library + CLI — receives OTLP data via HTTP, streams to browser via WebSocket
- **Widget** (Vite IIFE): Browser bundle — `<autotel-devtools>` custom element with Shadow DOM isolation

## Quick Commands

```bash
pnpm build              # Build server (tsup) + widget (Vite IIFE)
pnpm test               # Run all tests
pnpm lint               # Lint source
pnpm type-check         # TypeScript check
pnpm storybook          # Launch Storybook for widget components
```

## Package Exports

- `.` — `createDevtools()` factory, types, re-exports
- `./server` — `DevtoolsServer`, exporters, OTLP parsing, HTTP routes
- `./exporter` — `DevtoolsSpanExporter` (standalone)

## Key Files

- `src/index.ts` — Main entry, `createDevtools()` factory
- `src/cli.ts` — CLI binary (`npx autotel-devtools`)
- `src/server/` — WebSocket server, HTTP routes, OTLP parsing, exporters, error aggregation, telemetry limits
- `src/widget/` — Preact UI components, signals store, WebSocket client, custom element

## Boundaries

- **Widget uses Preact** (not React) with `jsxImportSource: "preact"`
- **Widget CSS**: Tailwind CSS inlined into IIFE bundle via PostCSS
- **Shadow DOM**: Widget CSS is isolated, does not leak into host page
- **Server build**: tsup (ESM + CJS). **Widget build**: Vite IIFE (separate config)
- Do not add Node.js APIs to widget code (it runs in the browser)
```

- [ ] **Step 2: Commit**

```bash
git add packages/autotel-devtools/CLAUDE.md
git commit -m "docs(autotel-devtools): add CLAUDE.md for package"
```

---

### Task 8: Update autotel core peer dep reference

**Files:**
- Modify: `packages/autotel/package.json` (update autotel-devtools version)

- [ ] **Step 1: Check current autotel-devtools peer dep in autotel core**

The autotel core `package.json` has `"autotel-devtools": "*"` in peerDependencies. Update to `"workspace:*"` so it resolves to the local package:

In `packages/autotel/package.json`, change:
```json
"autotel-devtools": "*"
```
to:
```json
"autotel-devtools": "workspace:*"
```

- [ ] **Step 2: Run pnpm install to update lockfile**

```bash
cd /Users/jreehal/dev/node-examples/autotel && pnpm install
```

- [ ] **Step 3: Commit**

```bash
git add packages/autotel/package.json pnpm-lock.yaml
git commit -m "chore: link autotel-devtools as workspace dependency in autotel core"
```

---

### Task 9: Full monorepo quality check

**Files:**
- No file changes expected

- [ ] **Step 1: Build all packages**

```bash
cd /Users/jreehal/dev/node-examples/autotel && pnpm build
```

Expected: all packages build successfully, including autotel-devtools.

- [ ] **Step 2: Run all tests**

```bash
pnpm test
```

Expected: all tests pass across all packages.

- [ ] **Step 3: Run lint across monorepo**

```bash
pnpm lint
```

Expected: no errors.

- [ ] **Step 4: Run type-check across monorepo**

```bash
pnpm type-check
```

Expected: no errors.

- [ ] **Step 5: Fix any cross-package issues**

If autotel core tests fail because they try to dynamically import `autotel-devtools` and the API changed, fix the import paths or mocks.

- [ ] **Step 6: Final commit if fixes needed**

```bash
git add -A
git commit -m "fix: resolve cross-package issues after autotel-devtools migration"
```
