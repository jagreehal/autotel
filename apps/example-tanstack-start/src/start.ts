/**
 * TanStack Start Entry Point
 *
 * This is the TanStack-native way to configure global middleware.
 * - requestMiddleware: runs for every request (SSR, routes, server functions)
 * - functionMiddleware: runs for every server function
 */
import { createMiddleware, createStart } from '@tanstack/react-start'
import { createTracingServerHandler } from 'autotel-tanstack/middleware'
import { getRouter } from './router'

// Import instrumentation to ensure tracing is initialized
import './instrumentation'

// Global request tracing middleware
const requestTracingMiddleware = createMiddleware().server(
  createTracingServerHandler({
    captureHeaders: ['x-request-id', 'user-agent'],
    excludePaths: ['/health', '/healthz', '/ready', '/metrics', '/_ping'],
    // Names each request after the route it matches (`GET /posts/$postId`)
    // and hands that route to the HTTP server span as `http.route`.
    router: getRouter(),
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
