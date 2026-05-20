import { h } from 'preact'
import { Cpu, Clock, Coins, Hash, Bot } from 'lucide-preact'
import { cn } from '../../utils/cn'
import type { GenAiSpan } from '../../genai/types'

interface Props {
  span: GenAiSpan
}

const PROVIDER_COLORS: Record<string, string> = {
  openai: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  anthropic: 'bg-orange-50 text-orange-700 border-orange-200',
  google: 'bg-blue-50 text-blue-700 border-blue-200',
  mistral: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200',
  groq: 'bg-amber-50 text-amber-700 border-amber-200',
  deepseek: 'bg-cyan-50 text-cyan-700 border-cyan-200',
}

function formatMs(ns: number): string {
  const ms = ns / 1_000_000
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function formatCost(usd: number): string {
  if (usd === 0) return '$0'
  if (usd < 0.0001) return `$${(usd * 1_000_000).toFixed(2)}μ`
  if (usd < 0.01) return `$${(usd * 1000).toFixed(3)}m`
  return `$${usd.toFixed(4)}`
}

function formatTokens(n: number | undefined): string {
  if (n == null) return '—'
  if (n < 1000) return `${n}`
  return `${(n / 1000).toFixed(1)}k`
}

export function ModelHeader({ span }: Props) {
  const providerClass =
    PROVIDER_COLORS[span.provider] ?? 'bg-zinc-50 text-zinc-700 border-zinc-200'
  const latency = formatMs(span.endNs - span.startNs)
  const totalTokens =
    (span.usage.inputTokens ?? 0) + (span.usage.outputTokens ?? 0)
  const cachedPct =
    span.usage.cacheReadInputTokens && span.usage.inputTokens
      ? Math.round((span.usage.cacheReadInputTokens / span.usage.inputTokens) * 100)
      : 0

  const params: Array<[string, string | number | undefined]> = [
    ['temp', span.params.temperature],
    ['top_p', span.params.topP],
    ['max', span.params.maxTokens],
  ]
  const paramText = params
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ')

  const providerLabel = span.provider === 'unknown' && span.agent?.name ? null : span.provider
  const modelLabel = span.responseModel ?? span.requestModel
  const showAgentChip = span.agent?.name && (span.provider === 'unknown' || modelLabel === 'unknown')

  return (
    <div
      className={cn(
        'flex items-center gap-3 flex-wrap',
        'px-3 py-2 border-b border-zinc-200',
        'text-sm',
      )}
    >
      {showAgentChip ? (
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5',
            'rounded border text-xs font-medium',
            'bg-violet-50 text-violet-700 border-violet-200',
          )}
        >
          <Bot size={12} />
          agent: {span.agent!.name}
        </span>
      ) : (
        <span
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5',
            'rounded border text-xs font-medium',
            providerClass,
          )}
        >
          <Cpu size={12} />
          {providerLabel}
        </span>
      )}
      {modelLabel !== 'unknown' && (
        <span className="font-mono text-zinc-900">{modelLabel}</span>
      )}
      <span className="text-zinc-500">{span.operation}</span>
      {paramText && (
        <span className="text-zinc-500 font-mono text-xs">{paramText}</span>
      )}
      <span className="ml-auto flex items-center gap-3 text-zinc-600">
        <span className="inline-flex items-center gap-1" title="Latency">
          <Clock size={12} />
          {latency}
        </span>
        <span className="inline-flex items-center gap-1" title="Tokens in → out">
          <Hash size={12} />
          {formatTokens(span.usage.inputTokens)}
          <span className="text-zinc-400">→</span>
          {formatTokens(span.usage.outputTokens)}
          {cachedPct > 0 && (
            <span className="ml-1 text-emerald-600">({cachedPct}% cached)</span>
          )}
        </span>
        <span
          className={cn(
            'inline-flex items-center gap-1',
            span.cost?.source === 'unknown' ? 'text-zinc-400' : 'text-zinc-900',
          )}
          title={
            span.cost?.source === 'unknown'
              ? `No price for ${span.provider}/${span.requestModel}`
              : 'Estimated cost'
          }
        >
          <Coins size={12} />
          {span.cost?.source === 'unknown' ? '—' : formatCost(span.cost?.total ?? 0)}
        </span>
      </span>
    </div>
  )
}
