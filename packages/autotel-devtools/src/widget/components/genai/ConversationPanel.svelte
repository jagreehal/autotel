<script lang="ts">
  import { User, Bot, Settings, Wrench } from '@lucide/svelte';
  import { cn } from '../../utils/cn';
  import ToolCallCard from './ToolCallCard.svelte';
  import type {
    GenAiMessage,
    GenAiMessagePart,
    GenAiSpan,
  } from '../../genai/types';

  interface Props {
    span: GenAiSpan;
  }
  let { span }: Props = $props();

  const ROLE_STYLES: Record<
    GenAiMessage['role'],
    { wrap: string; chip: string; label: string; icon: typeof User }
  > = {
    system: {
      wrap: 'bg-subtle border-line',
      chip: 'bg-hover text-fg-muted',
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
  };
</script>

{#snippet messagePart(part: GenAiMessagePart)}
  {#if part.kind === 'text'}
    <p class="whitespace-pre-wrap leading-relaxed text-fg text-sm">
      {part.text}
    </p>
  {:else if part.kind === 'image'}
    <div class="text-xs text-fg-subtle italic">
      [image · {part.mediaType} · ref={part.dataRef}]
    </div>
  {:else if part.kind === 'audio'}
    <div class="text-xs text-fg-subtle italic">
      [audio · {part.mediaType} · ref={part.dataRef}]
    </div>
  {:else if part.kind === 'ref'}
    <div class="text-xs text-fg-muted italic">
      Content stored externally ({part.direction}). Reference:
      <code class="not-italic text-fg">{part.ref}</code>
    </div>
  {:else}
    <pre
      class="text-xs bg-zinc-900 text-zinc-100 p-2 rounded overflow-x-auto">{JSON.stringify(
        part.value,
        null,
        2,
      )}</pre>
  {/if}
{/snippet}

{#snippet messageBubble(message: GenAiMessage)}
  {@const style = ROLE_STYLES[message.role] ?? ROLE_STYLES.user}
  {@const Icon = style.icon}
  <div class={cn('border rounded-lg px-3 py-2', style.wrap)}>
    <div class="flex items-center gap-1.5 mb-1.5">
      <span
        class={cn(
          'inline-flex items-center gap-1 px-1.5 py-0.5',
          'rounded text-[10px] font-medium uppercase tracking-wide',
          style.chip,
        )}
      >
        <Icon size={10} />
        {style.label}
      </span>
      {#if message.finishReason}
        <span class="text-[10px] text-fg-subtle">
          finish: {message.finishReason}
        </span>
      {/if}
      {#if message.toolCallId}
        <span class="text-[10px] font-mono text-fg-subtle">
          tool_call_id={message.toolCallId}
        </span>
      {/if}
    </div>
    <div class="space-y-2">
      {#each message.parts as p (p)}
        {@render messagePart(p)}
      {/each}
    </div>
    {#each message.toolCalls ?? [] as call (call)}
      <ToolCallCard {call} />
    {/each}
  </div>
{/snippet}

{#snippet handoffPanel(span: GenAiSpan)}
  <div class="p-4 space-y-3 text-sm">
    <div class="flex items-center gap-2 text-violet-700 font-medium">
      <Wrench size={14} />
      Agent handoff
    </div>
    <div class="grid grid-cols-[80px_1fr] gap-y-2 text-fg-muted">
      {#if span.handoff?.fromAgent}
        <div class="text-fg-subtle">from</div>
        <div class="font-mono">{span.handoff.fromAgent}</div>
      {/if}
      {#if span.handoff?.toAgent}
        <div class="text-fg-subtle">to</div>
        <div class="font-mono">{span.handoff.toAgent}</div>
      {/if}
      {#if span.conversationId}
        <div class="text-fg-subtle">conversation</div>
        <div class="font-mono text-xs text-fg-muted truncate">
          {span.conversationId}
        </div>
      {/if}
      {#if span.agent?.name}
        <div class="text-fg-subtle">agent</div>
        <div class="font-mono">{span.agent.name}</div>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet agentRunPanel(span: GenAiSpan)}
  <div class="p-4 space-y-3 text-sm">
    <div class="flex items-center gap-2 text-violet-700 font-medium">
      <Bot size={14} />
      Agent run
    </div>
    <div class="grid grid-cols-[100px_1fr] gap-y-2 text-fg-muted">
      {#if span.agent?.name}
        <div class="text-fg-subtle">agent</div>
        <div class="font-mono">{span.agent.name}</div>
      {/if}
      {#if span.agent?.description}
        <div class="text-fg-subtle">description</div>
        <div>{span.agent.description}</div>
      {/if}
      {#if span.conversationId}
        <div class="text-fg-subtle">conversation</div>
        <div class="font-mono text-xs text-fg-muted truncate">
          {span.conversationId}
        </div>
      {/if}
    </div>
    <p class="text-xs text-fg-subtle italic">
      Agent-run spans aggregate child LLM calls. Open child spans for
      transcripts.
    </p>
  </div>
{/snippet}

{#if span.messages.length === 0}
  {#if span.operation === 'execute_handoff' || span.handoff}
    {@render handoffPanel(span)}
  {:else if span.operation === 'invoke_agent' || span.operation === 'create_agent'}
    {@render agentRunPanel(span)}
  {:else}
    <div class="p-4 text-sm text-fg-subtle italic">
      No conversation payload on this span. Enable content capture (<code
        class="text-xs"
        >OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true</code
      >) in your instrumentation to see prompts and completions.
    </div>
  {/if}
{:else}
  <div class="p-3 space-y-2">
    {#each span.messages as m (m)}
      {@render messageBubble(m)}
    {/each}
  </div>
{/if}
