<script lang="ts">
  import { X, Upload, AlertTriangle } from '@lucide/svelte';

  interface ImportResult {
    imported: number;
    errors: string[];
    warnings: string[];
  }

  interface Props {
    onclose: () => void;
    onimport: (file: File) => Promise<ImportResult>;
  }
  let { onclose, onimport }: Props = $props();

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  let file = $state<File | null>(null);
  let importing = $state(false);
  let result = $state<ImportResult | null>(null);
  let error = $state<string | null>(null);
  let modalEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onclose();
      }
    };
    window.addEventListener('keydown', handleKeydown);
    modalEl?.focus();
    return () => window.removeEventListener('keydown', handleKeydown);
  });

  const handleFileChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (f) {
      file = f;
      error = null;
      result = null;
    }
  };

  const handleImport = async () => {
    if (!file) return;
    importing = true;
    error = null;
    try {
      const res = await onimport(file);
      result = res;
      if (res.errors.length > 0) error = res.errors.join('; ');
      if (res.imported > 0 && res.errors.length === 0) {
        // Success — close after short delay
        setTimeout(onclose, 1500);
      }
    } catch (err) {
      error = String(err);
    } finally {
      importing = false;
    }
  };
</script>

<div
  class="fixed inset-0 z-[1100] flex items-center justify-center"
  role="dialog"
  aria-modal="true"
  aria-label="Import traces"
>
  <!-- Backdrop — a real <button> so it's natively click + keyboard dismissable. -->
  <button
    type="button"
    aria-label="Close"
    class="absolute inset-0 bg-black/55 backdrop-blur-[2px] at-backdrop-in"
    onclick={onclose}
  ></button>
  <div
    bind:this={modalEl}
    tabindex="-1"
    class="at-modal-in relative z-[1] w-[min(560px,92vw)] max-h-[85vh] overflow-hidden flex flex-col bg-surface rounded-lg shadow-xl border border-line outline-none"
  >
    <!-- Header -->
    <div
      class="flex items-center justify-between px-4 py-3 border-b border-line bg-subtle flex-shrink-0"
    >
      <span class="text-sm font-semibold text-fg"> Import Traces </span>
      <button
        onclick={onclose}
        class="inline-flex items-center justify-center w-7 h-7 bg-transparent border border-line rounded text-sm text-fg-subtle hover:bg-red-50 hover:border-red-300 hover:text-red-600 transition-colors"
        title="Close (Esc)"
      >
        <X size={14} />
      </button>
    </div>

    <!-- Body -->
    <div class="overflow-y-auto p-4 flex flex-col gap-3">
      <label class="flex flex-col gap-2 text-sm text-fg-muted">
        <span class="font-semibold text-fg">JSON file</span>
        <span
          class="inline-flex items-center px-3 py-1.5 border border-line rounded text-sm text-fg-muted bg-surface hover:bg-subtle cursor-pointer w-fit transition-colors"
        >
          <Upload size={14} class="mr-1.5" />
          Choose file
        </span>
        <input
          type="file"
          accept=".json,application/json"
          onchange={handleFileChange}
          class="hidden"
        />
      </label>

      {#if file}
        <div class="border border-line rounded-lg p-3 bg-subtle">
          <div class="font-semibold text-fg">{file.name}</div>
          <div class="text-xs text-fg-subtle mt-0.5">
            {formatBytes(file.size)}
          </div>
        </div>
      {/if}

      {#if error}
        <div
          class="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700 flex items-start gap-2"
        >
          <AlertTriangle size={14} class="flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      {/if}

      {#if result && result.warnings.length > 0}
        <div
          class="p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-700"
        >
          {#each result.warnings as w, i (i)}
            <p class="mb-1 last:mb-0">
              {w}
            </p>
          {/each}
        </div>
      {/if}

      {#if result && result.imported > 0}
        <div
          class="p-3 bg-green-50 border border-green-200 rounded-md text-sm text-green-700"
        >
          Successfully imported {result.imported} trace{result.imported !== 1
            ? 's'
            : ''}.
        </div>
      {/if}
    </div>

    <!-- Footer -->
    <div
      class="flex items-center justify-end gap-3 px-4 py-3 border-t border-line bg-subtle flex-shrink-0"
    >
      <button
        onclick={onclose}
        disabled={importing}
        class="px-3 py-1.5 text-sm border border-line rounded bg-surface text-fg-muted hover:bg-subtle disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        Cancel
      </button>
      <button
        onclick={handleImport}
        disabled={!file || importing}
        class="px-4 py-1.5 text-sm rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {importing ? 'Importing...' : 'Confirm Import'}
      </button>
    </div>
  </div>
</div>
