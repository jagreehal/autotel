import { render } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'

interface Span {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: string
  startTime: number
  endTime: number
  duration: number
  attributes: Record<string, unknown>
  status: { code: 'OK' | 'ERROR' | 'UNSET'; message?: string }
  events?: Array<{ name: string; timestamp: number; attributes?: Record<string, unknown> }>
}

interface Trace {
  traceId: string
  service: string
  duration: number
  status: 'OK' | 'ERROR' | 'UNSET'
  spans: Span[]
}

interface VsCodeApi {
  postMessage(message: unknown): void
}

declare const acquireVsCodeApi: () => VsCodeApi

const vscode: VsCodeApi = acquireVsCodeApi()

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '?'
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`
  if (ms < 1000) return `${ms.toFixed(2)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function formatTimestamp(ms: number): string {
  if (!Number.isFinite(ms)) return '?'
  return new Date(ms).toISOString()
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function App() {
  const [span, setSpan] = useState<Span | undefined>(undefined)
  const [trace, setTrace] = useState<Trace | undefined>(undefined)

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data as { type?: string; span?: Span; trace?: Trace }
      if (data?.type === 'span' && data.span) {
        setSpan(data.span)
        setTrace(data.trace)
      }
    }
    window.addEventListener('message', handler)
    vscode.postMessage({ type: 'ready' })
    return () => window.removeEventListener('message', handler)
  }, [])

  if (!span) {
    return (
      <main className="empty">
        <p>Waiting for span data…</p>
      </main>
    )
  }

  return <SpanDetail span={span} trace={trace} />
}

function SpanDetail({ span, trace }: { span: Span; trace?: Trace }) {
  const filepath = useMemo(() => {
    const value = span.attributes?.['code.filepath']
    return typeof value === 'string' ? value : undefined
  }, [span])
  const lineno = useMemo(() => {
    const value = span.attributes?.['code.lineno']
    return typeof value === 'number' ? value : undefined
  }, [span])

  const attributeRows = useMemo(
    () =>
      Object.entries(span.attributes ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    [span],
  )

  return (
    <main>
      <header>
        <h1>{span.name}</h1>
        <p className="subtitle">
          <span className={`badge badge-${span.status.code.toLowerCase()}`}>{span.status.code}</span>
          <span className="kind">{span.kind}</span>
          <span className="duration">{formatDuration(span.duration)}</span>
        </p>
      </header>

      <section>
        <h2>Identity</h2>
        <dl>
          <dt>Trace ID</dt>
          <dd><code>{span.traceId}</code></dd>
          <dt>Span ID</dt>
          <dd>
            <code>{span.spanId}</code>
            <button type="button" onClick={() => vscode.postMessage({ type: 'copySpanId', spanId: span.spanId })}>
              Copy
            </button>
          </dd>
          {span.parentSpanId ? (
            <>
              <dt>Parent Span</dt>
              <dd><code>{span.parentSpanId}</code></dd>
            </>
          ) : null}
          {trace?.service ? (
            <>
              <dt>Service</dt>
              <dd>{trace.service}</dd>
            </>
          ) : null}
        </dl>
      </section>

      <section>
        <h2>Timing</h2>
        <dl>
          <dt>Start</dt>
          <dd>{formatTimestamp(span.startTime)}</dd>
          <dt>End</dt>
          <dd>{formatTimestamp(span.endTime)}</dd>
          <dt>Duration</dt>
          <dd>{formatDuration(span.duration)}</dd>
        </dl>
      </section>

      {span.status.message ? (
        <section>
          <h2>Status Message</h2>
          <pre className="status-message">{span.status.message}</pre>
        </section>
      ) : null}

      {filepath ? (
        <section>
          <h2>Source</h2>
          <p>
            <code>{filepath}{lineno ? `:${lineno}` : ''}</code>
          </p>
          <button
            type="button"
            onClick={() => vscode.postMessage({ type: 'revealSource', spanId: span.spanId })}
          >
            Reveal Source
          </button>
        </section>
      ) : null}

      <section>
        <h2>Attributes</h2>
        {attributeRows.length === 0 ? (
          <p className="muted">No attributes.</p>
        ) : (
          <table>
            <thead>
              <tr><th>Key</th><th>Value</th></tr>
            </thead>
            <tbody>
              {attributeRows.map(([key, value]) => (
                <tr key={key}>
                  <td><code>{key}</code></td>
                  <td><code>{stringifyValue(value)}</code></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {span.events && span.events.length > 0 ? (
        <section>
          <h2>Events</h2>
          <ul>
            {span.events.map((event, index) => (
              <li key={`${event.name}-${index}`}>
                <strong>{event.name}</strong>
                <span className="muted"> · {formatTimestamp(event.timestamp)}</span>
                {event.attributes ? (
                  <pre>{JSON.stringify(event.attributes, null, 2)}</pre>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  )
}

const root = document.getElementById('root')
if (root) {
  render(<App />, root)
}
