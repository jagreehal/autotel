<script lang="ts" module>
  import { cn } from '../utils/cn';
  import { tryParseJsonContainer } from '../utils/json';

  const SENSITIVE_RE = /(password|secret|token|authorization|api[-_.]?key)/i;
  const RESOURCE_PREFIXES = [
    'service.',
    'deployment.',
    'host.',
    'container.',
    'process.',
  ];

  /** Type label + badge color class for an attribute value. */
  function valueTypeInfo(v: unknown): { label: string; cls: string } {
    if (v === null || v === undefined)
      return { label: 'null', cls: 'bg-hover text-fg-subtle border-line' };
    if (Array.isArray(v))
      return {
        label: 'array',
        cls: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
      };
    if (typeof v === 'string')
      return {
        label: 'string',
        cls: 'bg-green-500/15 text-green-600 border-green-500/30',
      };
    if (typeof v === 'number')
      return {
        label: 'number',
        cls: 'bg-blue-500/15 text-blue-600 border-blue-500/30',
      };
    if (typeof v === 'boolean')
      return {
        label: 'boolean',
        cls: 'bg-purple-500/15 text-purple-600 border-purple-500/30',
      };
    return {
      label: 'object',
      cls: 'bg-stone-500/15 text-stone-600 border-stone-500/30',
    };
  }

  const BADGE =
    'text-[9px] px-1.5 py-px rounded border font-mono flex-shrink-0';
  const RESOURCE_BADGE = `${BADGE} bg-hover text-fg-subtle border-line`;
</script>

<script lang="ts">
  import {
    X,
    ChevronDown,
    Clock,
    Tag,
    AlertCircle,
    Info,
    Layers,
    FileText,
    Maximize2,
    Link2,
    Code2,
    Database,
    ExternalLink,
  } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  import { formatDuration } from '../utils';
  import Copyable from './Copyable.svelte';
  import SearchInput from './SearchInput.svelte';
  import { matchesNeedle } from '../utils/textMatch';
  import JsonTree from './JsonTree.svelte';
  import IdRow from './IdRow.svelte';
  import type { SpanData, TraceData } from '../types';
  import { inferResourceName, inferResourceType } from '../utils/resources';
  import { computeSelfTime } from '../utils/spanAnalysis';
  import {
    logsSignal,
    editorSchemeSignal,
    setEditorScheme,
    setSelectedTrace,
    openSpanInWaterfall,
    type EditorSchemeValue,
  } from '../store.svelte';
  import { buildCodeLocation } from '../utils/codeLocation';
  import { extractDbInfo, highlightSql } from '../utils/dbInfo';

  const EDITOR_OPTIONS: { value: EditorSchemeValue; label: string }[] = [
    { value: 'vscode', label: 'VS Code' },
    { value: 'cursor', label: 'Cursor' },
    { value: 'webstorm', label: 'WebStorm' },
  ];

  interface Props {
    span: SpanData;
    trace: TraceData;
    onClose: () => void;
  }
  let { span, trace, onClose }: Props = $props();

  let expandedSections = $state<Record<string, boolean>>({
    timing: true,
    attributes: true,
    events: false,
    links: false,
  });
  let fullscreenValue = $state<{ key: string; value: string } | null>(null);

  const toggleSection = (section: string) => {
    expandedSections = {
      ...expandedSections,
      [section]: !expandedSections[section],
    };
  };

  const isError = $derived(span.status.code === 'ERROR');
  const hasAttributes = $derived(Object.keys(span.attributes || {}).length > 0);
  const hasEvents = $derived(span.events && span.events.length > 0);
  const hasLinks = $derived(span.links && span.links.length > 0);
  const resourceName = $derived(inferResourceName(span, trace.service));
  const resourceType = $derived(
    inferResourceType(span.attributes, resourceName),
  );
  const resourceAttributes = $derived(
    Object.entries(span.attributes || {}).filter(
      ([key]) =>
        key.startsWith('service.') ||
        key.startsWith('deployment.') ||
        key.startsWith('host.') ||
        key.startsWith('container.') ||
        key.startsWith('process.'),
    ),
  );
  const sortedAttributes = $derived(
    Object.entries(span.attributes || {}).sort(([a], [b]) =>
      a.localeCompare(b),
    ),
  );

  // Attribute filter: case-insensitive substring match across key OR value.
  let attrQuery = $state('');
  const filteredAttributes = $derived.by(() => {
    const needle = attrQuery.trim().toLowerCase();
    if (!needle) return sortedAttributes;
    return sortedAttributes.filter(([key, value]) =>
      matchesNeedle(needle, [key, value]),
    );
  });
  const isAttrFiltered = $derived(attrQuery.trim().length > 0);

  // Code location → clickable editor deep-link (feature: code location linking)
  const codeLocation = $derived(
    buildCodeLocation(span.attributes || {}, editorSchemeSignal.value),
  );

  // Database query inspection
  const dbInfo = $derived(extractDbInfo(span.attributes || {}));
  const sqlTokens = $derived(
    dbInfo?.statement ? highlightSql(dbInfo.statement) : [],
  );

  // Calculate timing relative to trace
  const selfTime = $derived(
    computeSelfTime(
      span,
      trace.spans.filter((s) => s.parentSpanId === span.spanId),
    ),
  );
  const relativeStart = $derived(span.startTime - trace.startTime);
  const relativeEnd = $derived(span.endTime - trace.startTime);

  // Find parent span name
  const parentSpan = $derived(
    trace.spans.find((s) => s.spanId === span.parentSpanId),
  );

  // Find child spans
  const childSpans = $derived(
    trace.spans.filter((s) => s.parentSpanId === span.spanId),
  );

  // Root span of this trace (for the "Trace ID" jump-to-top link).
  const rootSpan = $derived(trace.spans.find((s) => !s.parentSpanId));

  // Navigate the open trace detail to another span in the same trace. Writing
  // the store signal re-selects the span live — TraceDetailView derives its
  // selected span from `selectedSpanIdSignal` (no tab switch, no panel resize).
  const navigateToSpan = (spanId: string) => setSelectedTrace(trace.traceId, spanId);

  // Correlated logs
  const logs = $derived(logsSignal.value);
  const correlatedLogs = $derived(
    logs.filter((l) => l.traceId === trace.traceId),
  );
