---
name: autotel-subscribers
description: >
  Event subscribers for autotel. PostHog, Mixpanel, Amplitude, Segment, Webhook, Slack. Configure in init() subscribers; use track() or Event from autotel. Import from autotel-subscribers/posthog etc.
type: core
library: autotel-subscribers
library_version: "27.0.0"
requires:
  - autotel-events
sources:
  - jagreehal/autotel:packages/autotel-subscribers/CLAUDE.md
  - jagreehal/autotel:packages/autotel/src/event.ts
---

# autotel-subscribers

Event subscribers send product/analytics events from autotel to external platforms. Configure subscribers in `init()`; then use `track()` or `Event` from `autotel`. Each adapter is a separate import path for tree-shaking.

## Setup

```typescript
import { init, track } from 'autotel';
import { PostHogSubscriber } from 'autotel-subscribers/posthog';

init({
  service: 'my-app',
  subscribers: [new PostHogSubscriber({ apiKey: 'phc_...' })],
});

track('order.completed', { userId: 'user-123', amount: 99.99 });
```

## Subscribers and import paths

| Platform   | Import path                      | Peer dependency           |
|-----------|-----------------------------------|----------------------------|
| PostHog   | `autotel-subscribers/posthog`     | posthog-node (optional)    |
| Mixpanel  | `autotel-subscribers/mixpanel`    | mixpanel (optional)        |
| Amplitude | `autotel-subscribers/amplitude`   | @amplitude/analytics-node  |
| Segment   | `autotel-subscribers/segment`     | @segment/analytics-node    |
| Webhook   | `autotel-subscribers/webhook`     | none                       |
| Slack     | `autotel-subscribers/slack`       | none                       |

Install the peer dependency for the subscriber you use (e.g. `pnpm add posthog-node` for PostHog).

## Core patterns

**Multiple subscribers:** Pass an array to `init({ subscribers: [new PostHogSubscriber(...), new MixpanelSubscriber(...)] })`. Events are sent to all.

**Event instance with overrides:** Use `Event` from `autotel/event` with a custom `subscribers` option to send only to specific backends for that instance.

**Factories:** `autotel-subscribers/factories` provides `createPostHogSubscriber()` etc. for env-based config.

## Common mistakes

### HIGH Import from "autotel-subscribers" instead of the adapter path

Wrong:

```typescript
import { PostHogSubscriber } from 'autotel-subscribers';
```

Correct:

```typescript
import { PostHogSubscriber } from 'autotel-subscribers/posthog';
```

Each adapter is a separate export; use the subpath so only the adapter you use is bundled.

Source: packages/autotel-subscribers/package.json exports

### MEDIUM Call track() before init() with subscribers

Subscribers are configured in `init()`. Without `init({ subscribers: [...] })`, `track()` has nowhere to send events. Call `init()` once at app startup before any `track()`.

Source: packages/autotel/src/event.ts

### MEDIUM Omit peer dependency for the chosen adapter

Install the platform SDK for the subscriber you use (e.g. `posthog-node`, `@segment/analytics-node`). Missing peer deps can cause runtime errors or no-op behavior.

Source: packages/autotel-subscribers/package.json peerDependencies

## Version

Targets autotel-subscribers v27.x. Requires autotel (workspace). See also: autotel package skill autotel-events for track() and Event API.
