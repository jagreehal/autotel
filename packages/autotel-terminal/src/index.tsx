/**
 * Terminal Dashboard for Autotel
 *
 * Beautiful react-ink powered dashboard for viewing traces in real-time.
 *
 * @example Basic usage (auto-wire)
 * ```typescript
 * import { init } from 'autotel'
 * import { renderTerminal } from 'autotel-terminal'
 *
 * init({ service: 'my-app' })
 * renderTerminal() // Automatically creates stream from current tracer provider
 * ```
 *
 * @example With options
 * ```typescript
 * renderTerminal({
 *   title: 'My App Traces',
 *   showStats: true,
 *   maxSpans: 200,
 * })
 * ```
 *
 * @example Manual stream (advanced)
 * ```typescript
 * import { StreamingSpanProcessor } from 'autotel-terminal'
 * import { createTerminalSpanStream } from 'autotel-terminal'
 * import { BatchSpanProcessor } from 'autotel/processors'
 *
 * const processor = new StreamingSpanProcessor(new BatchSpanProcessor(exporter))
 * const stream = createTerminalSpanStream(processor)
 * renderTerminal({}, stream)
 * ```
 *
 * @module autotel-terminal
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { render, Box, Text, useInput, useStdin } from 'ink';
import type { TerminalSpanEvent, TerminalSpanStream } from './span-stream';
import { StreamingSpanProcessor } from './streaming-processor';
import { createTerminalSpanStream } from './span-stream';
import { getAutotelTracerProvider } from 'autotel/tracer-provider';
import type { TracerProvider } from '@opentelemetry/api';
import {
  buildTraceMap,
  buildTraceSummaries,
  buildTraceTree,
  flattenTraceTree,
  filterBySearch,
  filterTraceSummaries,
  computeStats,
  computePerSpanNameStats,
  sortSpansForWaterfall,
  spanServiceName,
} from './lib/trace-model';
import { formatDurationMs, formatRelative, truncate, buildWaterfallBar, buildTimeRuler } from './lib/format';
import { getServiceColor } from './lib/service-colors';
import type { SpanTreeNode } from './lib/trace-model';
import type { TerminalLogEvent, LogStats } from './lib/log-model';
import {
  filterLogsBySearch,
  computeLogStats,
  buildTraceTimeline,
} from './lib/log-model';
import { getTerminalLogStream, type TerminalLogStream } from './log-stream';
import {
  computeServiceStats,
  computeRouteStats,
  findHotSpanNames,
} from './lib/stats-model';
import { applySpanFilters, type SpanFilterState } from './lib/filters';
import type { ViewMode } from './lib/dashboard-keymap';
import { buildErrorSummaries } from './lib/error-model';
import { buildServiceGraph } from './lib/topology-model';
import { renderTopologyAscii } from './lib/topology-render';
import { exportTraceToJson } from './lib/export-model';
import type { AIConfig, ChatMessage, AIState } from './ai/types';
import {
  resolveConfigWithAutoDetect,
  createAIModel,
  type AIModelResult,
} from './ai/provider';
import { buildSystemPrompt } from './ai/system-prompt';
import { createTelemetryTools, type ToolContext } from './ai/tools';
import { providerStreamText } from './ai/stream';
import { Renderer as InkRenderer } from '@json-render/ink';
import type { InkSpec } from './ai/types';

/** Key attribute keys to show first (autotel / OTel conventions) */
const KEY_ATTR_KEYS = new Set([
  'http.route',
  'http.method',
  'db.operation',
  'db.statement',
  'db.system',
  'code.function',
  'code.filepath',
  'code.lineno',
  'user.id',
  'order.id',
]);

/**
 * Terminal dashboard options
 */
export interface TerminalOptions {
  /**
   * Dashboard title
   * @default 'Autotel Trace Inspector'
   */
  title?: string;

  /**
   * Show statistics bar (span count, error rate, avg duration)
   * @default true
   */
  showStats?: boolean;

  /**
   * Maximum number of spans to display
   * @default 100
   */
  maxSpans?: number;

  /**
   * Enable colors (auto-detect by default)
   * @default true if TTY
   */
  colors?: boolean;

  /**
   * AI assistant configuration. Auto-detects Ollama/OpenAI if not provided.
   */
  ai?: Partial<AIConfig>;
}

const THROTTLE_MS = 50;
const MAX_TRACES = 50;
const NEW_ERROR_DISPLAY_MS = 2000;
const RECORD_LIMIT_DEFAULT = 200;
const LIST_HEIGHT = 20;

interface DashboardProps {
  title: string;
  showStats: boolean;
  maxSpans: number;
  colors: boolean;
  stream: TerminalSpanStream;
  logStream?: TerminalLogStream | null;
  aiConfig?: Partial<AIConfig>;
}

