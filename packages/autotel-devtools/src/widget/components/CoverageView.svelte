<script lang="ts">
  /**
   * Instrumentation coverage: the entry points that have emitted nothing.
   *
   * Every other view here describes telemetry you already have. This one
   * describes what is missing, which is a question no telemetry backend can
   * answer — it needs the source as well as the spans, and `autotel map`
   * already reads the source.
   *
   * Unseen first, because that is the entire reason to open this tab. Each row
   * links into the editor at the handler, so the gap and the fix are one click
   * apart.
   */
  import { FileWarning, RefreshCw } from '@lucide/svelte';
  import { connectionUrlSignal } from '../store.svelte';
  import { httpBaseFromWsUrl } from '../source-client';

  interface CoverageEntry {
    method: string | null;
    path: string;
    file: string;
    handler?: { line?: number } | null;
    seen: boolean;
    spanCount: number;
  }

  type State =
    | { status: 'idle' }
    | { status: 'loading' }
    | {
        status: 'ok';
        entries: CoverageEntry[];
        seenCount: number;
        total: number;
      }
    | { status: 'missing'; message: string }
    | { status: 'error'; message: string };

  let state = $state<State>({ status: 'idle' });

  async function load(): Promise<void> {
    state = { status: 'loading' };
    try {
      const wsUrl = connectionUrlSignal.value;
      const base = wsUrl === null ? null : httpBaseFromWsUrl(wsUrl);
      if (base === null) {
        state = {
          status: 'error',
          message: 'The telemetry receiver is not connected.',
        };
        return;
      }
      const response = await fetch(`${base}/api/coverage`);
      const body = await response.json();
      if (response.status === 404) {
        state = { status: 'missing', message: body.message ?? 'No map found.' };
      } else if (!response.ok) {
        state = {
          status: 'error',
          message: body.message ?? response.statusText,
        };
      } else {
        state = { status: 'ok', ...body };
      }
    } catch (error) {
      state = {
        status: 'error',
        message: error instanceof Error ? error.message : 'Request failed',
      };
    }
  }

  $effect(() => {
    void load();
  });

  const editorHref = (entry: CoverageEntry) =>
    `vscode://file/${entry.file}${entry.handler?.line ? `:${entry.handler.line}` : ''}`;
</script>

<div class="flex h-full flex-col overflow-hidden">
  <div class="flex items-center justify-between border-b border-line px-4 py-3">
    <div>
      {#if state.status === 'ok'}
        <span class="text-xs text-fg">
          {state.total - state.seenCount} of {state.total} entry points have emitted
          nothing
        </span>
      {:else}
        <span class="text-xs text-fg-muted">Instrumentation coverage</span>
      {/if}
    </div>
    <button
      type="button"
      onclick={load}
      class="flex items-center gap-1 rounded border border-line px-2 py-1 text-xs text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <RefreshCw size={12} /> Refresh
    </button>
  </div>

  <div class="flex-1 overflow-auto px-4 py-3">
    {#if state.status === 'loading' || state.status === 'idle'}
      <p class="text-xs text-fg-subtle">Loading…</p>
    {:else if state.status === 'missing'}
      <div class="flex items-start gap-2 text-xs text-fg-muted">
        <FileWarning size={14} class="mt-0.5 shrink-0" />
        <p>{state.message}</p>
      </div>
    {:else if state.status === 'error'}
      <p class="text-xs text-danger">{state.message}</p>
    {:else if state.entries.length === 0}
      <p class="text-xs text-fg-muted">The map records no entry points.</p>
    {:else}
      <table class="w-full text-left text-xs">
        <thead class="text-[11px] uppercase tracking-wide text-fg-muted">
          <tr>
            <th class="py-1 pr-2 font-medium">Entry point</th>
            <th class="py-1 pr-2 font-medium">Spans</th>
            <th class="py-1 font-medium">Source</th>
          </tr>
        </thead>
        <tbody>
          {#each state.entries as entry (`${entry.method ?? ''} ${entry.path}`)}
            <tr class="border-t border-line-subtle">
              <td class="py-1 pr-2 font-mono">
                {#if !entry.seen}
                  <span
                    class="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-danger"
                    aria-label="never seen"
                  ></span>
                {/if}
                {entry.method ? `${entry.method} ` : ''}{entry.path}
              </td>
              <td
                class={entry.seen
                  ? 'py-1 pr-2 tabular-nums text-fg-muted'
                  : 'py-1 pr-2 text-danger'}
              >
                {entry.seen ? entry.spanCount : 'none'}
              </td>
              <td class="py-1">
                <a
                  href={editorHref(entry)}
                  class="text-fg-subtle hover:text-accent hover:underline"
                >
                  {entry.file}
                </a>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>
