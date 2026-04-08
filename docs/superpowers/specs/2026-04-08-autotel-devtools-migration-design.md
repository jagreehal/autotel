# autotel-devtools Monorepo Migration

## Summary

Migrate `autotel-devtools` from `autotel-extras/packages/autotel-devtools` into `packages/autotel-devtools` in the main autotel monorepo. Align build, test, and config with monorepo conventions. Remove `autotel-ai-insights` dependency. No functional changes to existing features.

## Source Package

A standalone OTLP receiver with a Preact-based web UI for local development observability. Two modes:

- **Standalone server** (CLI): receives OTLP traces/logs/metrics via HTTP, streams to browser via WebSocket
- **Embeddable widget** (browser): `<autotel-devtools>` custom element with Shadow DOM isolation

Features: trace waterfall + flame graph, logs with severity filtering, error aggregation by fingerprint, metrics dashboard, service map, resource summary, trace export/import, floating bubble UI with drag/snap.

## Target Structure

```
packages/autotel-devtools/
  src/
    index.ts                    # createDevtools() factory
    cli.ts                      # CLI argument parsing + server startup
    server/
      index.ts                  # Server exports
      server.ts                 # DevtoolsServer (WebSocket + in-memory store)
      http.ts                   # HTTP routes (OTLP endpoints, widget bundle)
      otlp.ts                   # OTLP JSON parsing
      types.ts                  # Core interfaces
      exporter.ts               # In-process SpanExporter
      log-exporter.ts           # LogRecordExporter
      remote-exporter.ts        # Remote HTTP SpanExporter with retry
      error-aggregator.ts       # Error grouping by fingerprint
      resource-utils.ts         # Service name extraction
      telemetry-limits.ts       # Memory limits + eviction
      __tests__/                # 8 server test files
        test-utils/             # Stubs and server factory
    widget/
      Widget.tsx                # Main Preact component
      element.ts                # Custom HTML element
      auto.ts                   # IIFE entry point
      websocket.ts              # WebSocket client with reconnect
      store.ts                  # Preact Signals state
      types.ts                  # Widget types
      utils.ts                  # Formatting utilities
      export-import.ts          # Trace export/import
      css.d.ts                  # Tailwind CSS module declaration
      components/               # 14 Preact components (AIInsightsView removed)
        TracesView.tsx
        LogsView.tsx
        ErrorsView.tsx
        MetricsView.tsx
        ServiceMapView.tsx
        ResourcesView.tsx
        WaterfallView.tsx
        FlameGraphView.tsx
        Panel.tsx
        Bubble.tsx
        Layout.tsx
        TabContainer.tsx
        SpanDetailPanel.tsx
        SpanSearch.tsx
        Copyable.tsx
        Logo.tsx
      utils/
        cn.ts                   # CSS class merge
        ansi.ts                 # ANSI color parsing
        resources.ts            # Resource aggregation
      stories/                  # Storybook stories
      __tests__/                # 4 widget test files
  bin/
    cli.js                      # CLI entry point (#!/usr/bin/env node)
  .storybook/                   # Storybook config
  tsup.config.ts                # Server build
  vite.widget.config.ts         # Widget IIFE build
  tsconfig.json
  vitest.config.ts
  package.json
  README.md
  CLAUDE.md
```

## Build Configuration

### Server: tsup (new)

```typescript
import { defineConfig } from 'tsup';

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
});
```

### Widget: Vite (kept)

Keep `vite.widget.config.ts` as-is. Builds IIFE bundle with Preact + Tailwind CSS inlined. Output: `dist/widget.global.js`.

### Scripts

```json
{
  "build": "tsup && vite build --config vite.widget.config.ts",
  "dev": "tsup --watch",
  "type-check": "tsc --noEmit",
  "lint": "eslint src/",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

## Package.json

```json
{
  "name": "autotel-devtools",
  "type": "module",
  "sideEffects": false,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "autotel-devtools": "./bin/cli.js"
  },
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
  },
  "peerDependencies": {
    "autotel": "workspace:*"
  },
  "peerDependenciesMeta": {
    "autotel": { "optional": true }
  }
}
```

### Dependencies

**Production**: `@preact/signals`, `clsx`, `lucide-preact`, `markdown-to-jsx`, `preact`, `react-json-view-lite`, `tailwind-merge`, `ws`

**Dev**: `@preact/preset-vite`, `vite`, `@tailwindcss/postcss`, `tailwindcss`, `tsup`, `vitest`, `typescript`, `@types/ws`, `@types/node`, `@opentelemetry/api`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/sdk-logs`, `@opentelemetry/core`, `eslint`

**Storybook dev deps**: `storybook`, `@storybook/preact-vite`, `@storybook/addon-vitest`, `@chromatic-com/storybook`, `@vitest/browser-playwright`, `@testing-library/preact`

## TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

## Removals

1. **autotel-ai-insights**: Remove from `peerDependencies` and `peerDependenciesMeta`
2. **AIInsightsView.tsx**: Delete component file
3. **AIInsightsView imports**: Remove from `Widget.tsx`, `TabContainer.tsx`, or wherever the tab is registered
4. **AI Insights tab**: Remove from tab configuration/navigation
5. **vite.config.ts**: Replace with `tsup.config.ts` (server build migrated to tsup)
6. **vitest.shims.d.ts**: Remove if not needed with new vitest config

## Testing

Keep all 12 existing test files. Align vitest config:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
    globals: true,
  },
});
```

Browser-based widget tests may need `@vitest/browser-playwright` config retained.

## Integration Points

- Turbo pipeline: `build` task depends on `^build` (autotel builds first)
- pnpm workspace: automatically discovered via `packages/*` glob
- Root `pnpm build` / `pnpm test` includes this package

## Out of Scope

- No functional changes to server, widget, or any features
- No new features
- No autotel-ai-insights support (removed)
- No changes to other packages in the monorepo
