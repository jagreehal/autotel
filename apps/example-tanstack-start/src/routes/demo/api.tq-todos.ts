import { createFileRoute } from '@tanstack/react-router'
import { recordTiming } from 'autotel-tanstack/metrics'

const todos = [
  {
    id: 1,
    name: 'Buy groceries',
  },
  {
    id: 2,
    name: 'Buy mobile phone',
  },
  {
    id: 3,
    name: 'Buy laptop',
  },
]

// Example: API handlers with timing metrics
// Note: For full OTel spans, use traceServerFn with createServerFn instead
const getTodos = recordTiming('api.tq-todos.GET', () => {
  return Response.json(todos)
})

const addTodo = recordTiming(
  'api.tq-todos.POST',
  async ({ request }: { request: Request }) => {
    const name = await request.json()
    const todo = {
      id: todos.length + 1,
      name,
    }
    todos.push(todo)
    return Response.json(todo)
  },
)

export const Route = createFileRoute('/demo/api/tq-todos')({
  server: {
    handlers: {
      GET: getTodos,
      POST: addTodo,
    },
  },
})
