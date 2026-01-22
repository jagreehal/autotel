/**
 * Interactive Autotel Playground
 *
 * Click buttons to see OpenTelemetry tracing in action.
 * Open DevTools Console (F12) to see the actual spans.
 */

import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { traceServerFn } from 'autotel-tanstack/server-functions'
import { createTracedHeaders } from 'autotel-tanstack/context'
import { recordTiming, withErrorReporting } from 'autotel-tanstack'
import { AlertTriangle, BarChart3, Clock, Link2, Play, Zap } from 'lucide-react'
import { recordSpan } from '../../components/TracesDevtools'

// ============================================================================
// Server Functions - Each demonstrates a different tracing pattern
// ============================================================================

// 1. Basic traced function
const basicTraceBase = createServerFn({ method: 'POST' })
  .inputValidator((d: string) => d)
  .handler(async ({ data }) => {
    // Simulate some work
    await new Promise((resolve) =>
      setTimeout(resolve, 50 + Math.random() * 100),
    )
    return {
      message: `Hello, ${data}!`,
      timestamp: new Date().toISOString(),
    }
  })

const basicTrace = traceServerFn(basicTraceBase, {
  name: 'basicTrace',
})

// 2. Slow operation (demonstrates tail sampling)
const slowOperationBase = createServerFn({ method: 'POST' }).handler(
  async () => {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    return {
      message: 'Slow operation completed successfully',
      duration: '2000ms',
    }
  },
)

const slowOperation = traceServerFn(slowOperationBase, {
  name: 'slowOperation',
})

// 3. Error operation (demonstrates error reporting)
const triggerErrorBase = createServerFn({ method: 'POST' }).handler(
  withErrorReporting(
    async () => {
      // Simulate some work before failing
      await new Promise((resolve) => setTimeout(resolve, 50))
      throw new Error('Intentional error for demo purposes')
    },
    { operation: 'triggerError' },
  ),
)

const triggerError = traceServerFn(triggerErrorBase, {
  name: 'triggerError',
})

// 4. Distributed trace (shows context propagation)
const distributedTraceBase = createServerFn({ method: 'POST' }).handler(() => {
  const headers = createTracedHeaders()
  // In a real app, you'd pass these headers to fetch() calls
  return {
    message: 'Trace context headers generated',
    headers: Object.fromEntries(headers.entries()),
  }
})

const distributedTrace = traceServerFn(distributedTraceBase, {
  name: 'distributedTrace',
})

// 5. Concurrent operations (shows parallel spans)
const singleOpBase = createServerFn({ method: 'POST' })
  .inputValidator((d: number) => d)
  .handler(
    recordTiming('playground.singleOp', async ({ data: opNumber }) => {
      await new Promise((resolve) =>
        setTimeout(resolve, 100 + Math.random() * 200),
      )
      return { op: opNumber, completed: true }
    }),
  )

const singleOp = traceServerFn(singleOpBase, {
  name: 'singleOp',
})

const concurrentOpsBase = createServerFn({ method: 'POST' }).handler(
  async () => {
    const start = Date.now()
    const results = await Promise.all([
      singleOp({ data: 1 }),
      singleOp({ data: 2 }),
      singleOp({ data: 3 }),
    ])
    return {
      message: 'All 3 operations completed',
      results,
      totalDuration: `${Date.now() - start}ms`,
    }
  },
)

const concurrentOps = traceServerFn(concurrentOpsBase, {
  name: 'concurrentOps',
})

// ============================================================================
// Route Definition
// ============================================================================

export const Route = createFileRoute('/demo/playground')({
  component: PlaygroundPage,
})

// ============================================================================
// Types
// ============================================================================

type ActionState = {
  loading: boolean
  result: unknown | null
  error: string | null
  duration: number | null
}

const initialState: ActionState = {
  loading: false,
  result: null,
  error: null,
  duration: null,
}

// ============================================================================
// ActionCard Component
// ============================================================================

