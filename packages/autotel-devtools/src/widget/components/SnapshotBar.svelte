<script lang="ts">
  import { Camera, Upload, X } from '@lucide/svelte';
  import {
    tracesSignal,
    logsSignal,
    errorGroupsSignal,
    metricsSignal,
    snapshotModeSignal,
    loadSnapshot,
    exitSnapshotMode,
  } from '../store.svelte';
  import {
    downloadSnapshotAsJson,
    importSnapshotFromFile,
  } from '../export-import';
  import { cn } from '../utils/cn';

  let fileInputEl: HTMLInputElement | undefined = $state();
  let error = $state<string | null>(null);
  let warning = $state<string | null>(null);
  const inSnapshot = $derived(snapshotModeSignal.value);

  const onDownload = () => {
    error = null;
    warning = null;
    downloadSnapshotAsJson({
      traces: tracesSignal.value,
      logs: logsSignal.value,
      errors: errorGroupsSignal.value,
      metrics: metricsSignal.value,
    });
  };

  const onPickFile = () => {
    fileInputEl?.click();
  };

  const onFileChange = async (event: Event) => {
    error = null;
    warning = null;
    const target = event.currentTarget as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    if (!file) return;
    const result = await importSnapshotFromFile(file);
    if (!result.success || !result.snapshot) {
      error = result.errors.join('; ') || 'Failed to load snapshot';
      return;
    }
    if (result.warnings.length > 0) {
      warning = result.warnings.join('; ');
    }
    loadSnapshot(result.snapshot);
  };
</script>

<div
  class={cn(
    'border-b border-line px-3 py-1.5 text-xs flex items-center gap-2',
    inSnapshot ? 'bg-amber-50 text-amber-900' : 'bg-subtle text-fg-muted',
  )}
>
  {#if inSnapshot}
    <Camera size={12} />
    <span class="font-medium">Snapshot mode</span>
    <span class="text-amber-700">— live updates paused.</span>
    <button
      onclick={exitSnapshotMode}
      class="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-amber-100 transition-colors"
      title="Exit snapshot and clear data"
    >
      <X size={12} />
      Exit
    </button>
  {:else}
    <span class="text-fg-subtle">Local data</span>
    <button
      onclick={onDownload}
      class="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-hover transition-colors"
      title="Download a snapshot of traces, logs, errors and metrics"
    >
      <Camera size={12} />
      Download snapshot
    </button>
    <button
      onclick={onPickFile}
      class="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-hover transition-colors"
      title="Load a snapshot file"
    >
      <Upload size={12} />
      Load snapshot
    </button>
  {/if}
  <input
    bind:this={fileInputEl}
    type="file"
    accept="application/json,.json"
    class="hidden"
    onchange={onFileChange}
  />
  {#if error}
    <span class="text-red-600 truncate" title={error}>
      {error}
    </span>
  {/if}
  {#if warning && !error}
    <span class="text-amber-700 truncate" title={warning}>
      {warning}
    </span>
  {/if}
</div>
