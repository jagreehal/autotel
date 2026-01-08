# Development Guide

Development commands, testing patterns, and common workflows for the Autotel monorepo.

## Commands

### Building

```bash
pnpm build              # Build all packages (uses Turborepo)
pnpm dev                # Watch mode for all packages
```

### Testing

```bash
# Run all tests (unit + integration)
pnpm test

# Package-specific testing (in package directory)
pnpm test               # Unit tests only (vitest.unit.config.ts)
pnpm test:watch         # Unit tests in watch mode
pnpm test:integration   # Integration tests (vitest.integration.config.ts)

# Run single test file
npx vitest run src/functional.test.ts
```

**Important**: The core `autotel` package has separate unit and integration test configs:

- `vitest.unit.config.ts` - Excludes `*.integration.test.ts` files
- `vitest.integration.config.ts` - Only runs `*.integration.test.ts` files

### Linting & Formatting

```bash
pnpm lint               # Lint all packages (ESLint)
pnpm format             # Format with Prettier
pnpm type-check         # TypeScript type checking
```

### Quality Check

```bash
pnpm quality            # Runs: build + lint + format + type-check + test + test:integration
```

### Running Examples

```bash
# Basic example (demonstrates trace() usage)
pnpm --filter @jagreehal/example-basic start

# HTTP server example
pnpm --filter @jagreehal/example-http start

# Cloudflare Workers example
pnpm --filter cloudflare-example dev
```

### Changesets (Version Management)

```bash
pnpm changeset          # Create a changeset for your changes
pnpm version-packages   # Bump versions based on changesets
pnpm release            # Build and publish to npm
```

When creating changesets:

- Select affected packages (autotel, autotel-subscribers, autotel-edge, etc.)
- Choose semver bump: patch (bug fixes), minor (new features), major (breaking changes)
- Write clear summary for CHANGELOG

## Testing Patterns

### OpenTelemetry Utilities

Autotel re-exports commonly-needed OpenTelemetry utilities in semantically-organized modules. These are already included in autotel's dependencies, so **no additional installation is required**.

**Module Organization:**

**`autotel/exporters`** - Span exporters for development and testing:

- `ConsoleSpanExporter` - Print spans to console (development debugging, examples)
- `InMemorySpanExporter` - Collect spans in memory (testing, assertions)

**`autotel/processors`** - Span processors for custom configurations:

- `SimpleSpanProcessor` - Synchronous span processing (testing, immediate export)
- `BatchSpanProcessor` - Async batching (production, custom configs)

**`autotel/testing`** - High-level testing utilities with assertions:

- `createTraceCollector()` - Auto-configured trace collector with helpers
- `assertTraceCreated()`, `assertTraceSucceeded()`, `assertTraceFailed()`, etc.
- Events and metrics testing utilities

**Why re-export?** Achieves "one install is all you need" DX without bundle size impact (these are from `@opentelemetry/sdk-trace-base`, already a dependency).

```typescript
// Development debugging - see spans in console
import { init } from 'autotel';
import { ConsoleSpanExporter } from 'autotel/exporters';

init({
  service: 'my-app',
  spanExporters: [new ConsoleSpanExporter()],
});

// Low-level testing - collect raw OTel spans
import { init } from 'autotel';
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';

const exporter = new InMemorySpanExporter();
init({
  service: 'test',
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

// Run code under test
await myFunction();

// Assert on collected spans
const spans = exporter.getFinishedSpans();
expect(spans).toHaveLength(1);
```

**Note:** For most testing scenarios, prefer autotel's high-level `createTraceCollector()` utility from `autotel/testing` which provides assertion helpers and automatic tracer configuration.

### Test Harnesses

Use provided test harnesses for consistent testing:

```typescript
// Event subscribers
import { SubscriberTestHarness } from 'autotel-subscribers/testing';

const harness = new SubscriberTestHarness(new MySubscriber(config));
await harness.testBasicEvent();
await harness.testErrorHandling();

// High-level trace testing (recommended)
import { createTraceCollector, assertTraceCreated } from 'autotel/testing';

const collector = createTraceCollector();
await myService.doSomething();
assertTraceCreated(collector, 'myService.doSomething');

// Low-level testing (when you need raw OTel spans)
import { InMemorySpanExporter } from 'autotel/exporters';
import { SimpleSpanProcessor } from 'autotel/processors';

const exporter = new InMemorySpanExporter();
// Use in tests to capture raw spans
```

### Integration Tests

Integration tests require OpenTelemetry SDK setup, so they're isolated in `*.integration.test.ts` files and run with a separate vitest config.

## Common Development Workflows

### Adding a New Event Subscriber

1. Create new file in `packages/autotel-subscribers/src/`
2. Extend `EventSubscriber` base class
3. Implement `sendToDestination(payload: EventPayload)` method
4. Add export to `packages/autotel-subscribers/src/index.ts`
5. Add entry point to `package.json` exports field
6. Add tests using `SubscriberTestHarness`
7. Create changeset with `pnpm changeset`

### Adding a New Instrumentation Integration

1. Add instrumentation logic to `packages/autotel/src/` (e.g., `redis.ts`)
2. Export from `packages/autotel/src/index.ts`
3. Add entry point to `package.json` exports if tree-shakeable
4. Add tests (unit tests in `.test.ts`, integration tests in `.integration.test.ts`)
5. Update `init.ts` if it needs special SDK configuration
6. Create changeset

### Working with Monorepo Dependencies

- Use `workspace:*` protocol in package.json for internal dependencies
- Changes to dependencies automatically trigger rebuilds (Turborepo cache)
- Install new dependency: `pnpm add <package> --filter <workspace-name>`
- Example: `pnpm add zod --filter autotel`

## Boundaries

- ✅ **Always do**: Write tests for new features, use test harnesses, follow existing patterns
- ⚠️ **Ask first**: Changing test infrastructure, modifying CI/CD configs
- 🚫 **Never do**: Skip tests, modify test configs without understanding impact, remove failing tests

