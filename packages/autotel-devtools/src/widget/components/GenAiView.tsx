import { h } from 'preact'
import { useState } from 'preact/hooks'
import { Cpu, MessageSquare, Bot, List, Network } from 'lucide-preact'
import { genAiRowsSignal } from '../store'
import type { GenAiSpan } from '../genai/types'
import { ModelHeader } from './genai/ModelHeader'
import { ConversationPanel } from './genai/ConversationPanel'
import { AgentTimeline } from './genai/AgentTimeline'
import { cn } from '../utils/cn'

function formatLatency(ns: number): string {
  const ms = ns / 1_000_000
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function formatTokens(usage: GenAiSpan['usage']): string {
  const i = usage.inputTokens
  const o = usage.outputTokens
  if (i == null && o == null) return '—'
  return `${i ?? '—'}→${o ?? '—'}`
}

function formatCost(cost: GenAiSpan['cost']): string {
  if (!cost || cost.source === 'unknown') return '—'
  if (cost.total < 0.0001) return `$${(cost.total * 1_000_000).toFixed(2)}μ`
  if (cost.total < 0.01) return `$${(cost.total * 1000).toFixed(3)}m`
  return `$${cost.total.toFixed(4)}`
}

type Mode = 'list' | 'timeline'

export function GenAiView() {
  const rows = genAiRowsSignal.value
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('list')
  const selected = rows.find((r) => r.normalized.spanId === selectedSpanId) ?? rows[0]
  const hasConversations = rows.some((r) => r.normalized.conversationId)

  if (rows.length === 0) {
    return (
      <div className="p-6 text-sm text-zinc-500">
        <div className="flex items-center gap-2 mb-2 text-zinc-700 font-medium">
          <MessageSquare size={16} />
          No GenAI spans yet
        </div>
        <p>
          Spans appear here as soon as your app emits OpenTelemetry GenAI semconv
          attributes (any of <code className="text-xs">gen_ai.system</code>,{' '}
          <code className="text-xs">gen_ai.provider.name</code>, or{' '}
          <code className="text-xs">gen_ai.operation.name</code>). Works with
          Vercel AI SDK <code className="text-xs">experimental_telemetry</code>,
          Pydantic AI + Logfire, OpenAI Agents v2, Anthropic, Google GenAI,
          LangChain, OpenLLMetry — anything following the spec.
        </p>
      </div>
    )
  }

  if (mode === 'timeline') {
    return (
      <div className="flex flex-col h-full">
        <ModeToggle mode={mode} setMode={setMode} hasConversations={hasConversations} />
        <div className="flex-1 overflow-hidden">
          <AgentTimeline
            rows={rows}
            selectedSpanId={selected?.normalized.spanId ?? null}
            onSelectSpan={(id) => {
              setSelectedSpanId(id)
              setMode('list')
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <ModeToggle mode={mode} setMode={setMode} hasConversations={hasConversations} />
      <div className="flex flex-1 overflow-hidden">
      <div className={cn('w-72 shrink-0 border-r border-zinc-200 overflow-y-auto')}>
        <ul className="divide-y divide-zinc-100">
          {rows.map((row) => {
            const active = row.normalized.spanId === selected?.normalized.spanId
            const errored = row.normalized.status === 'error'
            const model = row.normalized.responseModel ?? row.normalized.requestModel
            const isAgentSpan =
              row.normalized.agent?.name &&
              (row.normalized.provider === 'unknown' || model === 'unknown')
            return (
              <li key={row.normalized.spanId}>
                <button
                  type="button"
                  onClick={() => setSelectedSpanId(row.normalized.spanId)}
                  className={cn(
                    'w-full text-left px-3 py-2 hover:bg-zinc-50 transition-colors',
                    active && 'bg-zinc-100 hover:bg-zinc-100',
                  )}
                >
                  <div className="flex items-center gap-1.5 text-xs font-mono">
                    {isAgentSpan ? (
                      <Bot
                        size={11}
                        className={errored ? 'text-red-500' : 'text-violet-600'}
                      />
                    ) : (
                      <Cpu
                        size={11}
                        className={errored ? 'text-red-500' : 'text-zinc-500'}
                      />
                    )}
                    <span className="text-zinc-900 truncate">
                      {isAgentSpan
                        ? `agent: ${row.normalized.agent!.name}`
                        : `${row.normalized.provider}/${model}`}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
                    <span>{row.normalized.operation}</span>
                    <span>·</span>
                    <span>{formatLatency(row.normalized.endNs - row.normalized.startNs)}</span>
                    <span>·</span>
                    <span>{formatTokens(row.normalized.usage)}</span>
                    <span className="ml-auto">{formatCost(row.normalized.cost)}</span>
                  </div>
                  {row.service && (
                    <div className="mt-0.5 text-[10px] text-zinc-400 truncate">
                      {row.service}
                    </div>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
      <div className="flex-1 overflow-y-auto">
        {selected && (
          <>
            <ModelHeader span={selected.normalized} />
            <ConversationPanel span={selected.normalized} />
          </>
        )}
      </div>
      </div>
    </div>
  )
}

function ModeToggle({
  mode,
  setMode,
  hasConversations,
}: {
  mode: Mode
  setMode: (m: Mode) => void
  hasConversations: boolean
}) {
  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-zinc-200 bg-zinc-50/50">
      <button
        type="button"
        onClick={() => setMode('list')}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors',
          mode === 'list'
            ? 'bg-white border border-zinc-300 text-zinc-900 shadow-sm'
            : 'text-zinc-500 hover:text-zinc-700',
        )}
      >
        <List size={12} />
        List
      </button>
      <button
        type="button"
        onClick={() => setMode('timeline')}
        disabled={!hasConversations && false}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors',
          mode === 'timeline'
            ? 'bg-white border border-zinc-300 text-zinc-900 shadow-sm'
            : 'text-zinc-500 hover:text-zinc-700',
        )}
      >
        <Network size={12} />
        Timeline
        {!hasConversations && (
          <span className="ml-1 text-[10px] text-zinc-400">(by trace)</span>
        )}
      </button>
    </div>
  )
}
