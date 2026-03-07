---
name: autotel-events
description: >
  track(), Event API, subscribers (e.g. PostHog). Configure subscribers in init(); use track() or Event for product/analytics events.
type: core
library: autotel
library_version: '2.23.0'
sources:
  - jagreehal/autotel:packages/autotel/src/event.ts
  - jagreehal/autotel:packages/autotel/src/event-subscriber.ts
---

# Autotel — Events

Send product and analytics events with `track(name, attributes)` or the `Event` class from `autotel/event`. Configure subscribers (e.g. PostHog) in `init()`; they receive events automatically.

## Setup

```typescript
import { init, track } from 'autotel';
import { PostHogSubscriber } from 'autotel-subscribers/posthog';

init({
  service: 'my-app',
  subscribers: [new PostHogSubscriber({ apiKey: 'phc_...' })],
});

track('checkout.started', { userId: 'u_123', cartId: 'c_456' });
```

With Event instance (optional override of subscribers):

```typescript
import { Event } from 'autotel/event';

const event = new Event('checkout');
event.trackEvent('application.submitted', { jobId: '123', userId: '456' });
```

## Core Patterns

**Simple track (uses subscribers from init):**

```typescript
track('signup.completed', { plan: 'pro', source: 'web' });
```

**Event with custom subscribers:**

```typescript
import { Event } from 'autotel/event';
import { PostHogSubscriber } from 'autotel-subscribers/posthog';

const event = new Event('onboarding', {
  subscribers: [new PostHogSubscriber({ apiKey: 'phc_other_project' })],
});
event.trackEvent('step.completed', { step: 2 });
```

**Validation and config:** See `getEventsConfig()`, `getValidationConfig()` from init; event names and attributes can be validated.

## Common Mistakes

### MEDIUM Call track() before init() with subscribers

Wrong:

```typescript
track('signup', { plan: 'pro' });
```

Correct:

```typescript
init({
  service: 'my-app',
  subscribers: [new PostHogSubscriber({ apiKey: 'phc_...' })],
});
track('signup', { plan: 'pro' });
```

Subscribers are configured in init(). track() sends to those subscribers; without init or without subscribers, events may not reach the backend.

Source: packages/autotel/src/event.ts

## Version

Targets autotel v2.23.x.
