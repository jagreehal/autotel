<script lang="ts">
  /**
   * Agents tab — observe coding agents (Claude Code now; opencode/Codex next)
   * from the OpenTelemetry metrics + log events they emit. Session-centric:
   * a sessions list → per-session timeline + rollup, with an aggregate strip
   * across all sessions. Sessions are reconstructed server-side by the
   * `autotel-agents` reducers; this view just renders.
   */
  import {
    Bot,
    Terminal,
    DollarSign,
    Coins,
    Wrench,
    Server,
    Sparkles,
    GitBranch,
    AlertTriangle,
    MessageSquare,
    Eye,
    EyeOff,
    Check,
    X,
    Plug,
    Blocks,
    Webhook,
  } from '@lucide/svelte';
  import {
    sortedAgentSessionsSignal,
    selectedAgentSessionSignal,
    agentAggregateSignal,
    selectAgentSession,
  } from '../store.svelte';
  import { formatNumber, formatDuration, formatTimestamp } from '../utils';
  import type { AgentEvent, AgentSession } from 'autotel-agents';
  import CopyButton from './CopyButton.svelte';

  const launchCommand = 'npx autotel-devtools claude';

  const sessions = $derived(sortedAgentSessionsSignal.value);
  const selected = $derived(selectedAgentSessionSignal.value);
  const agg = $derived(agentAggregateSignal.value);

  // Privacy: prompts are private by default. When text IS present (opt-in
  // capture), keep it masked until the user reveals it, and scrub obvious
  // secrets either way.
  let reveal = $state(false);
  function redact(text: string): string {
    return text
      .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '«email»')
      .replace(/\b(sk|pk|ghp|xox[baprs])[-_][A-Za-z0-9]{8,}\b/g, '«secret»')
      .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '«token»');
  }

  function cost(usd: number): string {
    if (usd === 0) return '$0';
    return usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`;
  }

  function shortId(id: string): string {
    return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
  }

  function entries(record: Record<string, number>): [string, number][] {
    return Object.entries(record)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
  }

  function eventLabel(e: AgentEvent): string {
    switch (e.type) {
      case 'api_request':
        return e.model ?? 'api request';
      case 'api_error':
        return 'api error';
      case 'tool_result':
      case 'tool_decision':
        return e.tool?.name ?? 'tool';
      case 'user_prompt':
        return 'prompt';
      case 'mcp_connection':
        return e.mcpServerName ?? 'mcp server';
      case 'plugin_loaded':
        return e.pluginName ?? 'plugin';
      case 'hook_execution':
        return e.hookName ?? 'hook';
      default:
        return e.rawEventName;
    }
  }

  function eventDetail(e: AgentEvent): string {
    const parts: string[] = [];
    if (e.type === 'api_request') {
      if (e.costUsd !== undefined) parts.push(cost(e.costUsd));
      const tok = (e.inputTokens ?? 0) + (e.outputTokens ?? 0);
      if (tok > 0) parts.push(`${formatNumber(tok)} tok`);
      if (e.durationMs) parts.push(formatDuration(e.durationMs));
    } else if (e.type === 'tool_result') {
      if (e.tool?.isMcp && e.tool.mcpServer) parts.push(`mcp:${e.tool.mcpServer}`);
      else if (e.tool) parts.push(e.tool.category);
      if (e.success === false) parts.push('failed');
      if (e.durationMs) parts.push(formatDuration(e.durationMs));
    } else if (e.type === 'tool_decision') {
      if (e.tool) parts.push(e.tool.category);
    } else if (e.type === 'user_prompt') {
      if (e.promptText) parts.push(reveal ? redact(e.promptText) : `${e.promptLength ?? e.promptText.length} chars (hidden)`);
      else if (e.promptLength !== undefined) parts.push(`${e.promptLength} chars`);
    } else if (e.type === 'api_error') {
      if (e.statusCode) parts.push(String(e.statusCode));
      if (e.errorMessage) parts.push(e.errorMessage);
    } else if (e.type === 'mcp_connection') {
      if (e.mcpStatus) parts.push(e.mcpStatus);
      if (e.mcpTransport) parts.push(e.mcpTransport);
      if (e.durationMs) parts.push(formatDuration(e.durationMs));
    } else if (e.type === 'plugin_loaded') {
      if (e.pluginVersion) parts.push(`v${e.pluginVersion}`);
    } else if (e.type === 'hook_execution') {
      if (e.hookBlocked) parts.push(`${e.hookBlocked} blocked`);
      if (e.hookErrored) parts.push(`${e.hookErrored} errored`);
    }
    return parts.join(' · ');
  }

  function rollupTotalTokens(s: AgentSession): number {
    return s.rollup.inputTokens + s.rollup.outputTokens;
  }

  // newest events first, capped so a long session stays responsive
  const timeline = $derived(selected ? [...selected.timeline].reverse().slice(0, 200) : []);
  const sessionTools = $derived(
    selected ? Object.values(selected.rollup.tools).sort((a, b) => b.count - a.count) : [],
  );

  // Runtime environment: MCP server connections, loaded plugins, hook runs —
  // modeled from mcp_server_connection / plugin_loaded / hook_execution events.
  const mcpConns = $derived(selected ? Object.values(selected.rollup.mcpConnections) : []);
  const plugins = $derived(selected ? Object.values(selected.rollup.plugins) : []);
  const hooks = $derived(selected?.rollup.hooks);
  const hasEnv = $derived(
    mcpConns.length > 0 || plugins.length > 0 || (hooks !== undefined && hooks.runs > 0),
  );
</script>

<!-- One aggregate-strip chip: leading icon + text, coloured by `tone`. -->
{#snippet chip(icon: typeof Bot, text: string, tone: string)}
  {@const Icon = icon}
  <span class="flex items-center gap-1 px-2 py-1 bg-subtle rounded-md {tone}">
    <Icon size={12} />{text}
  </span>
{/snippet}

<div class="flex flex-col h-full">
  <div class="flex items-center justify-between p-4 pb-3 border-b border-line">
    <h3 class="text-sm font-semibold flex items-center gap-2 text-fg">
      <Bot size={16} class="text-violet-500" />
      Agents
      {#if sessions.length > 0}
        <span class="ml-1 px-2 py-0.5 text-xs font-medium bg-violet-100 text-violet-700 rounded-full">
          {sessions.length}
        </span>
      {/if}
    </h3>
  </div>

  {#if sessions.length === 0}
    <!-- Empty state: one command to a live agent view -->
    <div class="flex-1 flex flex-col items-center justify-center text-center gap-4 px-6">
      <Bot size={40} class="text-fg-muted opacity-40" />
      <div class="max-w-md">
        <p class="text-sm font-medium text-fg">Waiting for coding-agent telemetry</p>
        <p class="text-xs text-fg-muted mt-1.5">
          Launch Claude Code wired to this receiver and its sessions, tokens,
          cost, tool, MCP, sub-agent &amp; skill usage will appear here.
        </p>
      </div>
      <div class="flex items-center gap-2 bg-subtle border border-line rounded-md px-3 py-2 font-mono text-xs text-fg">
        <Terminal size={13} class="text-fg-muted flex-shrink-0" />
        <span>{launchCommand}</span>
        <CopyButton value={launchCommand} label="Copy launch command" />
      </div>
      <p class="text-[11px] text-fg-muted/80 max-w-md">
        Uses OTLP <span class="font-mono">http/protobuf</span> to
        <span class="font-mono">:4318</span> — not the gRPC setup from most
        guides, which this receiver doesn't speak.
      </p>
    </div>
  {:else}
    <!-- Aggregate strip -->
    <div class="flex flex-wrap gap-2 p-3 border-b border-line text-xs">
      <span class="flex items-center gap-1 px-2 py-1 bg-subtle rounded-md text-fg">
        <DollarSign size={12} class="text-emerald-500" />{cost(agg.costUsd)}
      </span>
      <span class="flex items-center gap-1 px-2 py-1 bg-subtle rounded-md text-fg">
        <Coins size={12} class="text-amber-500" />
        {formatNumber(agg.inputTokens)} in / {formatNumber(agg.outputTokens)} out
      </span>
      <span class="flex items-center gap-1 px-2 py-1 bg-subtle rounded-md text-fg">
        <Check size={12} class="text-emerald-500" />{agg.accepted}
        <X size={12} class="text-red-500 ml-1" />{agg.rejected}
      </span>
      {#if agg.apiErrors > 0}
        <span class="flex items-center gap-1 px-2 py-1 bg-subtle rounded-md text-red-600">
          <AlertTriangle size={12} />{agg.apiErrors} errors
        </span>
      {/if}
      {#each entries(agg.toolCategories) as [cat, n] (cat)}
        {@render chip(Wrench, `${cat} ${n}`, 'text-fg-muted')}
      {/each}
      {#each entries(agg.mcpServers) as [srv, n] (srv)}
        {@render chip(Server, `mcp:${srv} ${n}`, 'text-sky-600')}
      {/each}
      {#each entries(agg.subAgents) as [type, n] (type)}
        {@render chip(Bot, `${type} ${n}`, 'text-violet-600')}
      {/each}
      {#each entries(agg.skills) as [name, n] (name)}
        {@render chip(Sparkles, `${name} ${n}`, 'text-fuchsia-600')}
      {/each}
      {#each entries(agg.models) as [model, n] (model)}
        <span class="px-2 py-1 bg-subtle rounded-md text-fg-muted font-mono">{model} ×{n}</span>
      {/each}
    </div>

    <div class="flex-1 flex min-h-0">
      <!-- Sessions list -->
      <div class="w-64 flex-shrink-0 overflow-y-auto border-r border-line">
        {#each sessions as s (s.id)}
          <button
            class="w-full text-left px-3 py-2.5 border-b border-line hover:bg-subtle transition-colors {selected?.id ===
            s.id
              ? 'bg-subtle'
              : ''}"
            onclick={() => selectAgentSession(s.id)}
          >
            <div class="flex items-center justify-between gap-2">
              <span class="font-mono text-xs text-fg truncate">{shortId(s.id)}</span>
              <span class="text-[11px] text-fg-muted">{s.agent}</span>
            </div>
            <div class="flex items-center gap-2 mt-1 text-[11px] text-fg-muted">
              <span>{cost(s.rollup.costUsd)}</span>
              <span>·</span>
              <span>{formatNumber(rollupTotalTokens(s))} tok</span>
              <span>·</span>
              <span>{formatDuration(s.lastSeen - s.firstSeen)}</span>
            </div>
          </button>
        {/each}
      </div>

      <!-- Session detail -->
      <div class="flex-1 overflow-y-auto min-w-0">
        {#if selected}
          <!-- Rollup header -->
          <div class="p-3 border-b border-line">
            <div class="flex items-center justify-between gap-2">
              <span class="font-mono text-xs text-fg">{selected.id}</span>
              {#if selected.terminal || selected.appVersion}
                <span class="text-[11px] text-fg-muted">
                  {selected.terminal ?? ''}{selected.appVersion ? ` · v${selected.appVersion}` : ''}
                </span>
              {/if}
            </div>
            <div class="flex flex-wrap gap-2 mt-2 text-[11px]">
              <span class="px-2 py-0.5 bg-subtle rounded text-fg">{cost(selected.rollup.costUsd)}
                {#if selected.rollup.costEstimatedUsd > 0}
                  <span class="text-amber-500" title="includes estimated cost">~</span>
                {/if}
              </span>
              <span class="px-2 py-0.5 bg-subtle rounded text-fg">{formatNumber(selected.rollup.inputTokens)} in / {formatNumber(selected.rollup.outputTokens)} out</span>
              <span class="px-2 py-0.5 bg-subtle rounded text-fg">{selected.rollup.apiRequests} req</span>
              <span class="px-2 py-0.5 bg-subtle rounded text-fg flex items-center gap-1">
                <MessageSquare size={11} />{selected.rollup.prompts}
              </span>
              {#if selected.rollup.linesAdded || selected.rollup.linesRemoved}
                <span class="px-2 py-0.5 bg-subtle rounded text-fg flex items-center gap-1">
                  <GitBranch size={11} />+{selected.rollup.linesAdded}/-{selected.rollup.linesRemoved}
                </span>
              {/if}
              {#if selected.rollup.commits}
                <span class="px-2 py-0.5 bg-subtle rounded text-fg">{selected.rollup.commits} commits</span>
              {/if}
            </div>
          </div>

          <!-- Per-tool breakdown -->
          {#if sessionTools.length > 0}
            <div class="p-3 border-b border-line">
              <div class="text-[11px] font-semibold text-fg-muted uppercase mb-2">Tools &amp; MCP</div>
              <div class="flex flex-col gap-1">
                {#each sessionTools as t (t.name)}
                  <div class="flex items-center justify-between text-xs">
                    <span class="font-mono text-fg truncate flex items-center gap-1.5">
                      {#if t.isMcp}<Server size={11} class="text-sky-500" />{/if}
                      {#if t.category === 'subagent'}<Bot size={11} class="text-violet-500" />{/if}
                      {#if t.category === 'skill'}<Sparkles size={11} class="text-fuchsia-500" />{/if}
                      {t.name}
                    </span>
                    <span class="text-fg-muted flex items-center gap-2 flex-shrink-0">
                      <span>×{t.count}</span>
                      {#if t.failures > 0}<span class="text-red-500">{t.failures} fail</span>{/if}
                      {#if t.totalDurationMs > 0}<span>{formatDuration(t.totalDurationMs)}</span>{/if}
                    </span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          <!-- Runtime environment: MCP servers, plugins, hooks -->
          {#if hasEnv}
            <div class="p-3 border-b border-line">
              <div class="text-[11px] font-semibold text-fg-muted uppercase mb-2">
                Runtime environment
              </div>
              <div class="flex flex-col gap-1">
                {#each mcpConns as m (m.name)}
                  <div class="flex items-center justify-between text-xs">
                    <span class="font-mono text-fg truncate flex items-center gap-1.5">
                      <Plug size={11} class="text-sky-500 flex-shrink-0" />
                      {m.name}
                    </span>
                    <span class="text-fg-muted flex items-center gap-2 flex-shrink-0">
                      <span
                        class="w-1.5 h-1.5 rounded-full {m.connected
                          ? 'bg-emerald-500'
                          : 'bg-fg-subtle'}"
                        title={m.connected ? 'connected' : 'disconnected'}
                      ></span>
                      {#if m.transport}<span>{m.transport}</span>{/if}
                      {#if m.disconnects > 0}<span>{m.connects}↑/{m.disconnects}↓</span>{/if}
                    </span>
                  </div>
                {/each}
                {#each plugins as p (p.name)}
                  <div class="flex items-center justify-between text-xs">
                    <span class="font-mono text-fg truncate flex items-center gap-1.5">
                      <Blocks size={11} class="text-fuchsia-500 flex-shrink-0" />
                      {p.name}
                    </span>
                    {#if p.version}<span class="text-fg-muted flex-shrink-0">v{p.version}</span>{/if}
                  </div>
                {/each}
                {#if hooks && hooks.runs > 0}
                  <div class="flex items-center justify-between text-xs">
                    <span class="font-mono text-fg flex items-center gap-1.5">
                      <Webhook size={11} class="text-amber-500 flex-shrink-0" />
                      hooks
                    </span>
                    <span class="text-fg-muted flex items-center gap-2 flex-shrink-0">
                      <span>×{hooks.runs}</span>
                      {#if hooks.blocked > 0}<span class="text-amber-600">{hooks.blocked} blocked</span>{/if}
                      {#if hooks.errored > 0}<span class="text-red-500">{hooks.errored} err</span>{/if}
                    </span>
                  </div>
                {/if}
              </div>
            </div>
          {/if}

          <!-- Timeline -->
          <div class="p-3">
            <div class="flex items-center justify-between mb-2">
              <div class="text-[11px] font-semibold text-fg-muted uppercase">Timeline</div>
              <button
                class="flex items-center gap-1 text-[11px] text-fg-muted hover:text-fg"
                onclick={() => (reveal = !reveal)}
                title="Reveal / hide captured prompt text"
              >
                {#if reveal}<EyeOff size={12} />Hide prompts{:else}<Eye size={12} />Reveal prompts{/if}
              </button>
            </div>
            <div class="flex flex-col gap-1">
              {#each timeline as e (e.id)}
                <div class="flex items-center gap-2 text-xs py-1 border-b border-line/50">
                  <span class="text-fg-muted tabular-nums flex-shrink-0">{formatTimestamp(e.timestamp)}</span>
                  <span
                    class="px-1.5 py-0.5 rounded text-[10px] flex-shrink-0 {e.type === 'api_error'
                      ? 'bg-red-100 text-red-700'
                      : e.decision === 'reject'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-subtle text-fg-muted'}"
                  >{e.type}</span>
                  <span class="text-fg truncate">{eventLabel(e)}</span>
                  <span class="text-fg-muted truncate ml-auto text-right">{eventDetail(e)}</span>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
