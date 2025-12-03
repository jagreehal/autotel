/**
 * Zero-config Lambda auto-instrumentation
 *
 * Reads configuration from environment variables:
 * - OTEL_SERVICE_NAME
 * - OTEL_EXPORTER_OTLP_ENDPOINT
 * - OTEL_EXPORTER_OTLP_HEADERS
 *
 * @example
 * ```typescript
 * // In your Lambda handler file:
 * import 'autotel-aws/lambda/auto';
 *
 * // Then export your handler normally
 * export const handler = async (event, context) => {
 *   return { statusCode: 200 };
 * };
 * ```
 *
 * Note: This requires wrapping your handler with wrapHandler() manually
 * or using a Lambda layer that does the wrapping automatically.
 */

import { init } from 'autotel';

// Auto-initialize on import
if (process.env.OTEL_SERVICE_NAME) {
  init({
    service: process.env.OTEL_SERVICE_NAME,
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    headers: process.env.OTEL_EXPORTER_OTLP_HEADERS
      ? Object.fromEntries(
          process.env.OTEL_EXPORTER_OTLP_HEADERS.split(',').map((pair) => {
            const [key, ...valueParts] = pair.split('=');
            return [key.trim(), valueParts.join('=').trim()];
          })
        )
      : undefined,
  });
}
