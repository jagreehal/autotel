/**
 * autotel ↔ PostHog.
 *
 * PostHog is both a destination and a browser SDK, and the useful thing is the
 * join between them: a trace that knows which recorded session it happened in,
 * and a PostHog event that knows which trace explains it. Two links, one
 * session id, and no dependency on `posthog-js` in either direction.
 */

export {
  posthogCompatibility,
  type PostHogCompatibilityOptions,
} from './compatibility';

export { joinPostHog, type JoinPostHogOptions } from './join';

export {
  autotelBeforeSend,
  type AutotelBeforeSendOptions,
  type BeforeSendLike,
  type CaptureResultLike,
} from './before-send';

export { posthogSessionId } from './session-id';

export type { PostHogLike } from './posthog-like';