</script>

{#snippet attributeRow(
  attrKey: string,
  value: unknown,
  onFullscreen: (v: { key: string; value: string }) => void,
)}
  {@const isSensitive = SENSITIVE_RE.test(attrKey)}
  {@const isResource = RESOURCE_PREFIXES.some((p) => attrKey.startsWith(p))}
  {@const json = isSensitive ? null : tryParseJsonContainer(value)}
  {#if json !== null}
    <div class="py-1 border-b border-line-subtle last:border-b-0">
      <div class="flex items-center gap-2">
        <span class="text-fg-subtle font-medium">{attrKey}</span>
        <span
          class={cn(BADGE, 'bg-amber-500/15 text-amber-600 border-amber-500/30')}
        >
          json
        </span>
        {#if isResource}
          <span class={RESOURCE_BADGE}>resource</span>
        {/if}
      </div>
      <div class="mt-1">
        <JsonTree data={json} />
      </div>
    </div>
  {:else}
    {@const typeInfo = valueTypeInfo(value)}
    {@const text = String(value)}
    <!-- Key + badges on one line; value on its own full-width line below. This
         guarantees the value always has the panel's full width to wrap into —
         the old single-row flex layout let long keys starve the value column
         until it broke one character per line. -->
    <div class="group py-1 border-b border-line-subtle last:border-b-0">
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-fg-subtle font-medium truncate" title={attrKey}>
          {attrKey}
        </span>
        <span class={cn(BADGE, typeInfo.cls)}>
          {isSensitive ? 'sensitive' : typeInfo.label}
        </span>
        {#if isResource && !isSensitive}
          <span class={RESOURCE_BADGE}>resource</span>
        {/if}
        {#if !isSensitive && text.length > 60}
          <button
            onclick={() => onFullscreen({ key: attrKey, value: text })}
            class="ml-auto p-0.5 hover:bg-hover rounded flex-shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
            title="View full value"
          >
            <Maximize2 size={10} class="text-fg-subtle" />
          </button>
        {/if}
      </div>
      <div class="mt-0.5 text-fg leading-snug at-wrap-anywhere">
        {isSensitive ? '[redacted]' : text}
      </div>
    </div>
  {/if}
{/snippet}

{#snippet collapsibleSection(
  title: string,
  icon: Snippet,
  expanded: boolean,
  onToggle: () => void,
  body: Snippet,
)}
  <div class="border-b border-line-subtle">
    <button
      onclick={onToggle}
      class="w-full flex items-center gap-2 px-4 py-3 hover:bg-subtle transition-colors"
    >
      <span class="text-fg-subtle">{@render icon()}</span>
      <span class="text-xs font-medium text-fg-muted flex-1 text-left">
        {title}
      </span>
      <ChevronDown
        size={14}
        class={cn(
          'text-fg-subtle transition-transform',
          expanded && 'rotate-180',
        )}
      />
    </button>
    {#if expanded}
      <div class="px-4 pb-3">{@render body()}</div>
    {/if}
  </div>
{/snippet}

{#snippet timingItem(label: string, value: string, title?: string)}
  <div {title}>
    <div class="text-fg-subtle mb-0.5">{label}</div>
    <div class="font-mono font-medium text-fg">{value}</div>
  </div>
{/snippet}

<div class="flex flex-col h-full bg-surface border-l border-line">
  <!-- Header -->
  <div
    class="flex items-start justify-between gap-3 px-4 py-3 border-b border-line bg-subtle"
  >
    <div class="flex-1 min-w-0">
      <h3 class="font-semibold text-sm text-fg truncate mb-1">
        {span.name || 'Unknown Span'}
      </h3>
      <div class="flex items-center gap-2 flex-wrap">
        <span
          class={cn(
            'px-2 py-0.5 rounded text-xs font-medium',
            isError
              ? 'bg-danger-bg text-danger'
              : span.status.code === 'OK'
                ? 'bg-success-bg text-success'
                : 'bg-hover text-fg-muted',
          )}
        >
          {span.status.code}
        </span>
        <span
          class="px-2 py-0.5 rounded bg-hover text-fg-muted text-xs font-medium"
        >
          {span.kind}
        </span>
        {#if span.scope?.name}
          <span
            class="px-2 py-0.5 rounded bg-hover text-fg-subtle text-xs font-mono"
            title="Instrumentation scope"
          >
            {span.scope.name}
            {span.scope.version ? `@${span.scope.version}` : ''}
          </span>
        {/if}
      </div>
    </div>
    <button
      onclick={onClose}
      class="p-1.5 hover:bg-hover rounded-md transition-colors flex-shrink-0"
      title="Close"
    >
      <X size={16} class="text-fg-subtle" />
    </button>
  </div>

  <!-- Content -->
  <div class="flex-1 overflow-auto">
    <!-- Error message if present -->
    {#if span.status.message}
      <div
        class="mx-4 mt-4 p-3 bg-danger-bg border border-danger-border rounded-md"
      >
        <div class="flex items-start gap-2">
          <AlertCircle size={14} class="text-danger flex-shrink-0 mt-0.5" />
          <div class="text-xs text-danger">
            <span class="font-medium">Error: </span>
            {span.status.message}
          </div>
        </div>
      </div>
    {/if}

    <!-- Timing section -->
    {#snippet timingIcon()}
      <Clock size={14} />
    {/snippet}
    {#snippet timingBody()}
      <div class="grid grid-cols-2 gap-3 text-xs">
        {@render timingItem('Duration', formatDuration(span.duration))}
        {@render timingItem(
          'Self time',
          formatDuration(selfTime),
          'Time in this span excluding its children',
        )}
        {@render timingItem('Start (relative)', formatDuration(relativeStart))}
        {@render timingItem('End (relative)', formatDuration(relativeEnd))}
        {@render timingItem(
          'Start Time',
          new Date(span.startTime).toLocaleTimeString(),
        )}
      </div>
    {/snippet}
    {@render collapsibleSection(
      'Timing',
      timingIcon,
      expandedSections.timing,
      () => toggleSection('timing'),
      timingBody,
    )}

    <!-- IDs section -->
    <div class="px-4 py-3 border-b border-line-subtle">
      <div class="space-y-2 text-xs">
        <IdRow label="Span ID" value={span.spanId} />
        <IdRow
          label="Trace ID"
          value={span.traceId}
          onActivate={rootSpan && rootSpan.spanId !== span.spanId
            ? () => navigateToSpan(rootSpan.spanId)
            : undefined}
          activateTitle="Go to root span"
        />
        {#if span.parentSpanId}
          <IdRow
            label="Parent Span ID"
            value={span.parentSpanId}
            onActivate={parentSpan
              ? () => navigateToSpan(span.parentSpanId!)
              : undefined}
            activateTitle={parentSpan
              ? 'Go to parent span'
              : 'Parent span not captured in this trace'}
          />
        {/if}
      </div>
    </div>

    <div class="px-4 py-3 border-b border-line-subtle">
      <div class="flex items-center gap-2 mb-2">
        <Tag size={14} class="text-fg-subtle" />
        <span class="text-xs font-medium text-fg-muted">Resource</span>
      </div>
      <div class="grid grid-cols-2 gap-3 text-xs">
        {@render timingItem('Trace Service', trace.service)}
        {@render timingItem('Derived Resource', resourceName)}
        {@render timingItem('Resource Type', resourceType)}
        {@render timingItem(
          'Resource Attrs',
          String(resourceAttributes.length),
        )}
      </div>
    </div>

    <!-- Code location (clickable editor deep-link) -->
    {#if codeLocation}
      <div class="px-4 py-3 border-b border-line-subtle">
        <div class="flex items-center gap-2 mb-2">
          <Code2 size={14} class="text-fg-subtle" />
          <span class="text-xs font-medium text-fg-muted flex-1">
            Code Location
          </span>
          <select
            value={editorSchemeSignal.value}
            onchange={(e) =>
              setEditorScheme(e.currentTarget.value as EditorSchemeValue)}
            class="text-[10px] bg-subtle border border-line rounded px-1 py-0.5 text-fg-muted"
            title="Editor to open source files in"
          >
            {#each EDITOR_OPTIONS as opt (opt.value)}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </div>
        <a
          href={codeLocation.href}
          class="group flex items-center gap-2 text-xs font-mono text-accent hover:underline break-all"
          title={`Open ${codeLocation.filepath}${codeLocation.line ? `:${codeLocation.line}` : ''}`}
        >
          <ExternalLink size={12} class="flex-shrink-0" />
          <span class="break-all">{codeLocation.display}</span>
        </a>
        {#if codeLocation.functionName}
          <div class="mt-1 text-[11px] text-fg-subtle font-mono">
            {codeLocation.namespace
              ? `${codeLocation.namespace}.`
              : ''}{codeLocation.functionName}()
          </div>
        {/if}
        <div class="mt-1 text-[10px] text-fg-subtle break-all">
          {codeLocation.filepath}
        </div>
      </div>
    {/if}

    <!-- Database query inspection -->
    {#if dbInfo}
      <div class="px-4 py-3 border-b border-line-subtle">
        <div class="flex items-center gap-2 mb-2">
          <Database size={14} class="text-fg-subtle" />
          <span class="text-xs font-medium text-fg-muted flex-1">Database</span>
          {#if dbInfo.system}
            <span
              class="text-[10px] px-1.5 py-px rounded border font-mono bg-indigo-500/15 text-indigo-600 border-indigo-500/30"
            >
              {dbInfo.system}
            </span>
          {/if}
        </div>

        {#if dbInfo.operation || dbInfo.table || dbInfo.dbName || dbInfo.rowCount !== undefined}
          <div class="grid grid-cols-2 gap-2 text-xs mb-2">
            {#if dbInfo.operation}
              {@render timingItem('Operation', dbInfo.operation)}
            {/if}
            {#if dbInfo.table}
              {@render timingItem('Table', dbInfo.table)}
            {/if}
            {#if dbInfo.dbName}
              {@render timingItem('Database', dbInfo.dbName)}
            {/if}
            {#if dbInfo.rowCount !== undefined}
              {@render timingItem('Rows', String(dbInfo.rowCount))}
            {/if}
          </div>
        {/if}

        {#if dbInfo.statement}
          <Copyable content={dbInfo.statement}>
            <pre
              class="bg-subtle rounded p-2.5 border border-line font-mono text-[11px] text-fg whitespace-pre-wrap break-all overflow-auto max-h-[240px]">{#each sqlTokens as token, i (i)}<span
                  class={token.kind === 'keyword'
                    ? 'text-indigo-500 font-semibold'
                    : token.kind === 'string'
                      ? 'text-green-500'
                      : ''}>{token.text}</span>{/each}</pre>
          </Copyable>
        {/if}
      </div>
    {/if}

    <!-- Relationships -->
    {#if parentSpan || childSpans.length > 0}
      <div class="px-4 py-3 border-b border-line-subtle">
        <div class="flex items-center gap-2 mb-2">
          <Layers size={14} class="text-fg-subtle" />
          <span class="text-xs font-medium text-fg-muted"> Relationships </span>
        </div>
        <div class="space-y-2 text-xs">
          {#if parentSpan}
            <div class="flex items-center gap-2">
              <span class="text-fg-subtle">Parent:</span>
              <span class="font-medium text-fg">
                {parentSpan.name}
              </span>
            </div>
          {/if}
          {#if childSpans.length > 0}
            <div>
              <span class="text-fg-subtle">
                Children ({childSpans.length}):
              </span>
              <div class="mt-1 space-y-1 pl-2">
                {#each childSpans.slice(0, 5) as child (child.spanId)}
                  <div class="text-fg-muted truncate">
                    {child.name}
                  </div>
                {/each}
                {#if childSpans.length > 5}
                  <div class="text-fg-subtle">
                    +{childSpans.length - 5} more
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Attributes section -->
    {#if hasAttributes}
      {#snippet attributesIcon()}
        <Tag size={14} />
      {/snippet}
      {#snippet attributesBody()}
        <SearchInput
          bind:value={attrQuery}
          class="mb-2"
          inputClass="border-line bg-subtle text-fg focus:border-line focus-visible:ring-1 focus-visible:ring-accent"
          placeholder="Filter attributes by key or value…"
          ariaLabel="Filter attributes by key or value"
        />
        <Copyable content={JSON.stringify(span.attributes, null, 2)}>
          <div
            class="bg-subtle rounded p-3 border border-line font-mono text-xs h-[300px] min-h-[120px] overflow-auto resize-y"
            title="Drag bottom edge to resize"
          >
            {#if filteredAttributes.length === 0}
              <div class="text-fg-subtle py-2 text-center">No matches</div>
            {:else}
              {#each filteredAttributes as [key, value] (key)}
                {@render attributeRow(key, value, (v) => (fullscreenValue = v))}
              {/each}
            {/if}
          </div>
        </Copyable>
      {/snippet}
      {@render collapsibleSection(
        isAttrFiltered
          ? `Attributes (${filteredAttributes.length} of ${Object.keys(span.attributes).length})`
          : `Attributes (${Object.keys(span.attributes).length})`,
        attributesIcon,
        expandedSections.attributes,
        () => toggleSection('attributes'),
        attributesBody,
      )}
    {/if}

    <!-- Events section -->
    {#if hasEvents}
      {#snippet eventsIcon()}
        <Info size={14} />
      {/snippet}
      {#snippet eventsBody()}
        <div class="space-y-2">
          {#each span.events! as event, idx (idx)}
            <div class="bg-subtle rounded p-2.5 border border-line">
              <div class="flex items-center justify-between mb-1">
                <span class="font-medium text-xs text-fg">
                  {event.name}
                </span>
                <span class="text-[10px] text-fg-subtle">
                  +{formatDuration(event.timestamp - span.startTime)}
                </span>
              </div>
              {#if event.attributes && Object.keys(event.attributes).length > 0}
                <Copyable content={JSON.stringify(event.attributes, null, 2)}>
                  <div class="font-mono text-[11px] text-fg-muted mt-1">
                    <pre
                      class="whitespace-pre-wrap break-words">{JSON.stringify(
                        event.attributes,
                        null,
                        2,
                      )}</pre>
                  </div>
                </Copyable>
              {/if}
            </div>
          {/each}
        </div>
      {/snippet}
      {@render collapsibleSection(
        `Events (${span.events!.length})`,
        eventsIcon,
        expandedSections.events,
        () => toggleSection('events'),
        eventsBody,
      )}
    {/if}

    <!-- Links section -->
    {#if hasLinks}
      {#snippet linksIcon()}
        <Link2 size={14} />
      {/snippet}
      {#snippet linksBody()}
        <div class="space-y-1.5">
          {#each span.links! as link, idx (idx)}
            <div class="bg-subtle rounded p-2.5 border border-line">
              <div class="flex items-center gap-2 text-xs mb-1">
                <span class="text-fg-subtle">Trace:</span>
                <button
                  type="button"
                  onclick={() => openSpanInWaterfall(link.traceId, link.spanId)}
                  title="Open linked span in the Traces waterfall"
                  class="font-mono text-accent hover:underline text-[11px] truncate text-left cursor-pointer"
                >
                  {link.traceId}
                </button>
                <Copyable content={link.traceId}>
                  <span></span>
                </Copyable>
              </div>
              <div class="flex items-center gap-2 text-xs">
                <span class="text-fg-subtle">Span:</span>
                <button
                  type="button"
                  onclick={() => openSpanInWaterfall(link.traceId, link.spanId)}
                  title="Open linked span in the Traces waterfall"
                  class="font-mono text-accent hover:underline text-[11px] truncate text-left cursor-pointer"
                >
                  {link.spanId}
                </button>
                <Copyable content={link.spanId}>
                  <span></span>
                </Copyable>
              </div>
              {#if link.attributes && Object.keys(link.attributes).length > 0}
                <div class="mt-1.5 pt-1.5 border-t border-line">
                  <div class="font-mono text-[10px] text-fg-subtle">
                    {Object.entries(link.attributes)
                      .map(
                        ([k, v]) =>
                          `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`,
                      )
                      .join(', ')}
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/snippet}
      {@render collapsibleSection(
        `Links (${span.links!.length})`,
        linksIcon,
        expandedSections.links,
        () => toggleSection('links'),
        linksBody,
      )}
    {/if}

    <!-- Correlated logs section -->
    {#if correlatedLogs.length > 0}
      <div class="border-b border-line-subtle">
        <div class="flex items-center gap-2 px-4 py-3">
          <FileText size={14} class="text-fg-subtle" />
          <span class="text-xs font-medium text-fg-muted">
            Correlated Logs ({correlatedLogs.length})
          </span>
        </div>
        <div class="px-4 pb-3">
          <div class="space-y-1.5 max-h-[200px] overflow-auto">
            {#each correlatedLogs.slice(0, 50) as log, idx (log.id || idx)}
              {@const isMatch = log.spanId === span.spanId}
              {@const sev = log.severityText || 'INFO'}
              {@const sevColor =
                sev === 'ERROR'
                  ? 'text-danger'
                  : sev === 'WARN'
                    ? 'text-warning'
                    : 'text-fg-subtle'}
              {@const body =
                typeof log.body === 'string'
                  ? log.body
                  : JSON.stringify(log.body)}
              <div
                class={cn(
                  'text-xs p-2 rounded border',
                  isMatch
                    ? 'border-accent/30 bg-accent/10'
                    : 'border-line-subtle bg-subtle',
                )}
              >
                <div class="flex items-center gap-2 mb-0.5">
                  <span class={cn('font-mono font-medium', sevColor)}>
                    {sev}
                  </span>
                  {#if isMatch}
                    <span class="text-[10px] text-accent font-medium">
                      this span
                    </span>
                  {/if}
                  <span class="text-fg-subtle text-[10px] ml-auto">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div class="text-fg-muted break-all line-clamp-2">
                  {body}
                </div>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </div>

  <!-- Fullscreen value viewer -->
  {#if fullscreenValue}
    <div
      class="fixed inset-0 z-[1200] flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Full value for ${fullscreenValue.key}`}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="absolute inset-0 bg-black/60 backdrop-blur-[2px] at-backdrop-in"
        onclick={() => (fullscreenValue = null)}
      ></div>
      <div
        class="at-modal-in relative z-[1] w-[min(700px,92vw)] max-h-[85vh] flex flex-col bg-surface rounded-lg shadow-xl border border-line overflow-hidden"
      >
        <div
          class="flex items-center justify-between px-4 py-2.5 border-b border-line bg-subtle flex-shrink-0"
        >
          <span class="text-sm font-mono font-semibold text-fg-muted truncate">
            {fullscreenValue.key}
          </span>
          <button
            onclick={() => (fullscreenValue = null)}
            class="p-1 hover:bg-hover rounded transition-colors"
            title="Close (Esc)"
          >
            <X size={16} class="text-fg-subtle" />
          </button>
        </div>
        <div class="overflow-auto p-4">
          <pre
            class="font-mono text-xs text-fg whitespace-pre-wrap break-all">{fullscreenValue.value}</pre>
        </div>
      </div>
    </div>
  {/if}
</div>
