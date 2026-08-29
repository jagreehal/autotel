<script lang="ts">
  /**
   * WebMCP tab — the tool surface your page offers an agent.
   *
   * Not a call log: Traces already has one. This answers the questions only
   * this data can answer — which tools the agent can *currently* see, what the
   * browser silently discarded on the way, and what the results cost in the
   * agent's context.
   *
   * The fold runs on the server (`/api/query/webmcp`) so an inventory is never
   * built from one page of results. A partial fold would not fail, it would
   * under-report, and a wrong count here is worse than a missing view.
   */
  import { Wrench, AlertTriangle } from '@lucide/svelte';
  import { connectionUrlSignal, timeWindowSignal } from '../store.svelte';
  import { httpBaseFromWsUrl } from '../source-client';
  import { queryWebMcp } from '../query-client';
  import { resolveWindow, toQueryWindow } from '../timeWindow';
  import { formatNumber, formatTimestamp, redact } from '../utils';
  import type { WebMcpInventory, WebMcpTool } from '../types';

  type ViewState =
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'ok'; inventory: WebMcpInventory }
    | { status: 'error'; message: string };

  let view = $state<ViewState>({ status: 'idle' });
  let expanded = $state<string | null>(null);
  let controller: AbortController | undefined;
  // Payloads exist only with opt-in capture, and opting into capture is not
  // opting into display: the widget mounts in a real page on a screen that gets
  // shared. Masked until asked for, scrubbed either way.
  let reveal = $state(false);

  const key = (tool: WebMcpTool) =>
    `${tool.service}/${tool.installationId}/${tool.name}`;

  async function load(): Promise<void> {
    controller?.abort();
    const request = new AbortController();
    controller = request;
    const wsUrl = connectionUrlSignal.value;
    const base = wsUrl === null ? null : httpBaseFromWsUrl(wsUrl);
    if (base === null) {
      view = {
        status: 'error',
        message: 'The telemetry receiver is not connected.',
      };
      return;
    }
    view = { status: 'loading' };
    const resolved = resolveWindow(timeWindowSignal.value, Date.now());
    const result = await queryWebMcp(
      { window: toQueryWindow(resolved) },
      { fetch, baseUrl: base, signal: request.signal },
    );
    if (request.signal.aborted) return;
    if (result.status === 'ok')
      view = { status: 'ok', inventory: result.webmcp };
    else if (result.status === 'invalid')
      view = { status: 'error', message: 'The server rejected the query.' };
    else if (result.status === 'error')
      view = { status: 'error', message: result.message };
  }

  // Refetch on window change: the window is a request, and this view answers it
  // rather than widening it to find something to show.
  $effect(() => {
    void timeWindowSignal.value;
    void connectionUrlSignal.value;
    void load();
  });

  const inventory = $derived(view.status === 'ok' ? view.inventory : undefined);
  const summary = $derived(inventory?.summary);

  const bytes = (n: number): string =>
    n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} kB`;

  const mask = (text: string): string =>
    reveal ? redact(text) : '•'.repeat(Math.min(text.length, 32));
</script>

<div class="h-full overflow-auto">
  <div class="flex items-center justify-between p-3 border-b border-line">
    <div class="flex items-center gap-2">
      <Wrench size={16} class="text-fg-muted" />
      <h2 class="text-sm font-semibold">WebMCP tools</h2>
    </div>
    <button
      type="button"
      onclick={() => void load()}
      class="flex items-center gap-1 text-xs text-fg-subtle hover:text-fg"
    >
      Refresh
    </button>
  </div>

  {#if view.status === 'loading'}
    <p class="p-4 text-sm text-fg-muted">Loading…</p>
  {:else if view.status === 'error'}
    <p class="p-4 text-sm text-danger">{view.message}</p>
  {:else if inventory && summary && inventory.tools.length > 0}
    <!-- The aggregate strip: the findings, before any browsing. -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3 border-b border-line">
      <div>
        <div class="text-lg font-semibold">{summary.toolsOffered}</div>
        <div class="text-xs text-fg-subtle">offered now</div>
      </div>
      <div>
        <div class="text-lg font-semibold">{formatNumber(summary.calls)}</div>
        <div class="text-xs text-fg-subtle">
          calls{summary.errors > 0 ? `, ${summary.errors} failed` : ''}
        </div>
      </div>
      <div>
        <div
          class="text-lg font-semibold"
          class:text-warning={summary.toolsWithDroppedAnnotations > 0}
        >
          {summary.toolsWithDroppedAnnotations}
        </div>
        <div class="text-xs text-fg-subtle">with dropped annotations</div>
      </div>
      <div>
        <div class="text-lg font-semibold">{bytes(summary.resultBytes)}</div>
        <div class="text-xs text-fg-subtle">
          result bytes{summary.envelopeBytes > 0
            ? ` · ${bytes(summary.envelopeBytes)} envelope`
            : ''}
        </div>
      </div>
    </div>

    {#if summary.emptyInstallations > 0}
      <div
        class="flex items-start gap-2 m-3 p-2 rounded bg-warning-bg text-warning text-xs"
      >
        <AlertTriangle size={14} class="mt-0.5 shrink-0" />
        <span>
          {summary.emptyInstallations} installation{summary.emptyInstallations ===
          1
            ? ''
            : 's'} registered no tools. `instrumentWebMCP()` only sees registrations
          that happen after it runs — call it before registering your tools.
        </span>
      </div>
    {/if}

    <ul class="divide-y divide-line">
      {#each inventory.tools as tool (key(tool))}
        {@const id = key(tool)}
        <li>
          <button
            type="button"
            onclick={() => (expanded = expanded === id ? null : id)}
            class="w-full p-3 flex items-start gap-3 hover:bg-subtle transition-colors text-left"
          >
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1 flex-wrap">
                <span class="text-sm font-mono font-semibold">{tool.name}</span>
                {#if tool.offered}
                  <span
                    class="px-1.5 py-0.5 text-xs font-medium bg-success-bg text-success rounded"
                    >offered</span
                  >
                {:else}
                  <span
                    class="px-1.5 py-0.5 text-xs font-medium bg-hover text-fg-muted rounded"
                    >withdrawn</span
                  >
                {/if}
                {#if tool.annotationsDropped.length > 0}
                  <span
                    class="px-1.5 py-0.5 text-xs font-medium bg-warning-bg text-warning rounded"
                    title="The browser discarded these at registration"
                    >dropped {tool.annotationsDropped.join(', ')}</span
                  >
                {/if}
                {#if tool.envelopeCalls > 0}
                  <span
                    class="px-1.5 py-0.5 text-xs font-medium bg-warning-bg text-warning rounded"
                    title="Chrome does not unwrap the MCP envelope; the agent parses it"
                    >envelope</span
                  >
                {/if}
                {#if tool.substitutedCalls > 0}
                  <span
                    class="px-1.5 py-0.5 text-xs font-medium bg-hover text-fg-muted rounded"
                    title="The browser replaced an empty result with its own text"
                    >substituted</span
                  >
                {/if}
                {#if tool.observedAtRegistration && tool.hasInputSchema === false}
                  <span
                    class="px-1.5 py-0.5 text-xs font-medium bg-warning-bg text-warning rounded"
                    title="The agent was not told what arguments to send"
                    >no schema</span
                  >
                {/if}
                {#if !tool.observedAtRegistration}
                  <span
                    class="px-1.5 py-0.5 text-xs font-medium bg-hover text-fg-subtle rounded"
                    title="Seen executing but never at registration — annotations and schema are unknown"
                    >not observed at registration</span
                  >
                {/if}
              </div>
              <div class="flex items-center gap-4 text-xs text-fg-subtle">
                <span>{formatNumber(tool.calls)} calls</span>
                {#if tool.errors > 0}
                  <span class="text-danger">{tool.errors} failed</span>
                {/if}
                <span>{bytes(tool.medianResultBytes)} median result</span>
                <span>{formatTimestamp(tool.lastSeen)}</span>
              </div>
            </div>
          </button>

          {#if expanded === id}
            <div class="border-t border-line p-3 bg-subtle space-y-3 text-xs">
              <div class="flex flex-wrap gap-4 text-fg-muted">
                <span
                  >service <code class="font-mono">{tool.service}</code></span
                >
                {#if tool.sessionId}
                  <span
                    >session <code class="font-mono">{tool.sessionId}</code
                    ></span
                  >
                {/if}
                <span
                  >installation <code class="font-mono"
                    >{tool.installationId}</code
                  ></span
                >
                {#if tool.descriptionLength !== undefined}
                  <span>{tool.descriptionLength}-char description</span>
                {/if}
              </div>

              {#if tool.envelopeCalls > 0}
                <div class="flex items-start gap-2 text-fg-muted">
                  <span>
                    {tool.envelopeCalls} of {tool.calls} results arrived as an MCP
                    <code class="font-mono">{'{ content: [...] }'}</code>
                    envelope. Chrome hands the agent the wrapper unparsed, so
                    {bytes(tool.resultBytes)} would be about
                    {bytes(Math.max(0, tool.resultBytes - tool.envelopeBytes))}
                    returning the text plainly.
                  </span>
                </div>
              {/if}

              {#if tool.annotationsSent.length > 0}
                <div class="text-fg-muted">
                  annotations sent
                  <code class="font-mono"
                    >{tool.annotationsSent.join(', ')}</code
                  >{#if tool.annotationsDropped.length > 0}, kept
                    <code class="font-mono"
                      >{tool.annotationsSent
                        .filter((a) => !tool.annotationsDropped.includes(a))
                        .join(', ') || 'none'}</code
                    >{/if}
                </div>
              {/if}

              {#if tool.recentCalls.length > 0}
                <div>
                  <div class="flex items-center justify-between mb-1.5">
                    <h5 class="font-semibold text-fg-muted">Recent calls</h5>
                    {#if tool.recentCalls.some((c) => c.input || c.result)}
                      <button
                        type="button"
                        onclick={() => (reveal = !reveal)}
                        class="flex items-center gap-1 text-fg-subtle hover:text-fg"
                      >
                        {reveal ? 'Hide payloads' : 'Reveal payloads'}
                      </button>
                    {/if}
                  </div>
                  <ul class="space-y-1">
                    {#each tool.recentCalls as call (call.spanId)}
                      <li class="font-mono text-[11px] flex flex-wrap gap-2">
                        <span class="text-fg-subtle"
                          >{formatTimestamp(call.timestamp)}</span
                        >
                        <span class:text-danger={call.error}
                          >{call.resultType ?? 'result'} · {bytes(
                            call.resultBytes,
                          )}</span
                        >
                        {#if call.result}
                          <span class="text-fg-muted break-all"
                            >{mask(call.result)}</span
                          >
                        {/if}
                      </li>
                    {/each}
                  </ul>
                </div>
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {:else}
    <!-- Nearly every reader lands here: WebMCP is behind a flag. So the empty
         view is the install doc rather than the word "empty". -->
    <div class="p-6 max-w-xl space-y-3 text-sm">
      <p class="text-fg-muted">No WebMCP tools observed in this window.</p>
      <p class="text-fg-subtle text-xs">
        WebMCP needs Chrome 151+ with
        <code class="font-mono bg-code px-1 rounded"
          >chrome://flags/#web-machine-learning-model-context</code
        >
        enabled. Check with
        <code class="font-mono">'modelContext' in document</code>.
      </p>
      <pre
        class="bg-code text-fg p-2 rounded text-xs overflow-x-auto">npm install autotel-webmcp autotel-web

import {'{ instrumentWebMCP }'} from 'autotel-webmcp';
instrumentWebMCP();   // before you register any tools</pre>
      <p class="text-fg-subtle text-xs">
        Registrations that happen before <code class="font-mono"
          >instrumentWebMCP()</code
        > runs are invisible to it.
      </p>
    </div>
  {/if}
</div>