function ActionCard({
  icon,
  title,
  description,
  buttonText,
  onAction,
  state,
  colorClass,
}: {
  icon: React.ReactNode
  title: string
  description: string
  buttonText: string
  onAction: () => Promise<void>
  state: ActionState
  colorClass: string
}) {
  return (
    <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl p-6 hover:border-slate-600 transition-all">
      <div className="flex items-start gap-4 mb-4">
        <div className={`p-3 rounded-lg ${colorClass}`}>{icon}</div>
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <p className="text-sm text-gray-400">{description}</p>
        </div>
      </div>

      <button
        onClick={onAction}
        disabled={state.loading}
        className={`w-full py-2.5 px-4 rounded-lg font-medium transition-all ${
          state.loading
            ? 'bg-slate-700 text-gray-400 cursor-wait'
            : `${colorClass} text-white hover:opacity-90`
        }`}
      >
        {state.loading ? 'Running...' : buttonText}
      </button>

      {/* Result Area */}
      {(state.result !== null || state.error !== null) && (
        <div
          className={`mt-4 p-3 rounded-lg text-sm font-mono ${
            state.error
              ? 'bg-red-900/30 border border-red-800 text-red-300'
              : 'bg-green-900/30 border border-green-800 text-green-300'
          }`}
        >
          <div className="flex justify-between items-center mb-2">
            <span className={state.error ? 'text-red-400' : 'text-green-400'}>
              {state.error ? '✗ Error' : '✓ Success'}
            </span>
            {state.duration !== null && (
              <span className="text-gray-400">{state.duration}ms</span>
            )}
          </div>
          <pre className="whitespace-pre-wrap break-all text-xs">
            {state.error || JSON.stringify(state.result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Main Page Component
// ============================================================================

function PlaygroundPage() {
  const [basicState, setBasicState] = useState<ActionState>(initialState)
  const [slowState, setSlowState] = useState<ActionState>(initialState)
  const [errorState, setErrorState] = useState<ActionState>(initialState)
  const [distributedState, setDistributedState] =
    useState<ActionState>(initialState)
  const [concurrentState, setConcurrentState] =
    useState<ActionState>(initialState)

  const runAction = async <T,>(
    action: () => Promise<T>,
    setState: React.Dispatch<React.SetStateAction<ActionState>>,
    spanName: string,
  ) => {
    setState({ loading: true, result: null, error: null, duration: null })
    const start = Date.now()
    try {
      const result = await action()
      const duration = Date.now() - start
      setState({
        loading: false,
        result,
        error: null,
        duration,
      })
      // Record span to devtools
      recordSpan(
        spanName,
        { result: JSON.stringify(result).slice(0, 100) },
        'ok',
        duration,
      )
    } catch (err) {
      const duration = Date.now() - start
      const errorMessage = err instanceof Error ? err.message : String(err)
      setState({
        loading: false,
        result: null,
        error: errorMessage,
        duration,
      })
      // Record error span to devtools
      recordSpan(spanName, { error: errorMessage }, 'error', duration)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-3">
            Autotel Playground
          </h1>
          <p className="text-gray-400 text-lg">
            Click buttons to trigger traced operations.{' '}
            <span className="text-cyan-400">
              Open DevTools Console (F12) to see the spans.
            </span>
          </p>
        </div>

        {/* Console Hint Banner */}
        <div className="mb-8 p-4 bg-cyan-900/30 border border-cyan-700 rounded-lg flex items-center gap-3">
          <div className="p-2 bg-cyan-500/20 rounded-lg">
            <BarChart3 className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <p className="text-cyan-300 font-medium">
              Press F12 to open DevTools Console
            </p>
            <p className="text-cyan-400/70 text-sm">
              Traces are logged with{' '}
              <code className="px-1 bg-cyan-900/50 rounded">debug: true</code>{' '}
              in init()
            </p>
          </div>
        </div>

        {/* Action Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <ActionCard
            icon={<Play className="w-6 h-6 text-blue-400" />}
            title="Basic Trace"
            description="Call a traced server function with argument capture"
            buttonText="Run Basic Trace"
            colorClass="bg-blue-600"
            state={basicState}
            onAction={() =>
              runAction(
                () => basicTrace({ data: 'World' }),
                setBasicState,
                'serverFn.basicTrace',
              )
            }
          />

          <ActionCard
            icon={<Clock className="w-6 h-6 text-yellow-400" />}
            title="Slow Operation"
            description="2 second delay - demonstrates tail sampling for slow requests"
            buttonText="Run Slow Operation"
            colorClass="bg-yellow-600"
            state={slowState}
            onAction={() =>
              runAction(
                () => slowOperation(),
                setSlowState,
                'serverFn.slowOperation',
              )
            }
          />

          <ActionCard
            icon={<AlertTriangle className="w-6 h-6 text-red-400" />}
            title="Trigger Error"
            description="Intentional failure - shows error spans and error reporting"
            buttonText="Trigger Error"
            colorClass="bg-red-600"
            state={errorState}
            onAction={() =>
              runAction(
                () => triggerError(),
                setErrorState,
                'serverFn.triggerError',
              )
            }
          />

          <ActionCard
            icon={<Link2 className="w-6 h-6 text-purple-400" />}
            title="Distributed Trace"
            description="Generate W3C trace context headers for propagation"
            buttonText="Run Distributed Trace"
            colorClass="bg-purple-600"
            state={distributedState}
            onAction={() =>
              runAction(
                () => distributedTrace(),
                setDistributedState,
                'serverFn.distributedTrace',
              )
            }
          />

          <ActionCard
            icon={<Zap className="w-6 h-6 text-green-400" />}
            title="Concurrent Operations"
            description="3 parallel traced calls - shows multiple spans"
            buttonText="Run 3 Concurrent"
            colorClass="bg-green-600"
            state={concurrentState}
            onAction={() =>
              runAction(
                () => concurrentOps(),
                setConcurrentState,
                'serverFn.concurrentOps',
              )
            }
          />
        </div>

        {/* More Demos */}
        <div className="flex flex-wrap gap-4 justify-center">
          <Link
            to="/demo/tanstack-query"
            className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-gray-300 transition-colors"
          >
            <BarChart3 className="w-4 h-4" />
            TanStack Query
          </Link>
          <Link
            to="/demo/start/server-funcs"
            className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-gray-300 transition-colors"
          >
            <Zap className="w-4 h-4" />
            Server Functions
          </Link>
          <Link
            to="/demo/start/ssr"
            className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-gray-300 transition-colors"
          >
            <Play className="w-4 h-4" />
            SSR Demos
          </Link>
        </div>
      </div>
    </div>
  )
}
