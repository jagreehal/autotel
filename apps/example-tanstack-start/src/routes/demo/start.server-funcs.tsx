/**
 * Server Functions Demo - TanStack-Native Tracing
 *
 * This demo shows how server functions are automatically traced via
 * global functionMiddleware configured in start.ts (TanStack-native pattern).
 *
 * No per-function middleware needed - tracing just works!
 */
import fs from 'node:fs'
import { useCallback, useState } from 'react'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { traceLoader } from 'autotel-tanstack/loaders'
import { recordSpan } from '../../components/TracesDevtools'

const TODOS_FILE = 'todos.json'

type Todo = { id: number; name: string }

async function readTodos(): Promise<Array<Todo>> {
  return JSON.parse(
    await fs.promises.readFile(TODOS_FILE, 'utf-8').catch(() =>
      JSON.stringify(
        [
          { id: 1, name: 'Get groceries' },
          { id: 2, name: 'Buy a new phone' },
        ],
        null,
        2,
      ),
    ),
  )
}

// Server functions are automatically traced via global functionMiddleware in start.ts
const getTodos = createServerFn({ method: 'GET' }).handler(
  async () => await readTodos(),
)

const addTodo = createServerFn({ method: 'POST' })
  .inputValidator((d: string) => d)
  .handler(async ({ data }) => {
    const todos = await readTodos()
    todos.push({ id: todos.length + 1, name: data })
    await fs.promises.writeFile(TODOS_FILE, JSON.stringify(todos, null, 2))
    return todos
  })

export const Route = createFileRoute('/demo/start/server-funcs')({
  component: Home,
  loader: traceLoader(async () => await getTodos()),
})

function Home() {
  const router = useRouter()
  let todos = Route.useLoaderData()

  const [todo, setTodo] = useState('')

  const submitTodo = useCallback(async () => {
    const start = Date.now()
    try {
      todos = await addTodo({ data: todo })
      const duration = Date.now() - start
      recordSpan(
        'serverFn.addTodo',
        { todo: todo.slice(0, 50) },
        'ok',
        duration,
      )
      setTodo('')
      router.invalidate()
    } catch (error) {
      const duration = Date.now() - start
      recordSpan(
        'serverFn.addTodo',
        { error: String(error) },
        'error',
        duration,
      )
      throw error
    }
  }, [todo, router])

  return (
    <div
      className="flex items-center justify-center min-h-screen bg-gradient-to-br from-zinc-800 to-black p-4 text-white"
      style={{
        backgroundImage:
          'radial-gradient(50% 50% at 20% 60%, #23272a 0%, #18181b 50%, #000000 100%)',
      }}
    >
      <div className="w-full max-w-2xl p-8 rounded-xl backdrop-blur-md bg-black/50 shadow-xl border-8 border-black/10">
        <h1 className="text-2xl mb-4">
          Server Functions - Auto-Traced via Global Middleware
        </h1>

        <div className="mb-6 p-4 bg-white/5 rounded-lg border border-white/10">
          <h2 className="text-lg font-semibold mb-2">How it works:</h2>
          <ul className="text-sm text-gray-300 space-y-2 list-disc list-inside">
            <li>
              Global <code className="text-blue-400">functionMiddleware</code>{' '}
              configured in <code>start.ts</code>
            </li>
            <li>
              All server functions automatically traced - no per-function setup
            </li>
            <li>
              Uses TanStack's native{' '}
              <code className="text-blue-400">createMiddleware()</code> builder
            </li>
          </ul>
        </div>

        <ul className="mb-4 space-y-2">
          {todos.map((t: Todo) => (
            <li
              key={t.id}
              className="bg-white/10 border border-white/20 rounded-lg p-3 backdrop-blur-sm shadow-md"
            >
              <span className="text-lg text-white">{t.name}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2">
          <input
            type="text"
            value={todo}
            onChange={(e) => setTodo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                submitTodo()
              }
            }}
            placeholder="Enter a new todo..."
            className="w-full px-4 py-3 rounded-lg border border-white/20 bg-white/10 backdrop-blur-sm text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
          />
          <button
            disabled={todo.trim().length === 0}
            onClick={submitTodo}
            className="bg-blue-500 hover:bg-blue-600 disabled:bg-blue-500/50 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition-colors"
          >
            Add todo
          </button>
        </div>
      </div>
    </div>
  )
}
