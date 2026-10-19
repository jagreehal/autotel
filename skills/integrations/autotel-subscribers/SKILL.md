---
name: autotel-subscribers
description: >
  Event subscribers for autotel. Mixpanel, Amplitude, Segment, Webhook, Slack, Loki, file, security, architecture snapshot. Configure in init() subscribers; use track() or Event from autotel. Import from autotel-subscribers/mixpanel etc. PostHog lives in autotel-posthog/subscriber.
---

# autotel-subscribers

Event subscribers send product/analytics events from autotel to external platforms. Configure subscribers in `init()`; then use `track()` or `Event` from `autotel`. Each adapter is a separate import path for tree-shaking.

## Setup

```typescript
import { init, track } from 'autotel';
import { MixpanelSubscriber } from 'autotel-subscribers/mixpanel';

init({
  service: 'my-app',
  subscribers: [new MixpanelSubscriber({ token: process.env.MIXPANEL_TOKEN! })],
});

track('order.completed', { userId: 'user-123', amount: 99.99 });
```

## Subscribers and import paths

| Platform              | Import path                                 | Export                           | SDK to install                                                      |
| --------------------- | ------------------------------------------- | -------------------------------- | ------------------------------------------------------------------- |
| PostHog               | `autotel-posthog/subscriber`                | `PostHogSubscriber`              | posthog-node                                                        |
| Mixpanel              | `autotel-subscribers/mixpanel`              | `MixpanelSubscriber`             | mixpanel                                                            |
| Amplitude             | `autotel-subscribers/amplitude`             | `AmplitudeSubscriber`            | @amplitude/analytics-node                                           |
| Segment               | `autotel-subscribers/segment`               | `SegmentSubscriber`              | @segment/analytics-node                                             |
| Webhook               | `autotel-subscribers/webhook`               | `WebhookSubscriber`              | none                                                                |
| Slack                 | `autotel-subscribers/slack`                 | `SlackSubscriber`                | none                                                                |
| Loki                  | `autotel-subscribers/loki`                  | `LokiSubscriber`                 | none                                                                |
| File                  | `autotel-subscribers/file`                  | `FileSubscriber`                 | none (NDJSON to `path`)                                             |
| Security              | `autotel-subscribers/security`              | `SecuritySubscriber`             | none (severity-gated forwarding of `autotel-audit` security events) |
| Architecture snapshot | `autotel-subscribers/architecture-snapshot` | `ArchitectureSnapshotSubscriber` | none (input for `autotel-eventcatalog`)                             |

The platform SDKs are loaded with a dynamic `import()` and are not declared as peers, so your package manager will not install or warn about them. Install the one for the subscriber you use (e.g. `pnpm add mixpanel`).

Other subpaths:

- `autotel-subscribers/factories`: `createMixpanelSubscriber()`, `createAmplitudeSubscriber()`, `createSegmentSubscriber()`, `createWebhookSubscriber()`, `createSlackSubscriber()` (function form of the constructors, same config), plus `composeSubscribers()` and `createMockSubscriber()`. No PostHog factory.
- `autotel-subscribers/middleware`: `applyMiddleware()` with `retryMiddleware`, `samplingMiddleware`, `filterMiddleware`, `transformMiddleware`, `enrichmentMiddleware`, `batchingMiddleware`, `rateLimitMiddleware`, `circuitBreakerMiddleware`, `timeoutMiddleware`, `loggingMiddleware`.
- `autotel-subscribers/testing`: `SubscriberTestHarness`, `MockWebhookServer`, `MockEventSubscriber` for testing your own subscribers.
- `autotel-subscribers` (root): every subscriber plus the `EventSubscriber` and `StreamingEventSubscriber` base classes for writing your own.

## Core patterns

**Multiple subscribers:** Pass an array to `init({ subscribers: [new MixpanelSubscriber(...), new SlackSubscriber(...)] })`. Events are sent to all.

**Event instance with overrides:** `new Event('job-application', { subscribers: [...] })` from `autotel/event` sends only to those subscribers for that instance; without the option it uses the ones from `init()`.

## Common mistakes

### HIGH Import PostHogSubscriber from autotel-subscribers

Wrong:

```typescript
import { PostHogSubscriber } from 'autotel-subscribers/posthog';
// or: from 'autotel-subscribers'
```

Correct:

```typescript
import { PostHogSubscriber } from 'autotel-posthog/subscriber';
```

`PostHogSubscriber` moved to `autotel-posthog`. The old export still resolves but the constructor throws a "moved" error at startup.

Source: packages/autotel-subscribers/src/posthog.ts

### MEDIUM Import from the root instead of the adapter subpath

Prefer `autotel-subscribers/mixpanel` over `autotel-subscribers`, so only the adapter you use is bundled.

Source: packages/autotel-subscribers/package.json exports

### MEDIUM Call track() before init() with subscribers

Subscribers are configured in `init()`. Without `init({ subscribers: [...] })`, `track()` has nowhere to send events. Call `init()` once at app startup before any `track()`.

Source: packages/autotel/src/event.ts

### MEDIUM Omit the SDK for the chosen adapter

Install the platform SDK for the subscriber you use (`mixpanel`, `@amplitude/analytics-node`, `@segment/analytics-node`; `posthog-node` for `autotel-posthog`). It is loaded lazily, so a missing SDK fails at runtime, not install time.

Source: packages/autotel-subscribers/src/{mixpanel,amplitude,segment}.ts

## Version

Targets autotel-subscribers v59.x. Requires `autotel` (peer). See also: autotel package skill autotel-events for track() and Event API.
