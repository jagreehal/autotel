import { h } from 'preact'
import { useState } from 'preact/hooks'
import { Bot, ArrowRight, Cpu, AlertTriangle } from 'lucide-preact'
import { cn } from '../../utils/cn'
import type { GenAiSpan } from '../../genai/types'

interface Props {
  rows: Array<{ normalized: GenAiSpan; service: string; traceId: string }>
  onSelectSpan?: (spanId: string) => void
  selectedSpanId?: string | null
}

interface Group {
  conversationId: string
  service: string
  traceId: string
  spans: GenAiSpan[]
  startNs: number
  endNs: number
}

function groupByConversation(rows: Props['rows']): Group[] {
  const byId = new Map<string, Group>()
  // Spans without a conversation id get bucketed by traceId so they still
  // render as a coherent unit (one bucket per trace).
  for (const row of rows) {
    const id = row.normalized.conversationId ?? `trace:${row.traceId}`
    const g = byId.get(id)
    if (g) {
      g.spans.push(row.normalized)
      g.startNs = Math.min(g.startNs, row.normalized.startNs)
      g.endNs = Math.max(g.endNs, row.normalized.endNs)
    } else {
      byId.set(id, {
        conversationId: id,
        service: row.service,
        traceId: row.traceId,
        spans: [row.normalized],
        startNs: row.normalized.startNs,
        endNs: row.normalized.endNs,
      })
    }
  }
  // Newest first by conversation start.
  return [...byId.values()].sort((a, b) => b.startNs - a.startNs)
}

function laneFor(span: GenAiSpan): string {
  if (span.handoff) return `handoff: ${span.handoff.fromAgent ?? '?'} → ${span.handoff.toAgent ?? '?'}`
  if (span.agent?.name) return span.agent.name
  return `${span.provider}/${span.responseModel ?? span.requestModel}`
}

