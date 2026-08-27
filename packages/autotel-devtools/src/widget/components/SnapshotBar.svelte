<script lang="ts">
  import { Camera, Trash2, Upload, X } from '@lucide/svelte';
  import {
    tracesSignal,
    logsSignal,
    errorGroupsSignal,
    snapshotModeSignal,
    loadSnapshot,
    exitSnapshotMode,
    clearAllData,
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

  /**
   * What a snapshot would contain, spelled out.
   *
   * The bar said "Local data" whether the store held two thousand traces or
   * none, which made `Download snapshot` a button you pressed to find out
   * whether there was anything to download.
   */
  const counts = $derived(
    [
      { n: tracesSignal.value.length, one: 'trace', many: 'traces' },
      { n: logsSignal.value.length, one: 'log', many: 'logs' },
      { n: errorGroupsSignal.value.length, one: 'error', many: 'errors' },
    ]
      .filter((part) => part.n > 0)
      .map((part) => `${part.n} ${part.n === 1 ? part.one : part.many}`),
  );
  const isEmpty = $derived(counts.length === 0);

  const onDownload = () => {
    error = null;
    warning = null;
    downloadSnapshotAsJson({
      traces: tracesSignal.value,
      logs: logsSignal.value,
      errors: errorGroupsSignal.value,
    });
  };

  const onPickFile = () => {
    fileInputEl?.click();
  };

  const onClear = () => {
    error = null;
    warning = null;
    clearAllData();
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
    inSnapshot ? 'bg-warning-bg text-warning' : 'bg-subtle text-fg-muted',
  )}
>
  {#if inSnapshot}
    <Camera size={12} />
    <span class="font-medium">Snapshot mode</span>
    <span class="text-warning">— live updates paused.</span>
    <button
      onclick={exitSnapshotMode}
      class="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-warning-bg transition-colors"
      title="Exit snapshot and clear data"
    >
      <X size={12} />
      Exit
    </button>
  {:else}
    <span class="text-fg-subtle">
      {isEmpty ? 'No data captured' : counts.join(' · ')}
    </span>
    <button
      onclick={onDownload}
      disabled={isEmpty}
      class="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
      title={isEmpty
        ? 'Nothing captured yet'
        : 'Download a snapshot of traces, logs, errors and metrics'}
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
    <button
      onclick={onClear}
      class="inline-flex items-center gap-1 px-2 py-0.5 rounded hover:bg-hover hover:text-danger transition-colors"
      title="Clear all captured data — traces, logs, metrics and errors"
    >
      <Trash2 size={12} />
      Clear
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
    <span class="text-danger truncate" title={error}>
      {error}
    </span>
  {/if}
  {#if warning && !error}
    <span class="text-warning truncate" title={warning}>
      {warning}
    </span>
  {/if}
</div>
