import { createFileRoute } from '@tanstack/react-router'
import { json } from '@tanstack/react-start'
import { recordTiming } from 'autotel-tanstack/metrics'

// Example: Server route handler with timing metrics
// Note: For full OTel spans, use traceServerFn with createServerFn instead
const getNames = recordTiming('api.names.GET', () => {
  return json(['Alice', 'Bob', 'Charlie'])
})

export const Route = createFileRoute('/demo/api/names')({
  server: {
    handlers: {
      GET: getNames,
    },
  },
})
