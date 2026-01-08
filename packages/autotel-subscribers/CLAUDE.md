# autotel-subscribers (Event Subscribers)

Event subscribers for product events platforms (PostHog, Mixpanel, Amplitude, Segment, webhooks).

## Your Role

You are working on the event subscribers package. You understand product analytics platforms, event payload normalization, error handling, and graceful shutdown patterns.

## Tech Stack

- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.0+ (ESM-first, CJS fallback)
- **Build**: tsup
- **Testing**: vitest
- **Key Dependencies**: Platform-specific SDKs (PostHog, Mixpanel, etc.) as optional peer dependencies

## Key Concepts

- **EventSubscriber Base Class**: All adapters extend this base class which provides:
  - Error handling and retry logic
  - Graceful shutdown with pending request tracking
  - Consistent payload normalization
  - Tree-shakeable exports (each adapter is a separate entry point)

## Entry Points

Each adapter is a separate entry point for tree-shaking:

- `autotel-subscribers/posthog` - PostHog adapter
- `autotel-subscribers/mixpanel` - Mixpanel adapter
- `autotel-subscribers/amplitude` - Amplitude adapter
- `autotel-subscribers/segment` - Segment adapter
- `autotel-subscribers/webhook` - Webhook adapter
- `autotel-subscribers/testing` - Test harnesses

## Commands

```bash
# In packages/autotel-subscribers directory
pnpm test               # Run tests
pnpm build              # Build package
pnpm lint               # Lint package
```

## File Structure

- `src/base.ts` - EventSubscriber base class
- `src/posthog.ts` - PostHog adapter
- `src/mixpanel.ts` - Mixpanel adapter
- `src/amplitude.ts` - Amplitude adapter
- `src/segment.ts` - Segment adapter
- `src/webhook.ts` - Webhook adapter
- `src/testing.ts` - Test harnesses

## Code Patterns

### Base Class Pattern

All adapters extend `EventSubscriber`:

```typescript
import { EventSubscriber, EventPayload } from './base';

export class PostHogSubscriber extends EventSubscriber {
  constructor(private config: PostHogConfig) {
    super();
  }

  async sendToDestination(payload: EventPayload): Promise<void> {
    // Implement platform-specific sending logic
    await this.posthog.capture(payload);
  }
}
```

### Graceful Shutdown

Base class handles pending requests:

```typescript
const subscriber = new PostHogSubscriber(config);
await subscriber.shutdown(); // Waits for pending requests
```

### Error Handling

Base class provides retry logic and error handling:

```typescript
// Automatic retries on failure
// Error events are logged but don't throw
```

## Boundaries

- ✅ **Always do**: Extend EventSubscriber base class, implement sendToDestination, handle errors gracefully
- ⚠️ **Ask first**: Adding new adapters, changing base class API
- 🚫 **Never do**: Bypass base class, throw errors from sendToDestination, break graceful shutdown

## Testing

- Use `SubscriberTestHarness` for consistent testing
- Test error handling and retry logic
- Test graceful shutdown with pending requests
- Test payload normalization

## Adding a New Subscriber

1. Create new file in `src/` (e.g., `src/custom.ts`)
2. Extend `EventSubscriber` base class
3. Implement `sendToDestination(payload: EventPayload)` method
4. Add export to `src/index.ts`
5. Add entry point to `package.json` exports field
6. Add tests using `SubscriberTestHarness`
7. Create changeset with `pnpm changeset`

See `docs/DEVELOPMENT.md` for detailed workflow.