function formatMs(ns: number): string {
  const ms = ns / 1_000_000
  if (ms < 1000) return `${ms.toFixed(0)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

// A span is a wrapper if another span in the same lane is fully contained
// within its time range (strict containment, not equal). Wrappers render as
// an outlined rail behind their children rather than a solid block, so the
// inner steps don't disappear under the parent.
function markWrappers(spans: GenAiSpan[]): Set<string> {
  const wrapperIds = new Set<string>()
  for (let i = 0; i < spans.length; i++) {
    const a = spans[i]
    for (let j = 0; j < spans.length; j++) {
      if (i === j) continue
      const b = spans[j]
      const contains =
        b.startNs >= a.startNs &&
        b.endNs <= a.endNs &&
        b.endNs - b.startNs < a.endNs - a.startNs
      if (contains) {
        wrapperIds.add(a.spanId)
        break
      }
    }
  }
  return wrapperIds
}

function ConversationBlock({
  group,
  onSelectSpan,
  selectedSpanId,
}: {
  group: Group
  onSelectSpan?: (spanId: string) => void
  selectedSpanId?: string | null
}) {
  // Build stable lane ordering by first appearance.
  const laneOrder: string[] = []
  const laneMap = new Map<string, GenAiSpan[]>()
  for (const s of group.spans) {
    const lane = laneFor(s)
    if (!laneMap.has(lane)) {
      laneMap.set(lane, [])
      laneOrder.push(lane)
    }
    laneMap.get(lane)!.push(s)
  }
  // Wrapper detection runs per-lane: a span only wraps spans on its own lane.
  const wrapperIdsByLane = new Map<string, Set<string>>()
  for (const [lane, spans] of laneMap) {
    wrapperIdsByLane.set(lane, markWrappers(spans))
  }
  const durationNs = Math.max(1, group.endNs - group.startNs)

  return (
    <div className="border border-zinc-200 rounded-lg overflow-hidden bg-white">
      <header className="px-3 py-2 border-b border-zinc-200 bg-zinc-50 flex items-center gap-2 text-sm">
        <Bot size={14} className="text-violet-600" />
        <span className="font-mono text-xs text-zinc-700 truncate" title={group.conversationId}>
          {group.conversationId.startsWith('trace:')
            ? `trace ${group.conversationId.slice(6, 14)}…`
            : `conversation ${group.conversationId.slice(0, 12)}…`}
        </span>
        <span className="text-xs text-zinc-500 ml-auto">
          {group.spans.length} span{group.spans.length === 1 ? '' : 's'} · {formatMs(durationNs)} · {group.service}
        </span>
      </header>
      <div className="p-3 space-y-1.5">
        {laneOrder.map((lane) => {
          const spans = laneMap.get(lane)!
          const isHandoffLane = lane.startsWith('handoff:')
          return (
            <div key={lane} className="flex items-center gap-3">
              <div
                className={cn(
                  'w-44 shrink-0 flex items-center gap-1.5 text-xs font-mono truncate',
                  isHandoffLane ? 'text-violet-700' : 'text-zinc-700',
                )}
                title={lane}
              >
                {isHandoffLane ? <ArrowRight size={11} /> : <Cpu size={11} className="text-zinc-400" />}
                <span className="truncate">{lane}</span>
              </div>
              <div className="relative flex-1 h-6 bg-zinc-50 border border-zinc-100 rounded">
                {spans.map((s) => {
                  const leftPct = ((s.startNs - group.startNs) / durationNs) * 100
                  const widthPct = Math.max(0.5, ((s.endNs - s.startNs) / durationNs) * 100)
                  const errored = s.status === 'error'
                  const active = s.spanId === selectedSpanId
                  const isWrapper = wrapperIdsByLane.get(lane)?.has(s.spanId) ?? false
                  return (
                    <button
                      key={s.spanId}
                      type="button"
                      onClick={() => onSelectSpan?.(s.spanId)}
                      title={`${s.operation} · ${formatMs(s.endNs - s.startNs)}${s.usage.inputTokens != null ? ` · ${s.usage.inputTokens}→${s.usage.outputTokens ?? '—'}` : ''}${isWrapper ? ' (wraps children)' : ''}`}
                      className={cn(
                        'absolute top-0.5 bottom-0.5 rounded text-[10px] font-mono px-1 truncate flex items-center gap-1 transition-all',
                        // Wrappers render as outlined rails so the inner spans
                        // remain visible on top. Order matters in z-stack:
                        // wrappers below (zIndex 1), children above (zIndex 2).
                        isWrapper
                          ? 'bg-transparent border border-dashed border-zinc-400 text-zinc-500 hover:bg-zinc-100/50'
                          : isHandoffLane
                            ? 'bg-violet-200 hover:bg-violet-300 text-violet-900 border border-violet-300'
                            : errored
                              ? 'bg-red-200 hover:bg-red-300 text-red-900 border border-red-300'
                              : 'bg-emerald-100 hover:bg-emerald-200 text-emerald-900 border border-emerald-200',
                        active && 'ring-2 ring-zinc-900 ring-offset-1',
                      )}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        minWidth: 8,
                        zIndex: isWrapper ? 1 : 2,
                      }}
                    >
                      {errored && <AlertTriangle size={9} />}
                      <span className="truncate">{s.operation}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function AgentTimeline({ rows, onSelectSpan, selectedSpanId }: Props) {
  const groups = groupByConversation(rows)
  if (groups.length === 0) {
    return (
      <div className="p-6 text-sm text-zinc-500">
        No conversations to display.
      </div>
    )
  }
  return (
    <div className="p-3 space-y-3 overflow-y-auto h-full">
      {groups.map((g) => (
        <ConversationBlock
          key={g.conversationId}
          group={g}
          onSelectSpan={onSelectSpan}
          selectedSpanId={selectedSpanId}
        />
      ))}
    </div>
  )
}
