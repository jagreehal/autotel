/**
 * Autotel Backends
 *
 * Vendor backend configurations for simplified setup with
 * popular observability platforms.
 *
 * @example Honeycomb
 * ```typescript
 * import { init } from 'autotel';
 * import { createHoneycombConfig } from 'autotel-backends/honeycomb';
 *
 * init(createHoneycombConfig({
 *   apiKey: process.env.HONEYCOMB_API_KEY!,
 *   service: 'my-app',
 * }));
 * ```
 *
 * @example Datadog
 * ```typescript
 * import { init } from 'autotel';
 * import { createDatadogConfig } from 'autotel-backends/datadog';
 *
 * init(createDatadogConfig({
 *   apiKey: process.env.DATADOG_API_KEY!,
 *   service: 'my-app',
 * }));
 * ```
 */

export { createHoneycombConfig, type HoneycombPresetConfig } from './honeycomb';

export {
  createDatadogConfig,
  type DatadogPresetConfig,
  type DatadogSite,
} from './datadog';

export {
  createGoogleCloudConfig,
  type GoogleCloudPresetConfig,
} from './google-cloud';
