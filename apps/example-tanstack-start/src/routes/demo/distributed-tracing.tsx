/**
 * Distributed Tracing Demo - server function → another HTTP API
 *
 * Proves the trace crosses the process boundary: the trace id the downstream
 * service joins is the server function's own. Set DOWNSTREAM_API_URL to point
 * at a real second service and you'll see the same thing across two processes.
 */
import { createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getCurrentTraceId } from 'autotel-tanstack/context'
import { traceLoader } from 'autotel-tanstack/loaders'
import { callDownstream, resolveDownstreamUrl } from '../../lib/downstream'

// The global functionMiddleware in src/start.ts traces this.
const callApi = createServerFn({ method: 'GET' }).handler(async () => {
  let url: string
  try {
    url = resolveDownstreamUrl()
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  try {
    return {
      callerTraceId: getCurrentTraceId() ?? null,
      downstream: await callDownstream(url),
      url,
    }
  } catch (error) {
    return {
      error: `Could not reach ${url} (${error instanceof Error ? error.message : String(error)}). Set DOWNSTREAM_API_URL if the downstream service is somewhere else.`,
    }
  }
})

export const Route = createFileRoute('/demo/distributed-tracing')({
  component: DistributedTracing,
  loader: traceLoader(async () => await callApi()),
})

function DistributedTracing() {
  const data = Route.useLoaderData()

  if ('error' in data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-800 to-black p-8 text-white">
        <div className="max-w-2xl mx-auto p-4 rounded-lg bg-red-500/10 border border-red-500/30">
          <h1 className="text-xl mb-2">Downstream not configured</h1>
          <p className="text-sm text-gray-300">{data.error}</p>
        </div>
      </div>
    )
  }

  const { callerTraceId, downstream, url } = data
  const propagated =
    Boolean(downstream.traceId) && downstream.traceId === callerTraceId

  return (
    <div className="min-h-screen bg-gradient-to-br from-zinc-800 to-black p-8 text-white">
      <div className="max-w-2xl mx-auto space-y-4">
        <h1 className="text-2xl">Server function → downstream API</h1>

        <div className="p-4 rounded-lg bg-white/5 border border-white/10">
          <div className="font-semibold mb-1">Server function trace id</div>
          <code className="text-xs text-blue-300 break-all">
            {callerTraceId ?? 'no active span'}
          </code>
        </div>

        <div className="p-4 rounded-lg bg-white/5 border border-white/10">
          <div className="flex items-center justify-between mb-1">
            <span className="font-semibold">
              Trace joined by {downstream.service}
            </span>
            <span className={propagated ? 'text-green-400' : 'text-red-400'}>
              {propagated ? 'same trace ✅' : 'new trace ❌'}
            </span>
          </div>
          <code className="text-xs text-gray-400 break-all">
            {downstream.traceId ?? 'started its own trace'}
          </code>
          <div className="text-xs text-gray-500 mt-2 break-all">{url}</div>
        </div>

        <p className="text-sm text-gray-400">
          A plain <code>fetch()</code> covers it: the undici instrumentation
          registered in <code>src/instrumentation.ts</code> injects{' '}
          <code>traceparent</code>. Green means the downstream span joined this
          trace instead of starting its own, so you get one waterfall across
          both services in your backend.
        </p>
        <p className="text-sm text-gray-500">
          Use <code>createTracedHeaders()</code> for transports undici
          doesn&apos;t instrument. Doing both injects two comma-joined{' '}
          <code>traceparent</code> values. That is invalid, and the downstream
          drops the trace without telling you.
        </p>
      </div>
    </div>
  )
}
