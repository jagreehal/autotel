import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowRight, Database, Eye, Play, Zap } from 'lucide-react'

export const Route = createFileRoute('/')({ component: App })

function App() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      {/* Hero Section */}
      <section className="relative py-20 px-6 text-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-purple-500/10"></div>
        <div className="relative max-w-4xl mx-auto">
          <div className="flex items-center justify-center gap-4 mb-6">
            <Eye className="w-16 h-16 text-cyan-400" />
            <h1 className="text-5xl md:text-6xl font-black text-white">
              <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                autotel-tanstack
              </span>
            </h1>
          </div>
          <p className="text-2xl text-gray-300 mb-3">
            OpenTelemetry for TanStack Start
          </p>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto mb-10">
            Add observability to your TanStack Start app in 2 lines of code.
            Trace server functions, loaders, and requests automatically.
          </p>

          {/* Primary CTA */}
          <Link
            to="/demo/playground"
            className="inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-400 hover:to-blue-400 text-white font-bold text-xl rounded-xl transition-all shadow-lg shadow-cyan-500/30 hover:shadow-cyan-500/50 hover:scale-105"
          >
            <Play className="w-6 h-6" />
            Try It Live
            <ArrowRight className="w-5 h-5" />
          </Link>

          <p className="text-gray-500 text-sm mt-4">
            Interactive playground - click buttons, see traces
          </p>
        </div>
      </section>

      {/* Quick Start Code */}
      <section className="py-12 px-6 max-w-3xl mx-auto">
        <h2 className="text-2xl font-bold text-white mb-6 text-center">
          Quick Start
        </h2>
        <div className="bg-slate-800/80 border border-slate-700 rounded-xl p-6 font-mono text-sm">
          <div className="text-gray-400 mb-2">// router.tsx</div>
          <div className="text-blue-400">
            import {'{'} tracingMiddleware {'}'} from{' '}
            <span className="text-green-400">'autotel-tanstack'</span>
          </div>
          <div className="text-gray-300 mt-3">
            requestMiddleware: [
            <span className="text-yellow-400">tracingMiddleware()</span>]
          </div>
          <div className="text-gray-500 mt-4">
            // That's it. All requests are now traced.
          </div>
        </div>
      </section>

      {/* Feature Links */}
      <section className="py-12 px-6 max-w-4xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Link
            to="/demo/playground"
            className="group bg-slate-800/50 border border-slate-700 rounded-xl p-6 hover:border-cyan-500/50 transition-all"
          >
            <Play className="w-10 h-10 text-cyan-400 mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-cyan-400 transition-colors">
              Playground
            </h3>
            <p className="text-gray-400 text-sm">
              Interactive demo - click buttons, see traces in console
            </p>
          </Link>

          <Link
            to="/demo/start/server-funcs"
            className="group bg-slate-800/50 border border-slate-700 rounded-xl p-6 hover:border-green-500/50 transition-all"
          >
            <Zap className="w-10 h-10 text-green-400 mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-green-400 transition-colors">
              Server Functions
            </h3>
            <p className="text-gray-400 text-sm">
              Traced server functions with automatic spans
            </p>
          </Link>

          <Link
            to="/demo/tanstack-query"
            className="group bg-slate-800/50 border border-slate-700 rounded-xl p-6 hover:border-purple-500/50 transition-all"
          >
            <Database className="w-10 h-10 text-purple-400 mb-4" />
            <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-purple-400 transition-colors">
              TanStack Query
            </h3>
            <p className="text-gray-400 text-sm">
              Traced API endpoints with timing recorded
            </p>
          </Link>
        </div>
      </section>

      {/* More Demos */}
      <section className="py-8 px-6 max-w-4xl mx-auto text-center">
        <p className="text-gray-500 mb-4">More demos:</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            to="/demo/start/server-funcs"
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-gray-300 text-sm transition-colors"
          >
            Server Functions
          </Link>
          <Link
            to="/demo/start/ssr"
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-gray-300 text-sm transition-colors"
          >
            SSR Demos
          </Link>
          <Link
            to="/demo/tanstack-query"
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-gray-300 text-sm transition-colors"
          >
            React Query
          </Link>
        </div>
      </section>
    </div>
  )
}
