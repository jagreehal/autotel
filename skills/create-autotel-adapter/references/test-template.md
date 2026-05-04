# Adapter test template

Cover the contract every adapter must honour. Replace `{name}` / `{Name}`.

## `src/index.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { InMemorySpanExporter } from 'autotel/exporters'
import { SimpleSpanProcessor } from 'autotel/processors'
import { init } from 'autotel'
import { useLogger, withAutotel } from './index'

const exporter = new InMemorySpanExporter()

init({
  service: 'autotel-{name}.test',
  spanProcessors: [new SimpleSpanProcessor(exporter)],
})

describe('autotel-{name}', () => {
  beforeEach(() => exporter.reset())

  it('useLogger() outside a request throws with a clear message', () => {
    expect(() => useLogger()).toThrow(/wrap your handler with withAutotel/i)
  })

  it('useLogger() inside a request returns the active logger', async () => {
    const handler = withAutotel()(async () => {
      const log = useLogger()
      log.set({ user: { id: 'usr_42' } })
      return 'ok'
    })

    await handler({ method: 'GET', path: '/test' } as never)

    const [span] = exporter.getFinishedSpans()
    expect(span.attributes['user.id']).toBe('usr_42')
    expect(span.attributes['http.request.method']).toBe('GET')
    expect(span.attributes['http.route']).toBe('/test')
  })

  it('records exceptions on the span and re-throws', async () => {
    const handler = withAutotel()(async () => {
      throw new Error('boom')
    })

    await expect(handler({ method: 'GET', path: '/' } as never)).rejects.toThrow('boom')

    const [span] = exporter.getFinishedSpans()
    expect(span.status.code).toBe(2 /* ERROR */)
    expect(
      span.events.find((e) => e.name === 'exception')?.attributes?.['exception.message'],
    ).toBe('boom')
  })

  it('log.fork() propagates _parentCorrelationId', async () => {
    let parentCorrelationId: unknown
    let childCorrelationId: unknown
    let childParent: unknown

    const handler = withAutotel()(async () => {
      const log = useLogger()
      parentCorrelationId = log.getContext().correlationId
      log.fork('background', async () => {
        const child = useLogger()
        childCorrelationId = child.getContext().correlationId
        childParent = child.getContext()._parentCorrelationId
      })
      // give the fork a tick to settle
      await new Promise((r) => setImmediate(r))
      await new Promise((r) => setImmediate(r))
    })

    await handler({ method: 'GET', path: '/' } as never)

    expect(typeof parentCorrelationId).toBe('string')
    expect(childParent).toBe(parentCorrelationId)
    expect(childCorrelationId).not.toBe(parentCorrelationId)
  })
})
```
