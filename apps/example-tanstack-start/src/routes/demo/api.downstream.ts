import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { getCurrentTraceId } from 'autotel-tanstack/context'

/**
 * Stands in for a separate microservice.
 *
 * `traceId` reports the trace this service's own span joined, rather than a
 * parse of the incoming header. The global `requestMiddleware` in `src/start.ts`
 * extracts `traceparent` and continues the trace before this handler runs, so a
 * `traceId` matching the caller's proves the trace survived the HTTP hop. A
 * malformed header gives you `null` here instead of a false match.
 */
export const Route = createFileRoute('/demo/api/downstream')({
  server: {
    handlers: {
      GET: ({ request }: { request: Request }) =>
        json({
          service: 'downstream-api',
          traceparent: request.headers.get('traceparent'),
          traceId: getCurrentTraceId() ?? null,
        }),
    },
  },
})
