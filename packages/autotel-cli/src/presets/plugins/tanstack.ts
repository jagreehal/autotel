import type { PluginPreset } from '../../types/index';

/**
 * TanStack Start preset — registers tracing middleware for server requests
 * and server functions.
 *
 * TanStack Start has its own `createStart()` entry point; the user's
 * `start.ts` is where middleware gets composed. We emit the import and
 * snippet; the user wires it into their createStart() call.
 */
export const tanstack: PluginPreset = {
  name: 'TanStack Start',
  slug: 'tanstack',
  type: 'plugin',
  description:
    'Tracing middleware for TanStack Start (SSR requests + server functions)',
  packages: {
    required: ['autotel-tanstack'],
    optional: [],
    devOnly: [],
  },
  env: {
    required: [],
    optional: [],
  },
  imports: [
    {
      source: 'autotel-tanstack/middleware',
      specifiers: ['createTracingServerHandler'],
    },
  ],
  configBlock: {
    type: 'plugin',
    code: `// In your start.ts, register tracing middleware on createStart():
//   import { createMiddleware, createStart } from '@tanstack/react-start';
//
//   const requestTracing = createMiddleware().server(
//     createTracingServerHandler({
//       captureHeaders: ['x-request-id', 'user-agent'],
//       excludePaths: ['/health', '/metrics'],
//     }),
//   );
//
//   const functionTracing = createMiddleware({ type: 'function' }).server(
//     createTracingServerHandler({ type: 'function', captureArgs: true }),
//   );
//
//   export const startInstance = createStart(() => ({
//     requestMiddleware: [requestTracing],
//     functionMiddleware: [functionTracing],
//   }));`,
    section: 'PLUGIN_INIT',
  },
  nextSteps: [
    'Add tracing middleware to your createStart() call in src/start.ts',
    'Alternative: import "autotel-tanstack/auto" for zero-config init via OTEL_* env vars',
    'See packages/autotel-tanstack README for loader/server-function tracing helpers',
  ],
};
