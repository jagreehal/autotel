import { init } from 'autotel-web';
import { posthogSessionId } from 'autotel-posthog';
import posthog from 'posthog-js';

// Before React renders, so the first request is already instrumented.
// init() is idempotent, so StrictMode's double render cannot patch twice.
init({
  service: 'example-web-react-express',
  // The API is on another origin. Listing it sends `traceparent` there, and
  // the API's CORS preflight must allow the header.
  propagateTo: (import.meta.env.VITE_PROPAGATE_TO ?? '')
    .split(',')
    .filter(Boolean),
  // Match the API's head sampling. Unsampled sessions send traceparent with
  // the sampled flag cleared, so a parent-based server sampler drops them too.
  ...(import.meta.env.VITE_SAMPLE_RATE && {
    sampleRate: Number(import.meta.env.VITE_SAMPLE_RATE),
  }),
  ...(import.meta.env.VITE_OTLP_ENDPOINT !== undefined && {
    endpoint: import.meta.env.VITE_OTLP_ENDPOINT,
  }),
  // Browser spans carry PostHog's session id once PostHog has one, and a
  // locally minted id before that.
  session: { id: () => posthogSessionId(posthog) },
  debug: true,
});
