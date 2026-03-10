/**
 * Error Tracking Demo
 *
 * Exercises autotel-web error tracking: unhandled errors, promise rejections,
 * manual captureException, suppression rules, and rate limiting.
 */

import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { captureException } from 'autotel-web/full'

export const Route = createFileRoute('/demo/error-tracking')({
  component: ErrorTrackingPage,
})

type LogEntry = {
  id: number
  time: string
  type: 'error' | 'info' | 'suppressed'
  message: string
}

let logId = 0

function ErrorTrackingPage() {
  const [logs, setLogs] = useState<Array<LogEntry>>([])

  const addLog = (type: LogEntry['type'], message: string) => {
    setLogs((prev) => [
      {
        id: ++logId,
        time: new Date().toISOString().slice(11, 23),
        type,
        message,
      },
      ...prev,
    ])
  }

  const triggerUnhandledError = () => {
    addLog('error', 'Throwing unhandled error...')
    // Use setTimeout to make it truly unhandled (not caught by React error boundary)
    setTimeout(() => {
      throw new TypeError('Unhandled TypeError from error tracking demo')
    }, 0)
  }

  const triggerUnhandledRejection = () => {
    addLog('error', 'Creating unhandled promise rejection...')
    Promise.reject(new Error('Unhandled promise rejection from demo'))
  }

  const triggerManualCapture = () => {
    try {
      // Simulate caught error
      JSON.parse('{ invalid json }')
    } catch (err) {
      captureException(err)
      addLog('info', `Manual captureException: ${(err as Error).message}`)
    }
  }

  const triggerCauseChain = () => {
    try {
      try {
        throw new Error('Database connection failed')
      } catch (dbErr) {
        throw new Error('Failed to load user profile', { cause: dbErr })
      }
    } catch (err) {
      captureException(err)
      addLog(
        'info',
        `Captured error with .cause chain: ${(err as Error).message}`,
      )
    }
  }

  const triggerSuppressedError = () => {
    addLog(
      'suppressed',
      'Throwing "Script error." (should be suppressed by rules)',
    )
    setTimeout(() => {
      throw new Error('Script error.')
    }, 0)
  }

  const triggerRateLimitBurst = () => {
    addLog('info', 'Firing 15 RangeErrors rapidly (rate limit: 10 per 10s)...')
    for (let i = 0; i < 15; i++) {
      captureException(new RangeError(`Burst error #${i + 1}`))
    }
    addLog('info', 'First 10 should be captured, last 5 rate-limited')
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-3">
            Error Tracking Demo
          </h1>
          <p className="text-gray-400 text-lg">
            Test autotel-web error tracking features.{' '}
            <span className="text-cyan-400">
              Open DevTools Console (F12) to see captured exceptions.
            </span>
          </p>
        </div>

        {/* Info Banner */}
        <div
          className="mb-8 p-4 bg-amber-900/30 border border-amber-700 rounded-lg"
          data-testid="error-tracking-banner"
        >
          <p className="text-amber-300 font-medium">
            Error tracking is active (full mode)
          </p>
          <p className="text-amber-400/70 text-sm">
            Stack traces parsed, exception chains walked, rate limiting at
            10/type/10s
          </p>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          <button
            data-testid="btn-unhandled-error"
            onClick={triggerUnhandledError}
            className="p-4 bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium transition-all"
          >
            Throw Unhandled Error
          </button>

          <button
            data-testid="btn-unhandled-rejection"
            onClick={triggerUnhandledRejection}
            className="p-4 bg-orange-600 hover:bg-orange-500 text-white rounded-lg font-medium transition-all"
          >
            Unhandled Promise Rejection
          </button>

          <button
            data-testid="btn-manual-capture"
            onClick={triggerManualCapture}
            className="p-4 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-all"
          >
            Manual captureException
          </button>

          <button
            data-testid="btn-cause-chain"
            onClick={triggerCauseChain}
            className="p-4 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-medium transition-all"
          >
            Error with .cause Chain
          </button>

          <button
            data-testid="btn-suppressed"
            onClick={triggerSuppressedError}
            className="p-4 bg-gray-600 hover:bg-gray-500 text-white rounded-lg font-medium transition-all"
          >
            Suppressed Error (Script error.)
          </button>

          <button
            data-testid="btn-rate-limit"
            onClick={triggerRateLimitBurst}
            className="p-4 bg-yellow-600 hover:bg-yellow-500 text-white rounded-lg font-medium transition-all"
          >
            Rate Limit Burst (15 errors)
          </button>
        </div>

        {/* Log Output */}
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <h2 className="text-lg font-semibold text-white mb-3">
            Activity Log
          </h2>
          <div
            data-testid="activity-log"
            className="space-y-1 max-h-64 overflow-y-auto font-mono text-sm"
          >
            {logs.length === 0 && (
              <p className="text-gray-500">
                Click a button to trigger an error...
              </p>
            )}
            {logs.map((log) => (
              <div
                key={log.id}
                className={`py-1 px-2 rounded ${
                  log.type === 'error'
                    ? 'text-red-300 bg-red-900/20'
                    : log.type === 'suppressed'
                      ? 'text-gray-400 bg-gray-900/20'
                      : 'text-blue-300 bg-blue-900/20'
                }`}
              >
                <span className="text-gray-500">[{log.time}]</span>{' '}
                {log.message}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
