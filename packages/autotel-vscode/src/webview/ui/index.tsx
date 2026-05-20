import { render } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import { isGenAiSpan, toGenAiSpan } from 'autotel-devtools/genai'
import type {
  GenAiMessage,
  GenAiMessagePart,
  GenAiSpan,
  GenAiToolCall,
} from 'autotel-devtools/genai'

interface Span {
  traceId: string
  spanId: string
  parentSpanId?: string
  name: string
  kind: 'INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER'
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

      {isGenAiSpan(span) ? <GenAiSection rawSpan={span} /> : null}

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

function formatTokens(n: number | undefined): string {
  if (n == null) return '—'
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(1)}k`
}

function formatCost(usd: number, source: 'table' | 'unknown'): string {
  if (source === 'unknown' || !usd) return '—'
  if (usd < 0.0001) return `$${(usd * 1_000_000).toFixed(2)}μ`
  if (usd < 0.01) return `$${(usd * 1000).toFixed(3)}m`
  return `$${usd.toFixed(4)}`
}

function GenAiSection({ rawSpan }: { rawSpan: Span }) {
  const normalized = useMemo<GenAiSpan>(() => toGenAiSpan(rawSpan), [rawSpan])
  const cached =
    normalized.usage.cacheReadInputTokens && normalized.usage.inputTokens
      ? Math.round((normalized.usage.cacheReadInputTokens / normalized.usage.inputTokens) * 100)
      : 0

  return (
    <section className="genai">
      <h2>GenAI</h2>
      <div className="genai-header">
        <span className="genai-chip" data-provider={normalized.provider}>
          {normalized.provider}
        </span>
        <code className="genai-model">{normalized.responseModel ?? normalized.requestModel}</code>
        <span className="muted">{normalized.operation}</span>
        <span className="genai-meta">
          {formatTokens(normalized.usage.inputTokens)} → {formatTokens(normalized.usage.outputTokens)}
          {cached > 0 ? <span className="genai-cached"> ({cached}% cached)</span> : null}
          <span className="genai-cost">
            {' · '}
            {formatCost(normalized.cost?.total ?? 0, normalized.cost?.source ?? 'unknown')}
          </span>
        </span>
      </div>

      {normalized.agent?.name || normalized.handoff?.fromAgent ? (
        <dl className="genai-agent">
          {normalized.agent?.name ? (
            <>
              <dt>Agent</dt>
              <dd>{normalized.agent.name}</dd>
            </>
          ) : null}
          {normalized.handoff?.fromAgent ? (
            <>
              <dt>Handoff</dt>
              <dd>
                {normalized.handoff.fromAgent} → {normalized.handoff.toAgent}
              </dd>
            </>
          ) : null}
          {normalized.conversationId ? (
            <>
              <dt>Conversation</dt>
              <dd><code>{normalized.conversationId}</code></dd>
            </>
          ) : null}
        </dl>
      ) : null}

      {normalized.messages.length > 0 ? (
        <div className="genai-conversation">
          {normalized.messages.map((m, i) => (
            <GenAiMessageBubble key={i} message={m} />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function GenAiMessageBubble({ message }: { message: GenAiMessage }) {
  return (
    <div className={`genai-message genai-role-${message.role}`}>
      <div className="genai-role">{message.role.toUpperCase()}</div>
      <div className="genai-parts">
        {message.parts.map((part, i) => (
          <GenAiPartView key={i} part={part} />
        ))}
        {message.toolCalls?.map((call, i) => (
          <GenAiToolCallView key={`tc-${i}`} call={call} />
        ))}
      </div>
      {message.finishReason ? (
        <div className="genai-finish">finish: {message.finishReason}</div>
      ) : null}
    </div>
  )
}

function GenAiPartView({ part }: { part: GenAiMessagePart }) {
  if (part.kind === 'text') {
    return <p className="genai-text">{part.text}</p>
  }
  if (part.kind === 'image' || part.kind === 'audio') {
    return (
      <div className="muted">
        [{part.kind} · {part.mediaType} · ref={part.dataRef}]
      </div>
    )
  }
  if (part.kind === 'ref') {
    return (
      <div className="muted">
        Content stored externally ({part.direction}): <code>{part.ref}</code>
      </div>
    )
  }
  return <pre className="genai-json">{JSON.stringify(part.value, null, 2)}</pre>
}

function GenAiToolCallView({ call }: { call: GenAiToolCall }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="genai-tool">
      <button
        type="button"
        className="genai-tool-header"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? '▾' : '▸'} 🔧 <span className="genai-tool-name">{call.name}</span>
      </button>
      {open ? (
        <div className="genai-tool-body">
          <div className="genai-tool-section">
            <div className="genai-tool-label">INPUT</div>
            <pre className="genai-json">{JSON.stringify(call.arguments, null, 2)}</pre>
          </div>
          {call.result !== undefined ? (
            <div className="genai-tool-section genai-tool-output">
              <div className="genai-tool-label">OUTPUT</div>
              <pre className="genai-json">{JSON.stringify(call.result, null, 2)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const root = document.getElementById('root')
if (root) {
  render(<App />, root)
}
