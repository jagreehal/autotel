<script lang="ts">
  import { ChevronDown } from '@lucide/svelte';
  import { getStatusColor, formatDuration } from '../utils';
  import { activateOnKey } from '../utils/keyboard';
  import { cn } from '../utils/cn';
  import Copyable from './Copyable.svelte';
  import ExpandableSection from './ExpandableSection.svelte';
  import type { TraceData, SpanData } from '../types';

  interface Props {
    span: SpanData;
    trace: TraceData;
    isSelected: boolean;
    onSelect: () => void;
  }
  let { span, trace, isSelected, onSelect }: Props = $props();

  let expanded = $state(false);
  let expandedSections = $state<Record<string, boolean>>({
    attributes: false,
    events: false,
  });

  const isError = $derived(span.status.code === 'ERROR');

  function toggleSection(section: string) {
    expandedSections = {
      ...expandedSections,
      [section]: !expandedSections[section],
    };
  }

  // Calculate indent level based on parent relationships
  function getIndentLevel() {
    let level = 0;
    let currentSpan = span;
    while (currentSpan.parentSpanId) {
      level++;
      const parent = trace.spans.find(
        (s) => s.spanId === currentSpan.parentSpanId,
      );
      if (!parent) break;
      currentSpan = parent;
    }
    return level;
  }

  const indentLevel = $derived(getIndentLevel());
  const hasAttributes = $derived(Object.keys(span.attributes || {}).length > 0);
  const hasEvents = $derived(span.events && span.events.length > 0);
</script>

<div
  class={cn(
    'px-4 py-3',
    'hover:bg-subtle transition-colors cursor-pointer',
    isError && 'bg-red-50/30',
    isSelected && 'bg-hover hover:bg-hover',
  )}
  style="padding-left: {16 + indentLevel * 20}px;"
  role="button"
  tabindex="0"
  data-focus-inset
  onclick={onSelect}
  onkeydown={activateOnKey(onSelect)}
>
  <div class="flex items-center justify-between gap-4">
    <div class="flex-1 min-w-0">
      <div class="font-medium text-sm mb-1 text-fg">
        {span.name || 'unknown'}
      </div>
      <div class="flex items-center gap-3 text-xs text-fg-muted">
        <span class={cn('font-medium', getStatusColor(span.status.code))}>
          {span.status.code}
        </span>
        <span>{formatDuration(span.duration)}</span>
        <span class="text-fg-subtle">{span.kind}</span>
      </div>
    </div>

    <button
      onclick={(e) => {
        e.stopPropagation();
        expanded = !expanded;
      }}
      class="p-1 hover:bg-hover rounded"
    >
      <ChevronDown
        size={14}
        class={cn(
          'text-fg-subtle transition-transform flex-shrink-0',
          expanded && 'rotate-180',
        )}
      />
    </button>
  </div>

  {#if expanded}
    <!-- Presentational wrapper: the handler only stops clicks in the expanded
         detail from bubbling to the row's select handler — not a control. -->
    <div
      role="presentation"
      class="mt-3 pt-3 border-t border-line space-y-3"
      onclick={(e) => e.stopPropagation()}
    >
      <!-- Attributes section -->
      {#if hasAttributes}
        <ExpandableSection
          label="All attributes"
          expanded={expandedSections.attributes}
          onToggle={() => toggleSection('attributes')}
        >
          <Copyable content={JSON.stringify(span.attributes, null, 2)}>
            <div
              class="bg-subtle rounded p-3 border border-line font-mono text-xs"
            >
              <pre
                class="whitespace-pre-wrap break-words text-fg">{JSON.stringify(
                  span.attributes,
                  null,
                  2,
                )}</pre>
            </div>
          </Copyable>
        </ExpandableSection>
      {/if}

      <!-- Events section -->
      {#if hasEvents}
        <ExpandableSection
          label={`Events (${span.events!.length})`}
          expanded={expandedSections.events}
          onToggle={() => toggleSection('events')}
        >
          <div class="space-y-2">
            {#each span.events! as event, idx (idx)}
              <div class="bg-subtle rounded p-2.5 border border-line">
                <div class="font-medium text-xs text-fg mb-1.5">
                  {event.name}
                </div>
                {#if event.attributes && Object.keys(event.attributes).length > 0}
                  <Copyable content={JSON.stringify(event.attributes, null, 2)}>
                    <div class="font-mono text-xs text-fg-muted mt-1">
                      {JSON.stringify(event.attributes, null, 2)}
                    </div>
                  </Copyable>
                {/if}
              </div>
            {/each}
          </div>
        </ExpandableSection>
      {/if}

      <!-- Status message -->
      {#if span.status.message}
        <div class="text-xs text-fg-muted">
          <span class="font-medium">Status message:</span>
          {span.status.message}
        </div>
      {/if}
    </div>
  {/if}
</div>