function Dashboard({
  title,
  showStats,
  maxSpans,
  colors,
  stream,
  logStream,
  aiConfig,
}: DashboardProps): React.ReactElement {
  const [paused, setPaused] = useState(false);
  const [recording, setRecording] = useState(false);
  const [spans, setSpans] = useState<TerminalSpanEvent[]>([]);
  const [selected, setSelected] = useState(0);
  const [filterErrorsOnly, setFilterErrorsOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('trace');
  const [spanFilters, setSpanFilters] = useState<SpanFilterState>({
    statusGroup: 'all',
  });
  const [drilldownTraceId, setDrilldownTraceId] = useState<string | null>(null);
  const [drilldownSelectedIndex, setDrilldownSelectedIndex] = useState(0);
  const [drilldownScrollOffset, setDrilldownScrollOffset] = useState(0);
  const [drilldownTab, setDrilldownTab] = useState<
    'timeline' | 'spans' | 'logs'
  >('timeline');
  const [newErrorCount, setNewErrorCount] = useState(0);
  const [searchMode, setSearchMode] = useState(false);
  const [traceIdMode, setTraceIdMode] = useState(false);
  const [traceIdInput, setTraceIdInput] = useState('');
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSpansRef = useRef<TerminalSpanEvent[]>([]);
  const [logs, setLogs] = useState<TerminalLogEvent[]>([]);

  // AI state
  const [aiMessages, setAiMessages] = useState<ChatMessage[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiState, setAiState] = useState<AIState>({ status: 'unconfigured' });
  const [aiInputMode, setAiInputMode] = useState(false);
  const [aiSpec, setAiSpec] = useState<InkSpec | null>(null);
  const aiModelRef = useRef<AIModelResult | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);

  // Initialize AI model on mount
  useEffect(() => {
    let cancelled = false;
    resolveConfigWithAutoDetect(aiConfig).then(async (config) => {
      if (cancelled || !config) return;
      try {
        const result = await createAIModel(config);
        aiModelRef.current = result;
        setAiState({ status: 'idle' });
      } catch {
        setAiState({
          status: 'error',
          message: 'Failed to initialize AI model',
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [aiConfig]);

  // Subscribe to log stream if provided
  useEffect(() => {
    if (!logStream) return;
    const unsubscribe = logStream.onLog((event) => {
      if (paused) return;
      if (recording) {
        setLogs((prev) => {
          const next = [event, ...prev];
          if (next.length >= RECORD_LIMIT_DEFAULT) {
            setRecording(false);
            setPaused(true);
          }
          return next.slice(0, RECORD_LIMIT_DEFAULT);
        });
        return;
      }
      setLogs((prev) => [event, ...prev].slice(0, maxSpans));
    });
    return () => {
      unsubscribe();
    };
  }, [logStream, paused, maxSpans, recording]);

  useEffect(() => {
    const flush = () => {
      const batch = pendingSpansRef.current;
      pendingSpansRef.current = [];
      if (batch.length === 0) return;
      setSpans((prev) => {
        const next = [...batch, ...prev];
        return next.slice(0, maxSpans);
      });
      setSelected(0);
      setDrilldownTraceId(null);
    };
    const unsubscribe = stream.onSpanEnd((span) => {
      if (paused) return;
      if (span.status === 'ERROR') {
        setNewErrorCount((n) => n + 1);
        setTimeout(
          () => setNewErrorCount((n) => Math.max(0, n - 1)),
          NEW_ERROR_DISPLAY_MS,
        );
      }
      if (recording) {
        setSpans((prev) => {
          const next = [span, ...prev];
          if (next.length >= RECORD_LIMIT_DEFAULT) {
            setRecording(false);
            setPaused(true);
          }
          return next.slice(0, RECORD_LIMIT_DEFAULT);
        });
        setSelected(0);
        setDrilldownTraceId(null);
        return;
      }
      pendingSpansRef.current = [span, ...pendingSpansRef.current];
      if (throttleRef.current) return;
      throttleRef.current = setTimeout(() => {
        throttleRef.current = null;
        flush();
      }, THROTTLE_MS);
    });
    return () => {
      if (throttleRef.current) clearTimeout(throttleRef.current);
      unsubscribe();
    };
  }, [stream, paused, maxSpans, recording]);

  const filteredSpanBuffer = useMemo(
    () =>
      applySpanFilters(spans, {
        ...spanFilters,
        errorsOnly: filterErrorsOnly,
        searchQuery,
      }),
    [spans, spanFilters, filterErrorsOnly, searchQuery],
  );

  const traceMap = useMemo(
    () => buildTraceMap(filteredSpanBuffer, MAX_TRACES),
    [filteredSpanBuffer],
  );
  const traceSummaries = useMemo(
    () => buildTraceSummaries(traceMap),
    [traceMap],
  );
  const filteredSummaries = useMemo(() => {
    const base = filterTraceSummaries(traceSummaries, '', false);
    return spanFilters.traceId
      ? base.filter((t) => t.traceId === spanFilters.traceId)
      : base;
  }, [traceSummaries, spanFilters.traceId]);
  const filteredSpans = useMemo(
    () => filterBySearch(filteredSpanBuffer, '', false),
    [filteredSpanBuffer],
  );

  const stats = useMemo(() => computeStats(spans), [spans]);
  const perSpanNameStats = useMemo(
    () => computePerSpanNameStats(spans),
    [spans],
  );
  const logStats: LogStats = useMemo(() => computeLogStats(logs), [logs]);
  const filteredLogs = useMemo(() => {
    const traceFilteredLogs = spanFilters.traceId
      ? logs.filter((l) => l.traceId === spanFilters.traceId)
      : logs;
    return filterLogsBySearch(traceFilteredLogs, searchQuery, null);
  }, [logs, searchQuery, spanFilters.traceId]);

  const serviceStats = useMemo(() => computeServiceStats(spans), [spans]);
  const selectedServiceName = serviceStats[selected]?.serviceName ?? null;
  const spansForSelectedService = useMemo(() => {
    if (!selectedServiceName) return spans;
    return spans.filter(
      (s) =>
        (s.attributes?.['service.name'] as string | undefined) ===
        selectedServiceName,
    );
  }, [spans, selectedServiceName]);
  const selectedServiceRouteStats = useMemo(
    () => computeRouteStats(spansForSelectedService).slice(0, 8),
    [spansForSelectedService],
  );
  const selectedServiceHotSpans = useMemo(
    () => findHotSpanNames(spansForSelectedService, 8),
    [spansForSelectedService],
  );

  const selectedTraceSummary =
    drilldownTraceId == null
      ? (filteredSummaries[selected] ?? null)
      : (filteredSummaries.find((t) => t.traceId === drilldownTraceId) ?? null);
  const serviceGraph = useMemo(() => buildServiceGraph(spans), [spans]);
  const topologyLines = useMemo(() => renderTopologyAscii(serviceGraph), [serviceGraph]);
  const errorSummaries = useMemo(
    () => buildErrorSummaries(traceSummaries),
    [traceSummaries],
  );
  const filteredErrorSummaries = spanFilters.traceId
    ? errorSummaries.filter((e) => e.traceId === spanFilters.traceId)
    : errorSummaries;
  const traceTree =
    selectedTraceSummary == null
      ? []
      : flattenTraceTree(buildTraceTree(selectedTraceSummary.spans));
  const waterfallSpans =
    selectedTraceSummary == null
      ? []
      : sortSpansForWaterfall(selectedTraceSummary.spans);

  const currentSpanInTrace = traceTree[drilldownSelectedIndex] ?? null;
  const currentSpanInFlat = filteredSpans[selected] ?? null;
  const selectedTraceSummaryForDetails =
    viewMode === 'trace' &&
    drilldownTraceId == null &&
    filteredSummaries[selected]
      ? filteredSummaries[selected]!
      : null;
  const rootSpanOfSelectedTrace =
    selectedTraceSummaryForDetails != null &&
    selectedTraceSummaryForDetails.spans.length > 0
      ? (selectedTraceSummaryForDetails.spans.find(
          (s) =>
            !selectedTraceSummaryForDetails.spans.some(
              (p) => p.spanId === s.parentSpanId,
            ),
        ) ?? selectedTraceSummaryForDetails.spans[0])
      : null;
  const currentSpan =
    viewMode === 'trace'
      ? drilldownTraceId == null
        ? (rootSpanOfSelectedTrace ?? null)
        : (currentSpanInTrace?.span ?? null)
      : viewMode === 'span'
        ? currentSpanInFlat
        : null;

  const selectedTraceLogs =
    selectedTraceSummary?.traceId && logs.length > 0
      ? logs.filter((l) => l.traceId === selectedTraceSummary.traceId)
      : [];

  const timelineItems =
    selectedTraceSummary &&
    (selectedTraceSummary.spans.length > 0 || selectedTraceLogs.length > 0)
      ? buildTraceTimeline(selectedTraceSummary.spans, selectedTraceLogs)
      : [];

  /** Spans belonging to the drilled-down trace */
  const drilldownSpans = useMemo(
    () =>
      drilldownTraceId
        ? spans.filter((s) => s.traceId === drilldownTraceId)
        : [],
    [spans, drilldownTraceId],
  );

  /** Span tree for drill-down */
  const drilldownTree = useMemo(
    () =>
      drilldownSpans.length > 0
        ? flattenTraceTree(buildTraceTree(drilldownSpans))
        : [],
    [drilldownSpans],
  );

  /** Logs for the drilled-down trace */
  const drilldownLogs = useMemo(
    () =>
      drilldownTraceId
        ? logs.filter((l) => l.traceId === drilldownTraceId)
        : [],
    [logs, drilldownTraceId],
  );

  /** Combined timeline for drill-down (spans + logs interleaved by time) */
  const drilldownTimeline = useMemo(
    () =>
      drilldownSpans.length > 0 || drilldownLogs.length > 0
        ? buildTraceTimeline(drilldownSpans, drilldownLogs)
        : [],
    [drilldownSpans, drilldownLogs],
  );

  /** Summary for the drilled-down trace (for header display) */
  const drilldownSummary = useMemo(
    () =>
      drilldownTraceId
        ? (traceSummaries.find((t) => t.traceId === drilldownTraceId) ?? null)
        : null,
    [traceSummaries, drilldownTraceId],
  );

  /** Currently selected item in the drill-down view */
  const drilldownSelectedItem = useMemo(() => {
    if (!drilldownTraceId) return null;
    if (drilldownTab === 'timeline') {
      const item = drilldownTimeline[drilldownSelectedIndex];
      if (!item) return null;
      return item;
    }
    if (drilldownTab === 'spans') {
      return drilldownTree[drilldownSelectedIndex]
        ? {
            type: 'span' as const,
            span: drilldownTree[drilldownSelectedIndex]!.span,
          }
        : null;
    }
    if (drilldownTab === 'logs') {
      return drilldownLogs[drilldownSelectedIndex]
        ? { type: 'log' as const, log: drilldownLogs[drilldownSelectedIndex] }
        : null;
    }
    return null;
  }, [
    drilldownTraceId,
    drilldownTab,
    drilldownSelectedIndex,
    drilldownTimeline,
    drilldownTree,
    drilldownLogs,
  ]);

  // AI query sender — uses tools for precise telemetry queries
  const sendAIQuery = async (question: string) => {
    const aiResult = aiModelRef.current;
    if (!aiResult || aiState.status === 'streaming') return;

    const userMsg: ChatMessage = { role: 'user', content: question };
    setAiMessages((prev) => [...prev, userMsg]);
    setAiInput('');

    const abort = new AbortController();
    aiAbortRef.current = abort;
    setAiSpec(null);
    setAiState({ status: 'streaming', abortController: abort });

    // Build tool context from current dashboard state
    const toolCtx: ToolContext = {
      spans,
      logs,
      traces: traceSummaries,
      stats,
      serviceStats,
      errorSummaries,
    };
    const tools = createTelemetryTools(toolCtx, (spec) => setAiSpec(spec));

    // Compact stats for system prompt (tools provide the detailed data)
    const statsContext = JSON.stringify({
      viewMode,
      stats: {
        totalSpans: stats.total,
        errors: stats.errors,
        avgMs: Math.round(stats.avg),
        p95Ms: Math.round(stats.p95),
      },
      services: serviceStats.length,
      traces: traceSummaries.length,
    });
    const drilldownContext = drilldownTraceId
      ? `\n\nCurrently viewing trace ${drilldownTraceId}. This trace has ${drilldownSpans.length} spans and ${drilldownLogs.length} logs. The root span is "${drilldownSummary?.rootName ?? 'unknown'}" with duration ${drilldownSummary ? formatDurationMs(drilldownSummary.durationMs) : 'unknown'}.`
      : '';
    const systemPrompt =
      buildSystemPrompt(viewMode, statsContext) + drilldownContext;

    try {
      // Add empty assistant message for streaming
      setAiMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

      const result = await providerStreamText(aiResult.providerType, {
        model: aiResult.model,
        system: systemPrompt,
        messages: [...aiMessages, userMsg].map((m) => ({
          role: m.role,
          content: m.content,
        })),
        tools,
        maxSteps: 10,
        abortSignal: abort.signal,
      });

      let fullText = '';

      for await (const chunk of result.textStream) {
        if (abort.signal.aborted) break;
        fullText += chunk;
        const captured = fullText;
        setAiMessages((prev) => {
          const updated = [...prev];
          const lastMsg = updated.at(-1);
          if (lastMsg?.role === 'assistant') {
            updated[updated.length - 1] = {
              role: 'assistant',
              content: captured,
            };
          }
          return updated;
        });
      }

      // If model returned no text (common with small models after tool calls),
      // show a fallback message
      if (!fullText.trim()) {
        setAiMessages((prev) => {
          const updated = [...prev];
          const lastMsg = updated.at(-1);
          if (lastMsg?.role === 'assistant' && !lastMsg.content.trim()) {
            updated[updated.length - 1] = {
              role: 'assistant',
              content: '(No response from model — try a simpler question or a larger model)',
            };
          }
          return updated;
        });
      }

      setAiState({ status: 'idle' });
    } catch (error: unknown) {
      if (abort.signal.aborted) {
        setAiState({ status: 'idle' });
        return;
      }
      const errorMsg = error instanceof Error ? error.message : String(error);
      process.stderr.write(`[autotel-terminal] AI error: ${errorMsg}\n`);
      setAiState({
        status: 'error',
        message: errorMsg,
      });
    } finally {
      aiAbortRef.current = null;
    }
  };

  const { isRawModeSupported } = useStdin();

  useInput(
    (input, key) => {
      if (showHelp && input !== '?') {
        if (input === '?') setShowHelp(false);
        return;
      }
      if (input === '?') {
        setShowHelp((h) => !h);
        return;
      }
      if (input === '/') {
        setSearchMode((m) => !m);
        if (searchMode) setSearchQuery('');
        return;
      }
      if (searchMode) {
        if (key.escape || key.return) {
          setSearchMode(false);
        } else if (key.backspace || key.delete) {
          setSearchQuery((q) => q.slice(0, -1));
        } else if (key.tab) {
          // Autocomplete: find first matching traceId and apply it
          if (searchQuery.length >= 4) {
            const match = traceSummaries.find((t) =>
              t.traceId.toLowerCase().startsWith(searchQuery.toLowerCase()),
            );
            if (match) {
              setSpanFilters((prev) => ({ ...prev, traceId: match.traceId }));
              setSearchMode(false);
              setSearchQuery('');
            }
          }
        } else if (input && input.length === 1 && !key.ctrl && !key.meta) {
          setSearchQuery((q) => q + input);
        }
        return;
      }
      if (traceIdMode) {
        if (key.escape) {
          setTraceIdMode(false);
          setTraceIdInput('');
        } else if (key.return) {
          if (traceIdInput.trim()) {
            // Find matching traceId (prefix match)
            const match = traceSummaries.find((t) =>
              t.traceId.toLowerCase().startsWith(traceIdInput.toLowerCase()),
            );
            if (match) {
              setSpanFilters((prev) => ({ ...prev, traceId: match.traceId }));
            }
          } else {
            // Empty input — clear traceId filter
            setSpanFilters((prev) => {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { traceId: _, ...rest } = prev;
              return rest;
            });
          }
          setTraceIdMode(false);
          setTraceIdInput('');
        } else if (key.tab) {
          // Autocomplete: fill in first matching traceId
          if (traceIdInput.length >= 2) {
            const match = traceSummaries.find((t) =>
              t.traceId.toLowerCase().startsWith(traceIdInput.toLowerCase()),
            );
            if (match) {
              setTraceIdInput(match.traceId);
            }
          }
        } else if (key.backspace || key.delete) {
          setTraceIdInput((q) => q.slice(0, -1));
        } else if (input && input.length === 1 && !key.ctrl && !key.meta) {
          setTraceIdInput((q) => q + input);
        }
        return;
      }
      // AI input mode — intercepts all input when typing a question
      if (aiInputMode) {
        if (key.escape) {
          if (aiState.status === 'streaming') {
            aiAbortRef.current?.abort();
          } else {
            setAiInputMode(false);
            setViewMode('trace');
          }
          return;
        }
        if (key.backspace || key.delete) {
          setAiInput((q) => q.slice(0, -1));
          return;
        }
        if (key.return) {
          if (aiInput.trim()) {
            sendAIQuery(aiInput.trim());
          }
          return;
        }
        if (input && input.length === 1 && !key.ctrl && !key.meta) {
          setAiInput((q) => q + input);
        }
        return;
      }
      if (input === 'a') {
        if (viewMode === 'ai') {
          setViewMode('trace');
          setAiInputMode(false);
        } else {
          setViewMode('ai');
          if (aiState.status !== 'unconfigured') {
            setAiInputMode(true);
          }
        }
        setSelected(0);
        setDrilldownTraceId(null);
        setDrilldownSelectedIndex(0);
        setDrilldownScrollOffset(0);
        return;
      }
      if (key.escape) {
        if (drilldownTraceId == null) {
          setSearchMode(false);
        } else {
          setDrilldownTraceId(null);
          setDrilldownSelectedIndex(0);
          setDrilldownScrollOffset(0);
          setDrilldownTab('timeline');
        }
        return;
      }
      if (key.tab && drilldownTraceId != null) {
        const tabs: Array<'timeline' | 'spans' | 'logs'> = [
          'timeline',
          'spans',
          'logs',
        ];
        const currentIdx = tabs.indexOf(drilldownTab);
        const nextIdx = key.shift
          ? (currentIdx - 1 + tabs.length) % tabs.length
          : (currentIdx + 1) % tabs.length;
        setDrilldownTab(tabs[nextIdx]!);
        setDrilldownSelectedIndex(0);
        setDrilldownScrollOffset(0);
        return;
      }
      if (key.return && drilldownTraceId == null) {
        let targetTraceId: string | undefined;
        let preSelectIndex = 0;
        if (viewMode === 'trace' && filteredSummaries[selected]) {
          targetTraceId = filteredSummaries[selected]!.traceId;
        } else if (viewMode === 'log' && filteredLogs[selected]?.traceId) {
          targetTraceId = filteredLogs[selected]!.traceId;
          const originLog = filteredLogs[selected]!;
          const traceSpans = spans.filter((s) => s.traceId === targetTraceId);
          const traceLogs = logs.filter((l) => l.traceId === targetTraceId);
          const timeline = buildTraceTimeline(traceSpans, traceLogs);
          preSelectIndex = timeline.findIndex(
            (item) => item.type === 'log' && item.log === originLog,
          );
          if (preSelectIndex < 0) preSelectIndex = 0;
        } else if (viewMode === 'span' && filteredSpans[selected]?.traceId) {
          targetTraceId = filteredSpans[selected]!.traceId;
          const originSpan = filteredSpans[selected]!;
          const traceSpans = spans.filter((s) => s.traceId === targetTraceId);
          const traceLogs = logs.filter((l) => l.traceId === targetTraceId);
          const timeline = buildTraceTimeline(traceSpans, traceLogs);
          preSelectIndex = timeline.findIndex(
            (item) =>
              item.type === 'span' && item.span?.spanId === originSpan.spanId,
          );
          if (preSelectIndex < 0) preSelectIndex = 0;
        }
        if (targetTraceId) {
          setDrilldownTraceId(targetTraceId);
          setDrilldownSelectedIndex(preSelectIndex);
          setDrilldownScrollOffset(Math.max(0, preSelectIndex - LIST_HEIGHT + 1));
          setDrilldownTab('timeline');
          return;
        }
      }
      if (key.upArrow || key.downArrow) {
        if (drilldownTraceId != null) {
          // In drill-down mode — navigate within the active tab's list
          const listLength =
            drilldownTab === 'timeline'
              ? drilldownTimeline.length
              : drilldownTab === 'spans'
                ? drilldownTree.length
                : drilldownLogs.length;
          if (key.upArrow) {
            setDrilldownSelectedIndex((prev) => {
              const next = Math.max(0, prev - 1);
              setDrilldownScrollOffset((off) => Math.min(next, off));
              return next;
            });
          } else {
            setDrilldownSelectedIndex((prev) => {
              const next = Math.min(listLength - 1, prev + 1);
              setDrilldownScrollOffset((off) =>
                next >= off + LIST_HEIGHT ? next - LIST_HEIGHT + 1 : off,
              );
              return next;
            });
          }
          return;
        }
        switch (viewMode) {
          case 'trace': {
            if (key.upArrow) {
              setSelected((i) => Math.max(0, i - 1));
              setDrilldownSelectedIndex(0);
            } else if (key.downArrow) {
              setSelected((i) => Math.min(filteredSummaries.length - 1, i + 1));
              setDrilldownSelectedIndex(0);
            }
            break;
          }
          case 'span': {
            if (key.upArrow) {
              setSelected((i) => Math.max(0, i - 1));
            } else if (key.downArrow) {
              setSelected((i) => Math.min(filteredSpans.length - 1, i + 1));
            }
            break;
          }
          case 'log': {
            if (key.upArrow) {
              setSelected((i) => Math.max(0, i - 1));
            } else if (key.downArrow) {
              setSelected((i) => Math.min(filteredLogs.length - 1, i + 1));
            }
            break;
          }
          case 'service-summary': {
            if (key.upArrow) {
              setSelected((i) => Math.max(0, i - 1));
            } else if (key.downArrow) {
              setSelected((i) => Math.min(serviceStats.length - 1, i + 1));
            }
            break;
          }
          case 'errors': {
            if (key.upArrow) {
              setSelected((i) => Math.max(0, i - 1));
            } else if (key.downArrow) {
              setSelected((i) =>
                Math.min(filteredErrorSummaries.length - 1, i + 1),
              );
            }
            break;
          }
        }
      }
      if (input === 'p') setPaused((p) => !p);
      if (input === 'e') setFilterErrorsOnly((v) => !v);
      if (input === 't') {
        setViewMode((m) => (m === 'trace' ? 'span' : 'trace'));
        setSelected(0);
        setDrilldownTraceId(null);
        setDrilldownSelectedIndex(0);
        setDrilldownScrollOffset(0);
      }
      if (input === 'l') {
        setViewMode((m) => (m === 'log' ? 'trace' : 'log'));
        setSelected(0);
        setDrilldownTraceId(null);
        setDrilldownSelectedIndex(0);
        setDrilldownScrollOffset(0);
      }
      if (input === 'v') {
        setViewMode((m) =>
          m === 'service-summary' ? 'trace' : 'service-summary',
        );
        setSelected(0);
        setDrilldownTraceId(null);
        setDrilldownSelectedIndex(0);
        setDrilldownScrollOffset(0);
      }
      if (input === 'E') {
        setViewMode((m) => (m === 'errors' ? 'trace' : 'errors'));
        setSelected(0);
        setDrilldownTraceId(null);
        setDrilldownSelectedIndex(0);
        setDrilldownScrollOffset(0);
      }
      if (input === 'G') {
        setViewMode((m) => (m === 'topology' ? 'trace' : 'topology'));
        setSelected(0);
        setDrilldownTraceId(null);
        setDrilldownSelectedIndex(0);
        setDrilldownScrollOffset(0);
      }
      if (input === 'c') {
        setSpans([]);
        setLogs([]);
        setSelected(0);
        setDrilldownTraceId(null);
        setDrilldownSelectedIndex(0);
        setDrilldownScrollOffset(0);
        setNewErrorCount(0);
        setSpanFilters({ statusGroup: 'all' });
        setRecording(false);
        setPaused(false);
      }
      if (input === 'r') {
        setSpans([]);
        setLogs([]);
        setSelected(0);
        setDrilldownTraceId(null);
        setDrilldownSelectedIndex(0);
        setDrilldownScrollOffset(0);
        setNewErrorCount(0);
        setSpanFilters({ statusGroup: 'all' });
        setPaused(false);
        setRecording(true);
      }
      if (input === 'x') {
        setSpanFilters({ statusGroup: 'all' });
        setSelected(0);
        setDrilldownTraceId(null);
        setDrilldownSelectedIndex(0);
        setDrilldownScrollOffset(0);
      }
      if (input === 'f') {
        setTraceIdMode(true);
        setTraceIdInput(spanFilters.traceId ?? '');
        return;
      }
      if (input === 'H') {
        setSpanFilters((prev) => {
          const next =
            prev.statusGroup === 'all'
              ? '2xx'
              : prev.statusGroup === '2xx'
                ? '4xx'
                : prev.statusGroup === '4xx'
                  ? '5xx'
                  : 'all';
          return { ...prev, statusGroup: next };
        });
        setSelected(0);
        setDrilldownTraceId(null);
        setDrilldownSelectedIndex(0);
        setDrilldownScrollOffset(0);
      }
      if (input === 'S') {
        const svc = currentSpan?.attributes?.['service.name'];
        if (typeof svc === 'string' && svc.trim()) {
          setSpanFilters((prev) => ({ ...prev, serviceName: svc }));
          setSelected(0);
          setDrilldownTraceId(null);
          setDrilldownSelectedIndex(0);
          setDrilldownScrollOffset(0);
        }
      }
      if (input === 'R') {
        const route = currentSpan?.attributes?.['http.route'];
        if (typeof route === 'string' && route.trim()) {
          setSpanFilters((prev) => ({ ...prev, route }));
          setSelected(0);
          setDrilldownTraceId(null);
          setDrilldownSelectedIndex(0);
          setDrilldownScrollOffset(0);
        }
      }
      if (input === 'T') {
        // Jump to trace view with traceId filter from current item
        let traceId: string | undefined;
        if (drilldownTraceId) {
          traceId = drilldownTraceId;
        } else {
          switch (viewMode) {
            case 'log': {
              traceId = filteredLogs[selected]?.traceId;
              break;
            }
            case 'span': {
              traceId = filteredSpans[selected]?.traceId;
              break;
            }
            case 'errors': {
              traceId = filteredErrorSummaries[selected]?.traceId;
              break;
            }
          }
        }
        if (traceId && viewMode !== 'trace') {
          setSpanFilters((prev) => ({ ...prev, traceId }));
          setViewMode('trace');
          setSelected(0);
          setDrilldownTraceId(null);
          setDrilldownSelectedIndex(0);
          setDrilldownScrollOffset(0);
          setDrilldownTab('timeline');
        }
        return;
      }
      if (input === 'L') {
        // Jump to log view with traceId filter from current item
        let traceId: string | undefined;
        if (drilldownTraceId) {
          traceId = drilldownTraceId;
        } else {
          switch (viewMode) {
            case 'trace': {
              traceId = filteredSummaries[selected]?.traceId;
              break;
            }
            case 'span': {
              traceId = filteredSpans[selected]?.traceId;
              break;
            }
            case 'errors': {
              traceId = filteredErrorSummaries[selected]?.traceId;
              break;
            }
          }
        }
        if (traceId && viewMode !== 'log') {
          setSpanFilters((prev) => ({ ...prev, traceId }));
          setViewMode('log');
          setSelected(0);
          setDrilldownTraceId(null);
          setDrilldownSelectedIndex(0);
          setDrilldownScrollOffset(0);
          setDrilldownTab('timeline');
        }
        return;
      }
      if (input === 'J') {
        const t = selectedTraceSummary;
        if (!t) return;
        const json = exportTraceToJson(t, selectedTraceLogs);
        process.stdout.write(`\n[autotel-terminal] trace export\n${json}\n`);
      }
    },
    { isActive: isRawModeSupported },
  );

  const headerRight = recording
    ? '[Recording]'
    : paused
      ? '[Paused]'
      : '[Live]';
  const headerModeLabel =
    viewMode === 'trace'
      ? 'traces'
      : viewMode === 'span'
        ? 'spans'
        : viewMode === 'log'
          ? 'logs'
          : viewMode === 'service-summary'
            ? 'services'
            : viewMode === 'topology'
              ? 'topology'
            : viewMode === 'ai'
              ? 'AI'
              : 'errors';
  const showNewError = newErrorCount > 0;

  function renderTreeRow(
    node: SpanTreeNode,
    index: number,
  ): React.ReactElement {
    const isSel = drilldownTraceId != null && index === drilldownSelectedIndex;
    const prefix =
      node.depth === 0
        ? ''
        : '  '.repeat(node.depth) +
          (node.children.length > 0 ? '├── ' : '└── ');
    const svcName = spanServiceName(node.span);
    const svcColor = getServiceColor(svcName);
    const statusColor =
      node.span.status === 'ERROR'
        ? 'red'
        : node.span.durationMs > 500
          ? 'yellow'
          : 'green';
    return (
      <Box
        key={`${node.span.spanId}-${node.span.startTime}`}
        flexDirection="row"
      >
        <Text backgroundColor={isSel ? 'blue' : undefined} color={isSel ? 'white' : undefined}>{isSel ? '▸ ' : '  '}</Text>
        <Text color={node.span.status === 'ERROR' ? 'red' : undefined}>{node.span.status === 'ERROR' ? '✗' : ' '}</Text>
        <Text dimColor>{prefix}</Text>
        <Text color={colors ? statusColor : undefined}>
          {truncate(node.span.name, 23)}
        </Text>
        <Text color={svcColor}> {truncate(svcName, 10)}</Text>
        <Text dimColor> {node.span.kind ?? ''}</Text>
        <Text dimColor> {formatDurationMs(node.span.durationMs)}</Text>
      </Box>
    );
  }

  function keyAttrsAndRest(attrs: Record<string, unknown> | undefined) {
    if (!attrs || Object.keys(attrs).length === 0)
      return {
        key: [] as [string, unknown][],
        rest: [] as [string, unknown][],
      };
    const entries = Object.entries(attrs);
    const key = entries.filter(([k]) => KEY_ATTR_KEYS.has(k));
    const rest = entries.filter(([k]) => !KEY_ATTR_KEYS.has(k));
    return { key, rest };
  }

  const waterfallMaxMs =
    waterfallSpans.length > 0
      ? Math.max(...waterfallSpans.map((w) => w.span.durationMs))
      : 1;
  const barWidth = 30;

  return (
    <Box
      flexDirection="column"
      paddingX={1}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text key="title" bold>
          🔭 {title} — {headerModeLabel}
        </Text>
        <Box flexDirection="row" gap={1}>
          {showNewError && (
            <Text key="newError" color="red">
              1 new error
            </Text>
          )}
          <Text key="status" color={paused ? 'yellow' : 'green'}>
            {headerRight}
          </Text>
        </Box>
      </Box>

      {/* Controls bar — always exactly 2 lines */}
      <Box marginBottom={0} flexDirection="column">
        {searchMode ? (
          <Text color="cyan">
            Search: {searchQuery || '(type to filter)'}
            <Text dimColor> (Tab: match traceId, Esc: cancel)</Text>
          </Text>
        ) : traceIdMode ? (
          <Text color="yellow">
            TraceId: {traceIdInput || '(type prefix, Tab to complete)'}
            {traceIdInput.length >= 2 && (
              <Text dimColor>
                {' → '}
                {traceSummaries
                  .find((t) =>
                    t.traceId.toLowerCase().startsWith(traceIdInput.toLowerCase()),
                  )
                  ?.traceId.slice(0, 16) ?? 'no match'}…
              </Text>
            )}
          </Text>
        ) : (
          <Box flexDirection="row" justifyContent="space-between">
            <Text dimColor>
              {drilldownTraceId == null
                ? '↑/↓ select • Enter open • Tab cycle tabs • Esc back • t trace • l logs • a AI • ? help'
                : '↑/↓ select • Tab cycle tabs • Esc back • t trace • l logs • a AI • ? help'}
            </Text>
            <Text dimColor>
              {viewMode === 'trace'
                ? `traces ${filteredSummaries.length}/${traceSummaries.length}`
                : viewMode === 'span'
                  ? `spans ${filteredSpans.length}/${spans.length}`
                  : viewMode === 'service-summary'
                    ? `services ${serviceStats.length}`
                    : viewMode === 'errors'
                      ? `errors ${filteredErrorSummaries.length}/${errorSummaries.length}`
                      : viewMode === 'topology'
                        ? `services ${serviceGraph.services.length} · edges ${serviceGraph.edges.length}`
                      : viewMode === 'ai'
                        ? `messages ${aiMessages.length}`
                        : `logs ${filteredLogs.length}/${logs.length}`}
            </Text>
          </Box>
        )}
        {showHelp && (
          <Text dimColor>
            Views: t/l/v/E/G/a • Search: / • Filters: e/S/R/H/f/x • Capture: p/r/J • Clear: c
          </Text>
        )}
      </Box>

      <Box marginBottom={0}>
        <Text dimColor>
          {spanFilters.serviceName || spanFilters.route || spanFilters.statusGroup !== 'all' || spanFilters.traceId
            ? `filters:${spanFilters.serviceName ? ` service=${spanFilters.serviceName}` : ''}${spanFilters.route ? ` route=${spanFilters.route}` : ''}${spanFilters.statusGroup && spanFilters.statusGroup !== 'all' ? ` status=${spanFilters.statusGroup}` : ''}${spanFilters.traceId ? ` trace=${spanFilters.traceId.slice(0, 8)}…` : ''}`
            : 'filters: none'}
        </Text>
      </Box>

      {viewMode === 'topology' && (
        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
          <Text bold>Service Topology</Text>
          <Text dimColor>Press G to toggle · Shows service dependencies from span data</Text>
          <Box flexDirection="column" marginTop={1}>
            {topologyLines.map((line, i) => {
              const hasErr = line.includes(' err');
              return (
                <Text key={`topo-${i}`} color={hasErr ? 'red' : undefined}>
                  {line}
                </Text>
              );
            })}
          </Box>
        </Box>
      )}

      {viewMode === 'ai' && (
        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={0}>
          <Box marginBottom={1} justifyContent="space-between">
            <Text bold>AI Assistant</Text>
            <Text dimColor>
              {aiState.status === 'streaming'
                ? '(streaming...)'
                : aiState.status === 'unconfigured'
                  ? '(no provider)'
                  : aiState.status === 'error'
                    ? '(error)'
                    : ''}
            </Text>
          </Box>

          {aiState.status === 'unconfigured' ? (
            <Box flexDirection="column">
              <Text dimColor>No AI provider configured.</Text>
              <Text dimColor>Set AI_PROVIDER and AI_MODEL env vars, or start Ollama locally.</Text>
              <Text dimColor>Press a to close this view.</Text>
            </Box>
          ) : (
            <>
              {aiMessages.length === 0 && aiState.status !== 'error' && (
                <Text dimColor>Ask a question about your telemetry data. Press Enter to send.</Text>
              )}
              {aiMessages.slice(-10).map((msg, i) => (
                <Box key={`ai-msg-${i}`} flexDirection="column" marginBottom={msg.role === 'assistant' ? 1 : 0}>
                  <Text color={msg.role === 'user' ? 'cyan' : undefined}>
                    {msg.role === 'user' ? '> ' : ''}
                    {msg.content.slice(0, 1000)}
                    {msg.content.length > 1000 ? '...' : ''}
                  </Text>
                </Box>
              ))}
              {aiSpec && (
                <Box flexDirection="column" marginBottom={1} borderStyle="single" borderColor="gray" paddingX={1}>
                  <InkRenderer spec={aiSpec} />
                </Box>
              )}
              {aiState.status === 'error' && (
                <Text color="red">Error: {aiState.message}</Text>
              )}
              <Box marginTop={1} borderStyle="single" borderColor="cyan" paddingX={1}>
                <Text color="cyan">&gt; </Text>
                <Text>
                  {aiInput || (aiInputMode ? '(type your question)' : '(press a to focus)')}
                </Text>
              </Box>
            </>
          )}
        </Box>
      )}

      {/* eslint-disable unicorn/no-negated-condition */}
      {viewMode !== 'topology' && viewMode !== 'ai' && (drilldownTraceId != null ? (
        <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} paddingY={0}>
          {/* Trace header — otel-gui style */}
          <Box marginBottom={0} flexDirection="column">
            <Text bold>Trace {drilldownTraceId.slice(0, 16)}…</Text>
            <Box flexDirection="row" gap={1}>
              {drilldownSummary?.services?.map((svc) => (
                <Text key={svc} color={getServiceColor(svc)}>{svc}</Text>
              ))}
              <Text dimColor>·</Text>
              <Text>{drilldownSummary?.rootName ?? 'unknown'}</Text>
              <Text dimColor>·</Text>
              <Text dimColor>{drilldownSpans.length} spans</Text>
              <Text dimColor>·</Text>
              <Text dimColor>{drilldownSummary?.services?.length ?? 0} services</Text>
              {drilldownSummary?.hasError && <Text color="red">{' '}ERROR</Text>}
            </Box>
            <Box flexDirection="row" gap={2}>
              <Text dimColor>Duration: </Text>
              <Text color="green">{formatDurationMs(drilldownSummary?.durationMs ?? 0)}</Text>
            </Box>
          </Box>
          {/* Tabs — blue active */}
          <Box marginBottom={0} flexDirection="row" gap={2}>
            <Text
              color={drilldownTab === 'timeline' ? 'blue' : undefined}
              dimColor={drilldownTab !== 'timeline'}
              bold={drilldownTab === 'timeline'}
            >
              Timeline
            </Text>
            <Text
              color={drilldownTab === 'spans' ? 'blue' : undefined}
              dimColor={drilldownTab !== 'spans'}
              bold={drilldownTab === 'spans'}
            >
              Spans ({drilldownSpans.length})
            </Text>
            <Text
              color={drilldownTab === 'logs' ? 'blue' : undefined}
              dimColor={drilldownTab !== 'logs'}
              bold={drilldownTab === 'logs'}
            >
              Logs ({drilldownLogs.length})
            </Text>
          </Box>

          {drilldownTab === 'timeline' &&
            (() => {
              const NAME_COL = 28;
              const SERVICE_COL = 12;
              const KIND_COL = 10;
              let traceStartMs = Infinity;
              for (const s of drilldownSummary?.spans ?? []) {
                if (s.startTime < traceStartMs) traceStartMs = s.startTime;
              }
              if (traceStartMs === Infinity) traceStartMs = 0;
              const traceDurMs = drilldownSummary?.durationMs ?? 1;
              const WATERFALL_WIDTH = 44;
              const items = drilldownTimeline.slice(drilldownScrollOffset, drilldownScrollOffset + LIST_HEIGHT);

              return (
                <>
                  {/* Time ruler */}
                  <Box flexDirection="row">
                    <Text dimColor>{''.padEnd(NAME_COL + SERVICE_COL + KIND_COL + 2)}</Text>
                    <Text dimColor>{buildTimeRuler(traceDurMs, WATERFALL_WIDTH)}</Text>
                  </Box>
                  {items.map((item, i) => {
                    const isSel = i + drilldownScrollOffset === drilldownSelectedIndex;
                    if (item.type === 'span' && item.span) {
                      const s = item.span;
                      const node = drilldownTree.find(
                        (n) => n.span.spanId === s.spanId,
                      );
                      const depth = node?.depth ?? 0;
                      const indent = '  '.repeat(Math.min(depth, 4));
                      const nameWidth = NAME_COL - Math.min(depth, 4) * 2 - 1;
                      const svcName = spanServiceName(s);
                      const svcColor = getServiceColor(svcName);
                      const kindStr = (s.kind ?? '').padEnd(KIND_COL);
                      const svcStr = truncate(svcName, SERVICE_COL - 2).padEnd(SERVICE_COL);
                      const errorMark = s.status === 'ERROR' ? '✗' : ' ';
                      const namePart = `${indent}${truncate(s.name, nameWidth - 1)}`.padEnd(NAME_COL - 1);
                      const bar = buildWaterfallBar(
                        s.startTime, s.durationMs,
                        traceStartMs, traceDurMs,
                        WATERFALL_WIDTH,
                      );
                      return (
                        <Box key={`${s.spanId}-${i}`} flexDirection="row">
                          <Text backgroundColor={isSel ? 'blue' : undefined} color={isSel ? 'white' : undefined}>
                            {isSel ? '▸' : ' '}<Text color={s.status === 'ERROR' ? 'red' : undefined}>{errorMark}</Text>{namePart}
                          </Text>
                          <Text color={svcColor}> {svcStr}</Text>
                          <Text dimColor>{kindStr}</Text>
                          <Text color={s.status === 'ERROR' ? 'red' : svcColor}>{bar}</Text>
                          <Text color={s.status === 'ERROR' ? 'red' : svcColor}>
                            {' '}{formatDurationMs(s.durationMs)}
                          </Text>
                        </Box>
                      );
                    } else if (item.type === 'log' && item.log) {
                      const l = item.log;
                      const levelColor =
                        l.level === 'error' ? 'red' : l.level === 'warn' ? 'yellow' : 'blue';
                      const relTime = drilldownSummary
                        ? `+${formatDurationMs(l.time - traceStartMs)}`
                        : '';
                      const logName = `  ${l.level.toUpperCase()} ${truncate(l.message, NAME_COL - 8)}`.padEnd(NAME_COL);
                      const logOffset = drilldownSummary
                        ? Math.floor(((l.time - traceStartMs) / traceDurMs) * WATERFALL_WIDTH)
                        : 0;
                      const clampedOffset = Math.max(0, Math.min(logOffset, WATERFALL_WIDTH - 1));
                      const logBar = ' '.repeat(clampedOffset) + '·' + ' '.repeat(WATERFALL_WIDTH - clampedOffset - 1);
                      return (
                        <Box key={`log-${i}`} flexDirection="row">
                          <Text backgroundColor={isSel ? 'blue' : undefined} color={isSel ? 'white' : undefined}>
                            {isSel ? '▸' : ' '}<Text color={levelColor}>{logName}</Text>
                          </Text>
                          <Text dimColor>{' '.padEnd(SERVICE_COL + KIND_COL + 1)}</Text>
                          <Text dimColor>{logBar}</Text>
                          <Text dimColor> {relTime}</Text>
                        </Box>
                      );
                    }
                    return null;
                  })}
                  {Array.from({ length: Math.max(0, LIST_HEIGHT - items.length) }).map((_, i) => (
                    <Box key={`pad-${i}`}><Text> </Text></Box>
                  ))}
                </>
              );
            })()}

          {drilldownTab === 'spans' &&
            drilldownTree.slice(drilldownScrollOffset, drilldownScrollOffset + LIST_HEIGHT).map((node, i) => renderTreeRow(node, i + drilldownScrollOffset))}
          {drilldownTab === 'spans' &&
            Array.from({ length: Math.max(0, LIST_HEIGHT - Math.min(drilldownTree.length, LIST_HEIGHT)) }).map((_, i) => (
              <Box key={`pad-${i}`}><Text> </Text></Box>
            ))}

          {drilldownTab === 'logs' &&
            drilldownLogs.slice(drilldownScrollOffset, drilldownScrollOffset + LIST_HEIGHT).map((log, i) => {
              const isSel = i + drilldownScrollOffset === drilldownSelectedIndex;
              const levelColor =
                log.level === 'error'
                  ? 'red'
                  : log.level === 'warn'
                    ? 'yellow'
                    : log.level === 'info'
                      ? 'green'
                      : undefined;
              return (
                <Box key={`log-${i}`}>
                  <Text
                    backgroundColor={isSel ? 'blue' : undefined}
                    color={isSel ? 'white' : undefined}
                  >
                    {isSel ? '▸' : ' '}
                    <Text color={levelColor}>
                      {' '}
                      {log.level.toUpperCase()}
                    </Text>{' '}
                    <Text dimColor>[{truncate(log.message, 50)}]</Text>
                  </Text>
                </Box>
              );
            })}
          {drilldownTab === 'logs' &&
            Array.from({ length: Math.max(0, LIST_HEIGHT - Math.min(drilldownLogs.length, LIST_HEIGHT)) }).map((_, i) => (
              <Box key={`pad-${i}`}><Text> </Text></Box>
            ))}

          {/* Inline detail for selected span */}
          {drilldownSelectedItem?.type === 'span' && drilldownSelectedItem.span && (
            (() => {
              const span = drilldownSelectedItem.span;
              const { key: keyAttrs, rest: restAttrs } = keyAttrsAndRest(span.attributes);
              return (
                <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
                  <Box flexDirection="row" gap={2}>
                    <Text bold>{span.name}</Text>
                    <Text color={getServiceColor(spanServiceName(span))}>{spanServiceName(span)}</Text>
                    <Text dimColor>{span.kind ?? ''}</Text>
                    <Text color={span.status === 'ERROR' ? 'red' : 'green'}>{span.status}</Text>
                    <Text>{formatDurationMs(span.durationMs)}</Text>
                  </Box>
                  <Box flexDirection="row" gap={2}>
                    <Text dimColor>Trace: {span.traceId}</Text>
                    <Text dimColor>Span: {span.spanId}</Text>
                    {span.parentSpanId && <Text dimColor>Parent: {span.parentSpanId}</Text>}
                  </Box>
                  {keyAttrs.length > 0 && (
                    <Box marginTop={1} flexDirection="column">
                      <Text bold>Key attributes</Text>
                      {keyAttrs.slice(0, 6).map(([k, v]) => (
                        <Text key={k} dimColor>
                          {truncate(k, 18)}: {truncate(String(v), 28)}
                        </Text>
                      ))}
                    </Box>
                  )}
                  {restAttrs.length > 0 && (
                    <Box marginTop={1} flexDirection="column">
                      <Text bold>Attributes</Text>
                      {restAttrs.slice(0, 8).map(([k, v]) => (
                        <Text key={k} dimColor>
                          {truncate(k, 18)}: {truncate(String(v), 28)}
                        </Text>
                      ))}
                    </Box>
                  )}
                  {/* Span Events */}
                  {span.events && span.events.length > 0 && (
                    <Box flexDirection="column" marginTop={0}>
                      <Text bold dimColor>Events ({span.events.length})</Text>
                      {span.events.slice(0, 5).map((ev, i) => (
                        <Box key={`ev-${i}`} flexDirection="row">
                          <Text color={ev.name === 'exception' ? 'red' : 'yellow'}>
                            {'  '}{'\u25C6'} {truncate(ev.name, 20)}
                          </Text>
                          <Text dimColor>
                            {' '}+{formatDurationMs(ev.timeMs - span.startTime)}
                          </Text>
                          {ev.attributes && Object.keys(ev.attributes).length > 0 && (
                            <Text dimColor>
                              {' '}{Object.entries(ev.attributes).slice(0, 2).map(([k, v]) => `${k}=${String(v)}`).join(' ')}
                            </Text>
                          )}
                        </Box>
                      ))}
                    </Box>
                  )}
                  {/* Span Links */}
                  {span.links && span.links.length > 0 && (
                    <Box flexDirection="column" marginTop={0}>
                      <Text bold dimColor>Links ({span.links.length})</Text>
                      {span.links.slice(0, 5).map((lnk, i) => (
                        <Box key={`lnk-${i}`} flexDirection="row">
                          <Text color="cyan">
                            {'  '}{'\u2192'} trace:{lnk.traceId.slice(0, 8)}{'\u2026'} span:{lnk.spanId.slice(0, 8)}{'\u2026'}
                          </Text>
                          {lnk.attributes && Object.keys(lnk.attributes).length > 0 && (
                            <Text dimColor>
                              {' '}{Object.entries(lnk.attributes).slice(0, 2).map(([k, v]) => `${k}=${String(v)}`).join(' ')}
                            </Text>
                          )}
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>
              );
            })()
          )}
          {/* Inline detail for selected log */}
          {drilldownSelectedItem?.type === 'log' && drilldownSelectedItem.log && (
            (() => {
              const log = drilldownSelectedItem.log;
              return (
                <Box marginTop={1} flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
                  <Box flexDirection="row" gap={2}>
                    <Text bold>{log.level.toUpperCase()}</Text>
                    <Text>{log.message}</Text>
                  </Box>
                  <Text>
                    <Text dimColor>Time: </Text>
                    <Text>{new Date(log.time).toISOString()}</Text>
                  </Text>
                  {log.traceId && <Text dimColor>Trace: {log.traceId}</Text>}
                  {log.spanId && <Text dimColor>Span: {log.spanId}</Text>}
                  {log.attributes && Object.keys(log.attributes).length > 0 && (
                    <Box marginTop={1} flexDirection="column">
                      <Text bold>Attributes</Text>
                      {Object.entries(log.attributes).slice(0, 10).map(([k, v]) => (
                        <Text key={k} dimColor>
                          {truncate(k, 18)}: {truncate(String(v), 40)}
                        </Text>
                      ))}
                    </Box>
                  )}
                </Box>
              );
            })()
          )}
        </Box>
      ) : (
      <Box flexDirection="row" gap={2}>
        <Box
          flexDirection="column"
          width="55%"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          paddingY={0}
        >
          <Box marginTop={0} marginBottom={1}>
            <Text key="list-title" bold>
              {viewMode === 'trace'
                ? 'Recent traces'
                : viewMode === 'span'
                  ? 'Recent spans'
                  : viewMode === 'service-summary'
                    ? 'Service summary'
                    : viewMode === 'errors'
                      ? 'Recent errors'
                      : 'Recent logs'}
            </Text>
            {filterErrorsOnly && (
              <Text key="errors-only-label" color="red">
                {' '}
                (errors only)
              </Text>
            )}
            {searchQuery && (
              <Text key="search-label" dimColor>
                {' '}
                /{searchQuery}
              </Text>
            )}
          </Box>

            <>
              {viewMode === 'trace' ? (
                filteredSummaries.length === 0 ? (
                  <>
                    <Box flexDirection="column">
                      <Text dimColor>
                        No traces yet. Call a traced function or hit an endpoint
                        to see them here.
                      </Text>
                      <Text dimColor>
                        Tip: trace() your handlers with autotel to get spans.
                      </Text>
                    </Box>
                    {Array.from({ length: Math.max(0, LIST_HEIGHT - 2) }).map((_, i) => (
                      <Box key={`pad-${i}`}><Text> </Text></Box>
                    ))}
                  </>
                ) : (
                  <>
                    {filteredSummaries.slice(0, 20).map((t, i) => {
                      const isSel = i === selected;
                      return (
                        <Box key={t.traceId} flexDirection="row">
                          <Text color={isSel ? 'cyan' : undefined}>
                            {isSel ? '▸ ' : '  '}
                          </Text>
                          <Text color={t.hasError ? 'red' : 'yellow'} bold={isSel}>
                            {truncate(t.rootName, 28)}
                          </Text>
                          <Text dimColor>
                            {'  '}{t.spans.length} spans
                          </Text>
                          <Text color="green">
                            {'  '}{formatDurationMs(t.durationMs)}
                          </Text>
                          <Text dimColor>
                            {'  '}{formatRelative(t.lastEndTime)}
                          </Text>
                          <Text dimColor>{'  '}{t.traceId.slice(0, 12)}…</Text>
                          {t.hasError && <Text color="red"> ●</Text>}
                        </Box>
                      );
                    })}
                    {Array.from({ length: Math.max(0, LIST_HEIGHT - Math.min(filteredSummaries.length, 20)) }).map((_, i) => (
                      <Box key={`pad-${i}`}><Text> </Text></Box>
                    ))}
                  </>
                )
              ) : viewMode === 'span' ? (
                filteredSpans.length === 0 ? (
                  <>
                    <Box flexDirection="column">
                      <Text dimColor>
                        No spans yet. Call a traced function or hit an endpoint to
                        see them here.
                      </Text>
                      <Text dimColor>
                        Tip: trace() your handlers with autotel to get spans.
                      </Text>
                    </Box>
                    {Array.from({ length: Math.max(0, LIST_HEIGHT - 2) }).map((_, i) => (
                      <Box key={`pad-${i}`}><Text> </Text></Box>
                    ))}
                  </>
                ) : (
                  <>
                    {filteredSpans.slice(0, 20).map((s, i) => {
                      const isSel = i === selected;
                      const svcName = spanServiceName(s);
                      const svcColor = getServiceColor(svcName);
                      const statusColor =
                        s.status === 'ERROR'
                          ? 'red'
                          : s.durationMs > 500
                            ? 'yellow'
                            : 'green';
                      return (
                        <Box
                          key={`${s.spanId}-${s.startTime}`}
                          flexDirection="row"
                        >
                          <Text color={isSel ? 'cyan' : undefined}>
                            {isSel ? '› ' : '  '}
                          </Text>
                          <Text color={colors ? statusColor : undefined}>
                            {truncate(s.name, 26)}
                          </Text>
                          <Text color={svcColor}> {truncate(svcName, 10)}</Text>
                          <Text dimColor> {formatDurationMs(s.durationMs)}</Text>
                          <Text dimColor> {formatRelative(s.endTime)}</Text>
                        </Box>
                      );
                    })}
                    {Array.from({ length: Math.max(0, LIST_HEIGHT - Math.min(filteredSpans.length, 20)) }).map((_, i) => (
                      <Box key={`pad-${i}`}><Text> </Text></Box>
                    ))}
                  </>
                )
              ) : viewMode === 'service-summary' ? (
                serviceStats.length === 0 ? (
                  <>
                    <Box flexDirection="column">
                      <Text dimColor>
                        No service stats yet. Add `service.name` attributes to
                        spans.
                      </Text>
                    </Box>
                    {Array.from({ length: Math.max(0, LIST_HEIGHT - 1) }).map((_, i) => (
                      <Box key={`pad-${i}`}><Text> </Text></Box>
                    ))}
                  </>
                ) : (
                  <>
                    {serviceStats.slice(0, 20).map((svc, i) => {
                      const isSel = i === selected;
                      const errorRate = svc.total
                        ? (svc.errors / svc.total) * 100
                        : 0;
                      return (
                        <Box key={svc.serviceName} flexDirection="row">
                          <Text color={isSel ? 'cyan' : undefined}>
                            {isSel ? '› ' : '  '}
                          </Text>
                          <Text>{truncate(svc.serviceName, 16)}</Text>
                          <Text dimColor>
                            {' '}
                            {svc.errors}/{svc.total}
                          </Text>
                          <Text dimColor> {errorRate.toFixed(0)}%</Text>
                          <Text dimColor> p95 {formatDurationMs(svc.p95Ms)}</Text>
                        </Box>
                      );
                    })}
                    {Array.from({ length: Math.max(0, LIST_HEIGHT - Math.min(serviceStats.length, 20)) }).map((_, i) => (
                      <Box key={`pad-${i}`}><Text> </Text></Box>
                    ))}
                  </>
                )
              ) : viewMode === 'errors' ? (
                filteredErrorSummaries.length === 0 ? (
                  <>
                    <Box flexDirection="column">
                      <Text dimColor>No errors yet.</Text>
                    </Box>
                    {Array.from({ length: Math.max(0, LIST_HEIGHT - 1) }).map((_, i) => (
                      <Box key={`pad-${i}`}><Text> </Text></Box>
                    ))}
                  </>
                ) : (
                  <>
                    {filteredErrorSummaries.slice(0, 20).map((e, i) => {
                      const isSel = i === selected;
                      return (
                        <Box key={e.traceId} flexDirection="row">
                          <Text color={isSel ? 'cyan' : undefined}>
                            {isSel ? '› ' : '  '}
                          </Text>
                          <Text color="red">{truncate(e.rootName, 16)}</Text>
                          <Text dimColor> {truncate(e.serviceName, 10)}</Text>
                          {e.route && (
                            <Text dimColor> {truncate(e.route, 14)}</Text>
                          )}
                          {typeof e.statusCode === 'number' && (
                            <Text dimColor> {e.statusCode}</Text>
                          )}
                          <Text dimColor> ({e.errorCount})</Text>
                        </Box>
                      );
                    })}
                    {Array.from({ length: Math.max(0, LIST_HEIGHT - Math.min(filteredErrorSummaries.length, 20)) }).map((_, i) => (
                      <Box key={`pad-${i}`}><Text> </Text></Box>
                    ))}
                  </>
                )
              ) : filteredLogs.length === 0 ? (
                <>
                  <Box flexDirection="column">
                    <Text dimColor>
                      No logs yet. Emit request logs or canonical log lines to see
                      them here.
                    </Text>
                    <Text dimColor>
                      Tip: hook getTerminalLogStream() into your canonical log
                      line drain.
                    </Text>
                  </Box>
                  {Array.from({ length: Math.max(0, LIST_HEIGHT - 2) }).map((_, i) => (
                    <Box key={`pad-${i}`}><Text> </Text></Box>
                  ))}
                </>
              ) : (
                <>
                  {filteredLogs.slice(0, 20).map((log, i) => {
                    const isSel = i === selected;
                    const levelColor =
                      log.level === 'error'
                        ? 'red'
                        : log.level === 'warn'
                          ? 'yellow'
                          : log.level === 'debug'
                            ? 'gray'
                            : 'green';
                    return (
                      <Box key={`${log.time}-${i}`} flexDirection="row">
                        <Text color={isSel ? 'cyan' : undefined}>
                          {isSel ? '› ' : '  '}
                        </Text>
                        <Text color={colors ? levelColor : undefined}>
                          {truncate(log.level.toUpperCase(), 5)}
                        </Text>
                        <Text> </Text>
                        <Text>{truncate(log.message, 32)}</Text>
                      </Box>
                    );
                  })}
                  {Array.from({ length: Math.max(0, LIST_HEIGHT - Math.min(filteredLogs.length, 20)) }).map((_, i) => (
                    <Box key={`pad-${i}`}><Text> </Text></Box>
                  ))}
                </>
              )}
            </>
        </Box>

        <Box
          flexDirection="column"
          width="45%"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          paddingY={0}
        >
            <>
              <Box marginBottom={1}>
                <Text bold>Details</Text>
              </Box>

              {viewMode === 'errors' ? (
                  (() => {
                    const e = filteredErrorSummaries[selected] ?? null;
                    if (!e)
                      return (
                        <Text dimColor>Select an error to view details.</Text>
                      );
                    return (
                      <>
                        <Text>
                          <Text dimColor>Trace: </Text>
                          <Text>{e.traceId}</Text>
                        </Text>
                        <Text dimColor>
                          Service: {e.serviceName}
                          {e.route ? ` • Route: ${e.route}` : ''}
                          {typeof e.statusCode === 'number'
                            ? ` • Status: ${e.statusCode}`
                            : ''}
                        </Text>
                        <Text dimColor>Errors: {e.errorCount}</Text>
                        <Text dimColor>
                          Press T to jump to trace view for this trace.
                        </Text>
                      </>
                    );
                  })()
                ) : viewMode === 'service-summary' ? (
                  (() => {
                    const svc = serviceStats[selected] ?? null;
                    if (!svc)
                      return (
                        <Text dimColor>Select a service to view details.</Text>
                      );
                    return (
                      <>
                        <Text>
                          <Text dimColor>Service: </Text>
                          <Text>{svc.serviceName}</Text>
                        </Text>
                        <Text dimColor>
                          Spans: {svc.total} | Errors: {svc.errors} | Avg:{' '}
                          {formatDurationMs(svc.avgMs)} | P95:{' '}
                          {formatDurationMs(svc.p95Ms)}
                        </Text>

                        <Box marginTop={1} flexDirection="column">
                          <Text bold>Top routes</Text>
                          {selectedServiceRouteStats.length === 0 ? (
                            <Text dimColor>(no http.route)</Text>
                          ) : (
                            selectedServiceRouteStats.map((r) => (
                              <Text key={r.route} dimColor>
                                {truncate(r.route, 20)} {r.errors}/{r.total} p95{' '}
                                {formatDurationMs(r.p95Ms)}
                              </Text>
                            ))
                          )}
                        </Box>

                        <Box marginTop={1} flexDirection="column">
                          <Text bold>Hot spans</Text>
                          {selectedServiceHotSpans.length === 0 ? (
                            <Text dimColor>(no spans)</Text>
                          ) : (
                            selectedServiceHotSpans.map((h) => (
                              <Text key={h.name} dimColor>
                                {truncate(h.name, 20)} p95{' '}
                                {formatDurationMs(h.p95Ms)} ({h.count}x)
                              </Text>
                            ))
                          )}
                        </Box>
                      </>
                    );
                  })()
                ) : viewMode === 'log' ? (
                  (() => {
                    const log = filteredLogs[selected] ?? null;
                    if (!log) {
                      return (
                        <Text dimColor>Select a log to view details.</Text>
                      );
                    }
                    return (
                      <>
                        <Text>
                          <Text dimColor>Level: </Text>
                          <Text>{log.level.toUpperCase()}</Text>
                        </Text>
                        <Text>
                          <Text dimColor>Time: </Text>
                          <Text>{new Date(log.time).toISOString()}</Text>
                        </Text>
                        <Text>
                          <Text dimColor>Message: </Text>
                          <Text>{log.message}</Text>
                        </Text>
                        {log.traceId && (
                          <Text dimColor>Trace: {log.traceId}</Text>
                        )}
                        {log.spanId && <Text dimColor>Span: {log.spanId}</Text>}
                        {log.attributes &&
                          Object.keys(log.attributes).length > 0 && (
                            <Box marginTop={1} flexDirection="column">
                              <Text bold>Attributes</Text>
                              {Object.entries(log.attributes)
                                .slice(0, 10)
                                .map(([k, v]) => (
                                  <Text key={k} dimColor>
                                    {truncate(k, 18)}: {truncate(String(v), 40)}
                                  </Text>
                                ))}
                            </Box>
                          )}
                        {timelineItems.length > 0 && (
                          <Box marginTop={1} flexDirection="column">
                            <Text bold>Timeline (trace)</Text>
                            {timelineItems.slice(0, 10).map((item, idx) => {
                              const relMs =
                                item.time -
                                (selectedTraceSummary?.spans[0]?.startTime ??
                                  item.time);
                              if (item.type === 'span' && item.span) {
                                return (
                                  <Text key={`span-${idx}`} dimColor>
                                    +{relMs}ms span{' '}
                                    {truncate(item.span.name, 20)}
                                  </Text>
                                );
                              }
                              if (item.type === 'log' && item.log) {
                                return (
                                  <Text key={`log-${idx}`}>
                                    +{relMs}ms log{' '}
                                    {truncate(item.log.message, 24)}
                                  </Text>
                                );
                              }
                              return null;
                            })}
                          </Box>
                        )}
                      </>
                    );
                  })()
                ) : currentSpan ? (
                  <>
                    <Text>
                      <Text dimColor>Name: </Text>
                      <Text>{currentSpan.name}</Text>
                    </Text>
                    <Text>
                      <Text dimColor>Status: </Text>
                      <Text
                        color={currentSpan.status === 'ERROR' ? 'red' : 'green'}
                      >
                        {currentSpan.status}
                      </Text>
                    </Text>
                    <Text>
                      <Text dimColor>Duration: </Text>
                      <Text>
                        {formatDurationMs(currentSpan.durationMs)}
                        {perSpanNameStats.byName.has(currentSpan.name) &&
                          (() => {
                            const p = perSpanNameStats.byName.get(
                              currentSpan.name,
                            )!;
                            const ratio =
                              p.avgMs > 0
                                ? currentSpan.durationMs / p.avgMs
                                : 1;
                            if (ratio >= 1.5)
                              return ` (${ratio.toFixed(1)}x avg)`;
                            return '';
                          })()}
                      </Text>
                    </Text>
                    <Text dimColor>Trace: {currentSpan.traceId}</Text>
                    <Text dimColor>Span: {currentSpan.spanId}</Text>
                    {currentSpan.parentSpanId && (
                      <Text dimColor>Parent: {currentSpan.parentSpanId}</Text>
                    )}
                    {currentSpan.kind && (
                      <Text dimColor>Kind: {currentSpan.kind}</Text>
                    )}

                    {(() => {
                      const { key: keyAttrs, rest: restAttrs } =
                        keyAttrsAndRest(currentSpan.attributes);
                      return (
                        <>
                          {keyAttrs.length > 0 && (
                            <Box marginTop={1} flexDirection="column">
                              <Text bold>Key attributes</Text>
                              {keyAttrs.slice(0, 6).map(([k, v]) => (
                                <Text key={k} dimColor>
                                  {truncate(k, 18)}: {truncate(String(v), 28)}
                                </Text>
                              ))}
                            </Box>
                          )}
                          {restAttrs.length > 0 && (
                            <Box marginTop={1} flexDirection="column">
                              <Text bold>Attributes</Text>
                              {restAttrs.slice(0, 8).map(([k, v]) => (
                                <Text key={k} dimColor>
                                  {truncate(k, 18)}: {truncate(String(v), 28)}
                                </Text>
                              ))}
                            </Box>
                          )}
                          {keyAttrs.length === 0 && restAttrs.length === 0 && (
                            <Text dimColor>(no attributes)</Text>
                          )}
                        </>
                      );
                    })()}

                    {waterfallSpans.length > 0 && drilldownTraceId != null && (
                      <Box marginTop={1} flexDirection="column">
                        <Text bold>Waterfall</Text>
                        {waterfallSpans.slice(0, 10).map((w) => {
                          const barLen =
                            Math.round(
                              (w.span.durationMs / waterfallMaxMs) * barWidth,
                            ) || 1;
                          const bar = '█'.repeat(barLen);
                          const indent = '  '.repeat(w.depth);
                          return (
                            <Box key={w.span.spanId} flexDirection="row">
                              <Text dimColor>{indent}</Text>
                              <Text>{truncate(w.span.name, 12)}</Text>
                              <Text dimColor> {bar}</Text>
                              <Text dimColor>
                                {' '}
                                {formatDurationMs(w.span.durationMs)}
                              </Text>
                            </Box>
                          );
                        })}
                      </Box>
                    )}
                  </>
                ) : (
                  <Text dimColor>Select a trace or span to view details.</Text>
                )}
            </>
        </Box>
      </Box>
      ))}

      {showStats && (
        <Box marginTop={1} borderStyle="round" borderColor="gray" paddingX={1}>
          <Text dimColor>
            Spans: {stats.total} | Span errors: {stats.errors} | Logs:{' '}
            {logStats.total} | Log errors: {logStats.errors} | Avg:{' '}
            {formatDurationMs(stats.avg)} | P95: {formatDurationMs(stats.p95)}
          </Text>
        </Box>
      )}
    </Box>
  );
}

// Global streaming processor for auto-wiring
let globalStreamingProcessor: StreamingSpanProcessor | null = null;

/**
 * Check if a TracerProvider has an addSpanProcessor method
 * (Node.js SDK providers have this, but API-level providers don't)
 */
function canAddSpanProcessor(
  provider: TracerProvider,
): provider is TracerProvider & {
  addSpanProcessor: (processor: unknown) => void;
} {
  return (
    typeof provider === 'object' &&
    provider !== null &&
    'addSpanProcessor' in provider &&
    typeof (provider as { addSpanProcessor?: unknown }).addSpanProcessor ===
      'function'
  );
}

/**
 * Render the terminal dashboard
 *
 * Automatically wires up a streaming processor from the current tracer provider
 * if no stream is provided. Otherwise uses the provided stream.
 *
 * @param options - Dashboard configuration options
 * @param stream - Optional manual stream (for advanced use cases)
 *
 * @example Auto-wire (recommended)
 * ```typescript
 * import { init } from 'autotel'
 * import { renderTerminal } from 'autotel-terminal'
 *
 * init({ service: 'my-app' })
 * renderTerminal() // Automatically creates stream from current tracer provider
 * ```
 *
 * @example Manual stream
 * ```typescript
 * import { StreamingSpanProcessor } from 'autotel-terminal'
 * import { createTerminalSpanStream } from 'autotel-terminal'
 *
 * const processor = new StreamingSpanProcessor(baseProcessor)
 * const stream = createTerminalSpanStream(processor)
 * renderTerminal({}, stream)
 * ```
 */
export function renderTerminal(
  options: TerminalOptions = {},
  stream?: TerminalSpanStream,
): void {
  const title = options.title ?? 'Autotel Trace Inspector';
  const showStats = options.showStats !== false;
  const maxSpans = options.maxSpans ?? 100;
  const colors = options.colors ?? Boolean(process.stdout.isTTY);
  const aiConfig = options.ai;

  // Check if stdin supports raw mode (needed for keyboard input)
  // If not, we disable stdin to prevent Ink from throwing an error
  const stdinOption = process.stdin.isTTY ? process.stdin : undefined;

  // If stream provided, use it directly
  if (stream) {
    try {
      render(
        <Dashboard
          title={title}
          showStats={showStats}
          maxSpans={maxSpans}
          colors={colors}
          stream={stream}
          logStream={getTerminalLogStream()}
          aiConfig={aiConfig}
        />,
        { stdin: stdinOption },
      );
    } catch (error) {
      console.error('[autotel-terminal] Failed to render dashboard:', error);
    }
    return;
  }

  // Otherwise, auto-wire from current tracer provider
  let provider: TracerProvider;
  try {
    provider = getAutotelTracerProvider();
  } catch (error) {
    console.error(
      '[autotel-terminal] Failed to get tracer provider. Call init() first or provide a stream.',
      error,
    );
    return;
  }

  if (!provider) {
    console.error(
      '[autotel-terminal] No tracer provider found. Call init() first or provide a stream.',
    );
    return;
  }

  // Check if provider supports addSpanProcessor (Node.js SDK providers do)
  if (!canAddSpanProcessor(provider)) {
    console.error(
      '[autotel-terminal] TracerProvider does not support addSpanProcessor. Provide a stream manually.',
    );
    return;
  }

  // Create streaming processor that doesn't wrap anything (just streams)
  // This way it doesn't interfere with existing processors
  globalStreamingProcessor = new StreamingSpanProcessor(null);
  const terminalStream = createTerminalSpanStream(globalStreamingProcessor);

  // Add streaming processor to provider
  provider.addSpanProcessor(globalStreamingProcessor);

  try {
    render(
      <Dashboard
        title={title}
        showStats={showStats}
        maxSpans={maxSpans}
        colors={colors}
        stream={terminalStream}
        logStream={getTerminalLogStream()}
      />,
      { stdin: stdinOption },
    );
  } catch (error) {
    console.error('[autotel-terminal] Failed to render dashboard:', error);
  }
}

// Re-export types and utilities
export type { TerminalSpanEvent, TerminalSpanStream, SpanEvent, SpanLink } from './span-stream';
export { StreamingSpanProcessor } from './streaming-processor';
export { createTerminalSpanStream } from './span-stream';
export { getTerminalLogStream } from './log-stream';
export type { TerminalLogStream } from './log-stream';
export type { TerminalLogEvent } from './lib/log-model';

// Re-export OpenTelemetry types for advanced users
export type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
export { SpanStatusCode, SpanKind } from 'autotel';

// Re-export PrettyConsoleExporter for convenience
export {
  PrettyConsoleExporter,
  type PrettyConsoleExporterOptions,
} from 'autotel/exporters';
