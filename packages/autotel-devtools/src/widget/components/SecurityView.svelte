<script lang="ts">
  // Security lens — spans carrying the security.* schema from autotel-audit
  import { ShieldAlert, Hash, ExternalLink, Radar } from '@lucide/svelte';
  import {
    tracesSignal,
    setSelectedTrace,
    setSelectedTab,
  } from '../store.svelte';
  import { formatTimestamp } from '../utils';
  import {
    collectSecuritySpans,
    countBySeverity,
    severityAtLeast,
    severityBadgeClass,
    type SecuritySeverity,
    type SecuritySpanInfo,
  } from '../utils/security';

  let minSeverity = $state<SecuritySeverity>('info');

  const allInfos = $derived(collectSecuritySpans(tracesSignal.value));
  const severityCounts = $derived(countBySeverity(allInfos));
  const infos = $derived(
    allInfos.filter((info) => severityAtLeast(info, minSeverity)),
  );

  function viewTrace(traceId: string, spanId: string) {
    setSelectedTrace(traceId, spanId);
    setSelectedTab('traces');
  }

  function title(info: SecuritySpanInfo): string {
    if (info.event) return info.event;
    return info.signal ? `probe: ${info.signal}` : 'suspicious request';
  }
</script>

<div class="flex flex-col h-full p-4">
  <!-- Header -->
  <div class="flex items-center justify-between mb-4 pb-3 border-b border-line">
    <h3 class="text-sm font-semibold flex items-center gap-2 text-fg">
      <ShieldAlert size={16} class="text-red-500" />
      Security
      {#if allInfos.length > 0}
        <span
          class="ml-1 px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full"
        >
          {allInfos.length}
        </span>
      {/if}
    </h3>
    <select
      class="text-xs border border-line rounded px-2 py-1 bg-surface text-fg-muted"
      value={minSeverity}
      onchange={(e) =>
        (minSeverity = (e.target as HTMLSelectElement)
          .value as SecuritySeverity)}
    >
      <option value="info">All severities</option>
      <option value="warning">Warning+</option>
      <option value="error">Error+</option>
      <option value="critical">Critical only</option>
    </select>
  </div>

  <!-- Severity stats -->
  {#if allInfos.length > 0}
    <div class="flex gap-4 mb-4 p-3 bg-subtle rounded-md border border-line">
      <div class="text-sm">
        <span class="text-fg-muted">Critical:</span>
        <span class="font-semibold text-red-600">
          {severityCounts.critical}
        </span>
      </div>
      <div class="text-sm">
        <span class="text-fg-muted">Error:</span>
        <span class="font-semibold text-orange-600">
          {severityCounts.error}
        </span>
      </div>
      <div class="text-sm">
        <span class="text-fg-muted">Warning:</span>
        <span class="font-semibold text-amber-600">
          {severityCounts.warning}
        </span>
      </div>
      <div class="text-sm">
        <span class="text-fg-muted">Info:</span>
        <span class="font-semibold text-fg">{severityCounts.info}</span>
      </div>
    </div>
  {/if}

  <!-- Security span list -->
  <div class="flex-1 overflow-auto space-y-2">
    {#if infos.length === 0}
      <div
        class="flex flex-col items-center justify-center h-full text-fg-subtle py-12"
      >
        <ShieldAlert size={32} class="mb-2 text-fg-subtle" />
        <p class="text-sm">No security events captured</p>
        <p class="text-xs text-fg-subtle mt-1">
          Spans with security.* attributes (autotel-audit) will appear here
        </p>
      </div>
    {:else}
      {#each infos as info (info.traceId + info.spanId)}
        <div class="border border-line rounded-md bg-surface p-3">
          <div class="flex items-center gap-2 mb-1">
            {#if info.suspicious}
              <Radar size={14} class="text-amber-500" />
            {/if}
            <span class="text-sm font-semibold text-fg">{title(info)}</span>
            <span
              class={'px-1.5 py-0.5 text-xs font-medium rounded ' +
                severityBadgeClass(info.severity)}
            >
              {info.severity}
            </span>
            {#if info.category}
              <span
                class="px-1.5 py-0.5 text-xs font-medium bg-hover text-fg-muted rounded"
              >
                {info.category}
              </span>
            {/if}
            {#if info.outcome}
              <span
                class="px-1.5 py-0.5 text-xs font-medium bg-hover text-fg-muted rounded"
              >
                {info.outcome}
              </span>
            {/if}
            {#if info.service}
              <span
                class="px-1.5 py-0.5 text-xs font-medium bg-hover text-fg-muted rounded"
              >
                {info.service}
              </span>
            {/if}
          </div>

          <p class="text-xs text-fg-muted truncate mb-2 font-mono">
            {info.spanName}
            {#if info.reason}
              <span class="text-fg-subtle">— {info.reason}</span>
            {/if}
          </p>

          <div class="flex items-center gap-4 text-xs text-fg-subtle">
            <span>{formatTimestamp(info.timestamp)}</span>
            <button
              onclick={() => viewTrace(info.traceId, info.spanId)}
              class="flex items-center gap-1 text-fg-muted hover:text-fg font-mono"
            >
              <Hash size={10} />
              {info.traceId.slice(0, 16)}...
              <ExternalLink size={10} />
            </button>
          </div>
        </div>
      {/each}
    {/if}
  </div>
</div>
