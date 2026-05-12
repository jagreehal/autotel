/**
 * Factory functions for creating events subscribers
 *
 * Function-based alternatives to `new SubscriberClass()` pattern.
 * Provides a consistent API and better tree-shaking.
 *
 * @example
 * ```typescript
 * import { createPostHogSubscriber, createWebhookSubscriber } from 'autotel-subscribers/factories'
 *
 * const events = new Events('my-service', {
 *   subscribers: [
 *     createPostHogSubscriber({ apiKey: 'phc_...' }),
 *     createWebhookSubscriber({ url: 'https://...' })
 *   ]
 * })
 * ```
 */

import { PostHogSubscriber } from './posthog';
import { MixpanelSubscriber } from './mixpanel';
import { AmplitudeSubscriber } from './amplitude';
import { SegmentSubscriber } from './segment';
import { WebhookSubscriber } from './webhook';
import { SlackSubscriber } from './slack';
import { MockEventSubscriber } from './mock-event-subscriber';

import type {
  EventSubscriber,
  EventAttributes,
  OutcomeStatus,
  FunnelStatus,
  EventTrackingOptions,
} from 'autotel/event-subscriber';

export type { PostHogConfig } from './posthog';
export type { MixpanelConfig } from './mixpanel';
export type { AmplitudeConfig } from './amplitude';
export type { SegmentConfig } from './segment';
export type { WebhookConfig } from './webhook';
export type { SlackSubscriberConfig } from './slack';

/** Create a PostHog events subscriber */
export function createPostHogSubscriber(config: {
  apiKey: string;
  host?: string;
  enabled?: boolean;
}): EventSubscriber {
  return new PostHogSubscriber(config);
}

/** Create a Mixpanel events subscriber */
export function createMixpanelSubscriber(config: {
  token: string;
  enabled?: boolean;
}): EventSubscriber {
  return new MixpanelSubscriber(config);
}

/** Create an Amplitude events subscriber */
export function createAmplitudeSubscriber(config: {
  apiKey: string;
  enabled?: boolean;
}): EventSubscriber {
  return new AmplitudeSubscriber(config);
}

/** Create a Segment events subscriber */
export function createSegmentSubscriber(config: {
  writeKey: string;
  enabled?: boolean;
}): EventSubscriber {
  return new SegmentSubscriber(config);
}

/** Create a Webhook events subscriber with retry and timeout support */
export function createWebhookSubscriber(config: {
  url: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
  enabled?: boolean;
  maxRetries?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
}): EventSubscriber {
  return new WebhookSubscriber(config);
}

/** Create a Slack events subscriber */
export function createSlackSubscriber(config: {
  webhookUrl: string;
  channel?: string;
  enabled?: boolean;
}): EventSubscriber {
  return new SlackSubscriber(config);
}

/** Create a mock events subscriber for testing */
export function createMockSubscriber(): MockEventSubscriber {
  return new MockEventSubscriber();
}

/**
 * Strategy for composing multiple subscribers
 *
 * - `parallel`: Send to all subscribers concurrently, fail if any fails
 * - `failover`: Try subscribers in order until one succeeds
 * - `round-robin`: Cycle through subscribers sequentially
 * - `random`: Pick a random subscriber each time
 * - `race`: Send to all, succeed when any succeeds
 * - `mirrored`: Send to primary, mirror to others (primary failure fails all)
 */
export type ComposeSubscriberStrategy =
  | 'parallel'
  | 'failover'
  | 'round-robin'
  | 'random'
  | 'race'
  | 'mirrored';

/** Configuration options for composing multiple subscribers */
export type ComposeSubscribersOptions = {
  name?: string;
  strategy?: ComposeSubscriberStrategy;
  maxAttemptsPerSubscriber?: number;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
  isRetriable?: (error: unknown) => boolean;
  logger?: Pick<Console, 'debug' | 'warn' | 'error'>;
};

type SubscriberMethod =
  | 'trackEvent'
  | 'trackFunnelStep'
  | 'trackOutcome'
  | 'trackValue';

type MethodCall = {
  method: SubscriberMethod;
  args: unknown[];
};

function backoffDelay(attempt: number, initialMs: number, maxMs: number): number {
  return Math.min(maxMs, initialMs * 2 ** (attempt - 1));
}

async function callSubscriber(subscriber: EventSubscriber, call: MethodCall): Promise<void> {
  switch (call.method) {
    case 'trackEvent': {
      await subscriber.trackEvent(
        call.args[0] as string,
        call.args[1] as EventAttributes | undefined,
        call.args[2] as EventTrackingOptions | undefined,
      );
      return;
    }
    case 'trackFunnelStep': {
      await subscriber.trackFunnelStep(
        call.args[0] as string,
        call.args[1] as FunnelStatus,
        call.args[2] as EventAttributes | undefined,
        call.args[3] as EventTrackingOptions | undefined,
      );
      return;
    }
    case 'trackOutcome': {
      await subscriber.trackOutcome(
        call.args[0] as string,
        call.args[1] as OutcomeStatus,
        call.args[2] as EventAttributes | undefined,
        call.args[3] as EventTrackingOptions | undefined,
      );
      return;
    }
    case 'trackValue': {
      await subscriber.trackValue(
        call.args[0] as string,
        call.args[1] as number,
        call.args[2] as EventAttributes | undefined,
        call.args[3] as EventTrackingOptions | undefined,
      );
    }
  }
}

