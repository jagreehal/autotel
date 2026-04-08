/**
 * ESM loader hook re-export for OpenTelemetry auto-instrumentation
 *
 * This file re-exports the OpenTelemetry ESM loader hook so users don't need
 * to install @opentelemetry/instrumentation as a direct dependency.
 *
 * Usage (Node 22+):
 *   NODE_OPTIONS="--experimental-loader=autotel/hook.mjs --import ./instrumentation.ts" tsx src/index.ts
 *
 * For supported Node versions, prefer using autotel/register instead which uses the newer
 * module.register() API and doesn't require NODE_OPTIONS.
 *
 * @see https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/esm-support.md
 */
export * from '@opentelemetry/instrumentation/hook.mjs';
