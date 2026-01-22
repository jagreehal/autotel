/**
 * beforeLoad Tracing Demo
 *
 * Demonstrates traceBeforeLoad for auth checks, redirects, and data prefetching
 */

import { createFileRoute, redirect } from '@tanstack/react-router'
import { traceBeforeLoad, traceLoader } from 'autotel-tanstack/loaders'

// Define search params schema for this route
type BeforeLoadSearch = {
  userId?: string
}

// Simulate auth check
async function checkAuth(userId?: string) {
  // Simulate async auth check
  await new Promise((resolve) => setTimeout(resolve, 10))
  return userId === 'admin'
}

export const Route = createFileRoute('/demo/before-load')({
  // Validate search params - TanStack Router will type `search` in beforeLoad/loader
  validateSearch: (search: Record<string, unknown>): BeforeLoadSearch => ({
    userId: typeof search.userId === 'string' ? search.userId : undefined,
  }),

  // Example: Using traceBeforeLoad for auth/redirect logic
  // Types are preserved - search, context, params are all typed by TanStack
  beforeLoad: traceBeforeLoad(async ({ search }) => {
    const userId = search.userId
    const isAuthenticated = await checkAuth(userId)

    if (!isAuthenticated) {
      // Redirects are expected control flow, not errors
      throw redirect({
        to: '/',
        search: {
          error: 'unauthorized',
        },
      })
    }

    // Return context for loader - this merges into loader's context
    return {
      userId,
      isAuthenticated,
    }
  }),

  // Example: Loader that depends on beforeLoad context
  // The context includes what beforeLoad returned (userId, isAuthenticated)
  loader: traceLoader(({ context }) => {
    // TanStack merges beforeLoad return into context
    const { userId, isAuthenticated } = context as {
      userId?: string
      isAuthenticated: boolean
    }

    return {
      message: `Welcome, ${userId || 'user'}!`,
      authenticated: isAuthenticated,
    }
  }),

  component: BeforeLoadDemo,
})

function BeforeLoadDemo() {
  const data = Route.useLoaderData()

  return (
    <div className="flex items-center justify-center min-h-screen p-4 text-white">
      <div
        className="w-full max-w-2xl p-8 rounded-xl backdrop-blur-md bg-black/50 shadow-xl border-8 border-black/10"
        style={{
          backgroundColor: '#000',
          backgroundImage:
            'radial-gradient(ellipse 60% 60% at 0% 100%, #444 0%, #222 60%, #000 100%)',
        }}
      >
        <h1 className="text-2xl mb-6">beforeLoad Tracing Demo</h1>

        <div className="space-y-4">
          <section>
            <h2 className="text-xl mb-2">Auth Status</h2>
            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-sm">
                <strong>Authenticated:</strong>{' '}
                {data.authenticated ? '✅ Yes' : '❌ No'}
              </p>
              <p className="text-sm">
                <strong>Message:</strong> {data.message}
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl mb-2">How it works</h2>
            <ul className="text-sm text-gray-300 space-y-2 list-disc list-inside">
              <li>
                <code>traceBeforeLoad()</code> - Traces beforeLoad execution
                (auth checks, redirects, prefetching)
              </li>
              <li>
                Redirects and notFound are treated as expected control flow (not
                errors)
              </li>
              <li>Loader runs after beforeLoad completes successfully</li>
            </ul>
          </section>

          <section>
            <p className="text-sm text-gray-400">
              Try accessing this route with <code>?userId=admin</code> to see
              successful auth, or without to see redirect.
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
