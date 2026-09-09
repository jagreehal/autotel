/**
 * Where `PostHogSubscriber` used to live.
 *
 * It moved to `autotel-posthog/subscriber`, so one package covers PostHog end
 * to end - the browser join, the span enricher and this subscriber. This file
 * exists so the old import still resolves and says where to go, instead of a
 * bare "Property 'PostHogSubscriber' does not exist". It re-exports nothing:
 * `autotel-posthog` already depends on this package, and importing it back
 * would make the two packages depend on each other.
 *
 * Delete this in the next minor.
 */

const MOVED =
  "PostHogSubscriber moved to 'autotel-posthog/subscriber'. Run " +
  '`pnpm add autotel-posthog` and change the import to ' +
  "`import { PostHogSubscriber } from 'autotel-posthog/subscriber'`. " +
  'Its options and behaviour are unchanged.';

/**
 * @deprecated Moved to `autotel-posthog/subscriber` - import it from there.
 * Constructing this throws; it exists only to point at the new home.
 */
export class PostHogSubscriber {
  constructor(..._config: unknown[]) {
    throw new Error(MOVED);
  }
}

/** @deprecated Moved to `autotel-posthog/subscriber` along with the subscriber. */
export type PostHogConfig = Record<never, never>;
