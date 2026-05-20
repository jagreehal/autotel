import { h } from 'preact'
import { useState } from 'preact/hooks'
import { User, Bot, Settings, Wrench, ChevronRight } from 'lucide-preact'
import { cn } from '../../utils/cn'
import type {
  GenAiMessage,
  GenAiMessagePart,
  GenAiSpan,
  GenAiToolCall,
} from '../../genai/types'
// `Bot` imported above is reused by HandoffPanel / AgentRunPanel below.


interface Props {
  span: GenAiSpan
}

const ROLE_STYLES: Record<
  GenAiMessage['role'],
  { wrap: string; chip: string; label: string; icon: any }
> = {
  system: {
    wrap: 'bg-zinc-50 border-zinc-200',
    chip: 'bg-zinc-200 text-zinc-700',
    label: 'system',
    icon: Settings,
  },
  user: {
    wrap: 'bg-blue-50/40 border-blue-100',
    chip: 'bg-blue-100 text-blue-800',
    label: 'user',
    icon: User,
  },
  assistant: {
    wrap: 'bg-emerald-50/40 border-emerald-100',
    chip: 'bg-emerald-100 text-emerald-800',
    label: 'assistant',
    icon: Bot,
  },
  tool: {
    wrap: 'bg-amber-50/40 border-amber-100',
    chip: 'bg-amber-100 text-amber-800',
    label: 'tool',
    icon: Wrench,
  },
}

function MessagePart({ part }: { part: GenAiMessagePart }) {
  if (part.kind === 'text') {
    return (
      <p className="whitespace-pre-wrap leading-relaxed text-zinc-800 text-sm">
        {part.text}
      </p>
    )
  }
  if (part.kind === 'image') {
    return (
      <div className="text-xs text-zinc-500 italic">
        [image · {part.mediaType} · ref={part.dataRef}]
      </div>
    )
  }
  if (part.kind === 'audio') {
    return (
      <div className="text-xs text-zinc-500 italic">
        [audio · {part.mediaType} · ref={part.dataRef}]
      </div>
    )
  }
  if (part.kind === 'ref') {
    return (
      <div className="text-xs text-zinc-600 italic">
        Content stored externally ({part.direction}). Reference:{' '}
        <code className="not-italic text-zinc-800">{part.ref}</code>
      </div>
    )
  }
  return (
    <pre className="text-xs bg-zinc-900 text-zinc-100 p-2 rounded overflow-x-auto">
      {JSON.stringify(part.value, null, 2)}
    </pre>
  )
}

function formatToolParams(args: unknown): string {
  if (args == null || typeof args !== 'object' || Array.isArray(args)) return ''
  const entries = Object.entries(args as Record<string, unknown>)
  if (entries.length === 0) return ''
  return entries
    .slice(0, 3)
    .map(([k, v]) => {
      const val =
        typeof v === 'string'
          ? `"${v.length > 20 ? v.slice(0, 20) + '…' : v}"`
          : v === null
            ? 'null'
            : typeof v === 'object'
              ? '…'
              : String(v)
      return `${k}: ${val}`
    })
    .join(', ')
}