/**
 * Compose multiple subscribers into one with a specified strategy
 *
 * @example
 * ```typescript
 * const multiSubscriber = composeSubscribers(
 *   [
 *     createPostHogSubscriber({ apiKey: '...' }),
 *     createWebhookSubscriber({ url: '...' })
 *   ],
 *   { strategy: 'parallel' }
 * )
 * ```
 *
 * @param subscribers - Array of subscribers to compose
 * @param options - Configuration for composition strategy and retry behavior
 * @returns A composite EventSubscriber that applies the strategy
 */
export function composeSubscribers(
  subscribers: EventSubscriber[],
  options: ComposeSubscribersOptions = {},
): EventSubscriber {
  const strategy = options.strategy ?? 'parallel';
  const name = options.name ?? `ComposedSubscriber(${strategy})`;
  const maxAttempts = options.maxAttemptsPerSubscriber ?? 1;
  const initialRetryDelayMs = options.initialRetryDelayMs ?? 250;
  const maxRetryDelayMs = options.maxRetryDelayMs ?? 10_000;
  const isRetriable = options.isRetriable ?? (() => true);
  const logger = options.logger ?? console;
  let rrCounter = 0;

  const sendOne = async (subscriber: EventSubscriber, call: MethodCall): Promise<void> => {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await callSubscriber(subscriber, call);
        return;
      } catch (error) {
        lastError = error;
        const retryable = isRetriable(error);
        logger.warn?.('composeSubscribers attempt failed', {
          subscriber: subscriber.name,
          attempt,
          retryable,
          strategy,
          error,
        });

        if (!retryable || attempt >= maxAttempts) break;
        await new Promise((resolve) =>
          setTimeout(resolve, backoffDelay(attempt, initialRetryDelayMs, maxRetryDelayMs)),
        );
      }
    }

    throw (lastError instanceof Error ? lastError : new Error(String(lastError)));
  };

  const orderForSequential = (): number[] => {
    const n = subscribers.length;
    if (n === 0) return [];

    if (strategy === 'failover') {
      return Array.from({ length: n }, (_, i) => i);
    }

    const start =
      strategy === 'random' ? Math.floor(Math.random() * n) : rrCounter++ % n;

    return Array.from({ length: n }, (_, i) => (start + i) % n);
  };

  const execute = async (call: MethodCall): Promise<void> => {
    if (subscribers.length === 0) return;

    if (strategy === 'parallel') {
      await Promise.all(subscribers.map((subscriber) => sendOne(subscriber, call)));
      return;
    }

    if (strategy === 'race') {
      const attempts = subscribers.map(async (subscriber) => {
        await sendOne(subscriber, call);
        return subscriber.name ?? 'unknown';
      });

      try {
        await Promise.any(attempts);
      } catch (error) {
        if (error instanceof AggregateError && error.errors.length > 0) {
          throw error.errors.at(-1);
        }
        throw error;
      }
      return;
    }

    if (strategy === 'mirrored') {
      const primary = subscribers[0];
      if (!primary) return;
      await sendOne(primary, call);

      for (const mirror of subscribers.slice(1)) {
        void sendOne(mirror, call).catch((error) => {
          logger.warn?.('composeSubscribers mirror failed', {
            subscriber: mirror.name,
            error,
          });
        });
      }
      return;
    }

    const order = orderForSequential();
    let lastError: unknown;

    for (const index of order) {
      const subscriber = subscribers[index];
      if (!subscriber) continue;

      try {
        await sendOne(subscriber, call);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw (lastError instanceof Error ? lastError : new Error(String(lastError)));
  };

  return {
    name,
    async trackEvent(name_, attributes, options_) {
      await execute({ method: 'trackEvent', args: [name_, attributes, options_] });
    },
    async trackFunnelStep(funnel, step, attributes, options_) {
      await execute({
        method: 'trackFunnelStep',
        args: [funnel, step, attributes, options_],
      });
    },
    async trackOutcome(operation, outcome, attributes, options_) {
      await execute({
        method: 'trackOutcome',
        args: [operation, outcome, attributes, options_],
      });
    },
    async trackValue(name_, value, attributes, options_) {
      await execute({ method: 'trackValue', args: [name_, value, attributes, options_] });
    },
    async shutdown() {
      await Promise.all(subscribers.map(async (subscriber) => subscriber.shutdown?.()));
    },
  };
}
