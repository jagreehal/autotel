/**
 * TanStack Start Entry Point
 *
 * This is the TanStack-native way to configure global middleware.
 * - requestMiddleware: runs for every request (SSR, routes, server functions)
 * - functionMiddleware: runs for every server function
 */
import { createMiddleware, createStart } from '@tanstack/react-start'
import { createTracingServerHandler } from 'autotel-tanstack/middleware'

// Import instrumentation to ensure tracing is initialized
import './instrumentation'

// Global request tracing middleware
const requestTracingMiddleware = createMiddleware().server(
  createTracingServerHandler({
    captureHeaders: ['x-request-id', 'user-agent'],
    excludePaths: ['/health', '/healthz', '/ready', '/metrics', '/_ping'],
  }),
)

// Global server function tracing middleware
const functionTracingMiddleware = createMiddleware({ type: 'function' }).server(
  createTracingServerHandler({
    type: 'function',
    captureArgs: true,
  }),
)

export const startInstance = createStart(() => ({
  requestMiddleware: [requestTracingMiddleware],
  functionMiddleware: [functionTracingMiddleware],
}))