function ToolCallCard({ call }: { call: GenAiToolCall }) {
  const [open, setOpen] = useState(false)
  const args =
    typeof call.arguments === 'string'
      ? (() => {
          try {
            return JSON.parse(call.arguments)
          } catch {
            return call.arguments
          }
        })()
      : call.arguments
  const result = call.result
  const paramSummary = formatToolParams(args)

  return (
    <div className="mt-2 border border-violet-200 rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'w-full px-2.5 py-1.5 flex items-center gap-1.5 text-left',
          'text-xs bg-violet-50 hover:bg-violet-100/70 transition-colors',
        )}
      >
        <ChevronRight
          size={12}
          className={cn('text-violet-600 transition-transform shrink-0', open && 'rotate-90')}
        />
        <Wrench size={12} className="text-violet-600 shrink-0" />
        <span className="font-mono font-medium text-violet-900">{call.name}</span>
        {!open && paramSummary && (
          <span className="font-mono text-[11px] text-violet-700/70 truncate">
            ({paramSummary})
          </span>
        )}
        {!open && result === undefined && (
          <span className="ml-auto text-[10px] uppercase tracking-wide text-zinc-400">
            no result
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="px-3 py-2 border-t border-violet-200/60 bg-white">
            <div className="text-[10px] font-medium uppercase tracking-wider text-zinc-500 mb-1">
              Input
            </div>
            <pre className="text-xs bg-zinc-50 border border-zinc-200 text-zinc-800 p-2 rounded overflow-x-auto">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>
          {result !== undefined && (
            <div className="px-3 py-2 border-t border-emerald-200/60 bg-emerald-50/40">
              <div className="text-[10px] font-medium uppercase tracking-wider text-emerald-700 mb-1">
                Output
              </div>
              <pre className="text-xs bg-white border border-emerald-200 text-zinc-800 p-2 rounded overflow-x-auto">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
          {call.id && (
            <div className="px-3 py-1.5 border-t border-zinc-100 bg-zinc-50/60 text-[10px] font-mono text-zinc-500">
              id: {call.id}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function MessageBubble({ message }: { message: GenAiMessage }) {
  const style = ROLE_STYLES[message.role] ?? ROLE_STYLES.user
  const Icon = style.icon
  return (
    <div className={cn('border rounded-lg px-3 py-2', style.wrap)}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span
          className={cn(
            'inline-flex items-center gap-1 px-1.5 py-0.5',
            'rounded text-[10px] font-medium uppercase tracking-wide',
            style.chip,
          )}
        >
          <Icon size={10} />
          {style.label}
        </span>
        {message.finishReason && (
          <span className="text-[10px] text-zinc-500">
            finish: {message.finishReason}
          </span>
        )}
        {message.toolCallId && (
          <span className="text-[10px] font-mono text-zinc-500">
            tool_call_id={message.toolCallId}
          </span>
        )}
      </div>
      <div className="space-y-2">
        {message.parts.map((p, i) => (
          <MessagePart key={i} part={p} />
        ))}
      </div>
      {message.toolCalls?.map((call, i) => <ToolCallCard key={i} call={call} />)}
    </div>
  )
}

function HandoffPanel({ span }: { span: GenAiSpan }) {
  return (
    <div className="p-4 space-y-3 text-sm">
      <div className="flex items-center gap-2 text-violet-700 font-medium">
        <Wrench size={14} />
        Agent handoff
      </div>
      <div className="grid grid-cols-[80px_1fr] gap-y-2 text-zinc-700">
        {span.handoff?.fromAgent && (
          <>
            <div className="text-zinc-500">from</div>
            <div className="font-mono">{span.handoff.fromAgent}</div>
          </>
        )}
        {span.handoff?.toAgent && (
          <>
            <div className="text-zinc-500">to</div>
            <div className="font-mono">{span.handoff.toAgent}</div>
          </>
        )}
        {span.conversationId && (
          <>
            <div className="text-zinc-500">conversation</div>
            <div className="font-mono text-xs text-zinc-600 truncate">{span.conversationId}</div>
          </>
        )}
        {span.agent?.name && (
          <>
            <div className="text-zinc-500">agent</div>
            <div className="font-mono">{span.agent.name}</div>
          </>
        )}
      </div>
    </div>
  )
}

function AgentRunPanel({ span }: { span: GenAiSpan }) {
  return (
    <div className="p-4 space-y-3 text-sm">
      <div className="flex items-center gap-2 text-violet-700 font-medium">
        <Bot size={14} />
        Agent run
      </div>
      <div className="grid grid-cols-[100px_1fr] gap-y-2 text-zinc-700">
        {span.agent?.name && (
          <>
            <div className="text-zinc-500">agent</div>
            <div className="font-mono">{span.agent.name}</div>
          </>
        )}
        {span.agent?.description && (
          <>
            <div className="text-zinc-500">description</div>
            <div>{span.agent.description}</div>
          </>
        )}
        {span.conversationId && (
          <>
            <div className="text-zinc-500">conversation</div>
            <div className="font-mono text-xs text-zinc-600 truncate">{span.conversationId}</div>
          </>
        )}
      </div>
      <p className="text-xs text-zinc-500 italic">
        Agent-run spans aggregate child LLM calls. Open child spans for transcripts.
      </p>
    </div>
  )
}

export function ConversationPanel({ span }: Props) {
  if (span.messages.length === 0) {
    if (span.operation === 'execute_handoff' || span.handoff) {
      return <HandoffPanel span={span} />
    }
    if (span.operation === 'invoke_agent' || span.operation === 'create_agent') {
      return <AgentRunPanel span={span} />
    }
    return (
      <div className="p-4 text-sm text-zinc-500 italic">
        No conversation payload on this span. Enable content capture
        (<code className="text-xs">OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true</code>)
        in your instrumentation to see prompts and completions.
      </div>
    )
  }
  return (
    <div className="p-3 space-y-2">
      {span.messages.map((m, i) => (
        <MessageBubble key={i} message={m} />
      ))}
    </div>
  )
}
