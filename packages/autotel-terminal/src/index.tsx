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
} from './lib/trace-model';
import { formatDurationMs, formatRelative, truncate } from './lib/format';
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
import { buildErrorSummaries } from './lib/error-model';
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
  const [viewMode, setViewMode] = useState<
    'trace' | 'span' | 'log' | 'service-summary' | 'errors'
  >('trace');
  const [spanFilters, setSpanFilters] = useState<SpanFilterState>({
    statusGroup: 'all',
  });
  const [drilldownTraceId, setDrilldownTraceId] = useState<string | null>(null);
  const [drilldownSelectedIndex, setDrilldownSelectedIndex] = useState(0);
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
  const [aiActive, setAiActive] = useState(false);
  const [aiMessages, setAiMessages] = useState<ChatMessage[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiState, setAiState] = useState<AIState>({ status: 'unconfigured' });
  const [aiInputMode, setAiInputMode] = useState(false);
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
    const tools = createTelemetryTools(toolCtx);

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

      setAiState({ status: 'idle' });
    } catch (error: unknown) {
      if (abort.signal.aborted) {
        setAiState({ status: 'idle' });
        return;
      }
      setAiState({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
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
            setAiActive(false);
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
        setAiActive((v) => !v);
        if (aiActive) {
          setAiInputMode(false);
        } else {
          // Only enter input mode if a provider is configured
          if (aiState.status !== 'unconfigured') {
            setAiInputMode(true);
          }
        }
        return;
      }
      if (key.escape) {
        if (drilldownTraceId == null) {
          setSearchMode(false);
        } else {
          setDrilldownTraceId(null);
          setDrilldownSelectedIndex(0);
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
            setDrilldownSelectedIndex((i) => Math.max(0, i - 1));
          } else {
            setDrilldownSelectedIndex((i) => Math.min(listLength - 1, i + 1));
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
      }
      if (input === 'l') {
        setViewMode((m) => (m === 'log' ? 'trace' : 'log'));
        setSelected(0);
        setDrilldownTraceId(null);
        setDrilldownSelectedIndex(0);
      }
      if (input === 'v') {
        setViewMode((m) =>
          m === 'service-summary' ? 'trace' : 'service-summary',
        );
        setSelected(0);
        setDrilldownTraceId(null);
        setDrilldownSelectedIndex(0);
      }
      if (input === 'E') {
        setViewMode((m) => (m === 'errors' ? 'trace' : 'errors'));
        setSelected(0);
        setDrilldownTraceId(null);
        setDrilldownSelectedIndex(0);
      }
      if (input === 'c') {
        setSpans([]);
        setLogs([]);
        setSelected(0);
        setDrilldownTraceId(null);
        setDrilldownSelectedIndex(0);
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
      }
      if (input === 'S') {
        const svc = currentSpan?.attributes?.['service.name'];
        if (typeof svc === 'string' && svc.trim()) {
          setSpanFilters((prev) => ({ ...prev, serviceName: svc }));
          setSelected(0);
          setDrilldownTraceId(null);
          setDrilldownSelectedIndex(0);
        }
      }
      if (input === 'R') {
        const route = currentSpan?.attributes?.['http.route'];
        if (typeof route === 'string' && route.trim()) {
          setSpanFilters((prev) => ({ ...prev, route }));
          setSelected(0);
          setDrilldownTraceId(null);
          setDrilldownSelectedIndex(0);
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
        <Text color={isSel ? 'cyan' : undefined}>{isSel ? '› ' : '  '}</Text>
        <Text dimColor>{prefix}</Text>
        <Text color={colors ? statusColor : undefined}>
          {truncate(node.span.name, 24)}
        </Text>
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
      borderStyle="round"
      padding={1}
      borderColor={colors ? 'cyan' : undefined}
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

      {showHelp ? (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          marginBottom={1}
        >
          <Text bold>Shortcuts</Text>
          <Text dimColor>Navigation: ↑/↓, Enter, Esc</Text>
          <Text dimColor>
            Views: t (trace/spans), l (logs), v (services), E (errors)
          </Text>
          <Text dimColor>Search: / (Tab autocompletes traceId)</Text>
          <Text dimColor>
            Filters: e (errors-only), S (service), R (route), H (status), f
            (traceId), x (clear)
          </Text>
          <Text dimColor>
            Capture: p (pause), r (record snapshot), J (export trace JSON)
          </Text>
          <Text dimColor>AI: a (toggle AI panel)</Text>
          <Text dimColor>Jump: T (trace for item), L (logs for item)</Text>
          <Text dimColor>
            Drill-down: Enter (open trace), Tab (cycle tabs), Esc (back)
          </Text>
          <Text dimColor>Other: c (clear), ? (help), Ctrl+C (exit)</Text>
        </Box>
      ) : (
        <Box
          marginBottom={1}
          flexDirection="row"
          justifyContent="space-between"
        >
          {searchMode ? (
            <Text key="search" color="cyan">
              Search: {searchQuery || '(type to filter)'}
              <Text dimColor> (Tab: match traceId, Esc: cancel)</Text>
            </Text>
          ) : traceIdMode ? (
            <Text key="traceid-input" color="yellow">
              TraceId: {traceIdInput || '(type prefix, Tab to complete)'}
              {traceIdInput.length >= 2 && (
                <Text dimColor>
                  {' '}
                  →{' '}
                  {traceSummaries
                    .find((t) =>
                      t.traceId
                        .toLowerCase()
                        .startsWith(traceIdInput.toLowerCase()),
                    )
                    ?.traceId.slice(0, 16) ?? 'no match'}
                  …
                </Text>
              )}
            </Text>
          ) : drilldownTraceId == null ? (
            <Text key="controls" dimColor>
              ↑/↓ select • Enter open • Esc back • t spans • l logs • v svc • E
              errors • T trace • L logs • / search • f traceId • p pause • r
              record • e errors • c clear • ? help
            </Text>
          ) : (
            <Text key="controls" dimColor>
              ↑/↓ select • Tab cycle tabs • Esc back • T trace • L logs • a AI •
              ? help
            </Text>
          )}
          <Text key="count" dimColor>
            {viewMode === 'trace'
              ? `traces ${filteredSummaries.length}/${traceSummaries.length}`
              : viewMode === 'span'
                ? `spans ${filteredSpans.length}/${spans.length}`
                : viewMode === 'service-summary'
                  ? `services ${serviceStats.length}/${serviceStats.length}`
                  : viewMode === 'errors'
                    ? `errors ${filteredErrorSummaries.length}/${errorSummaries.length}`
                    : `logs ${filteredLogs.length}/${logs.length}`}
          </Text>
        </Box>
      )}

      {(spanFilters.serviceName ||
        spanFilters.route ||
        spanFilters.statusGroup !== 'all' ||
        spanFilters.traceId) && (
        <Box marginBottom={1}>
          <Text dimColor>
            filters:
            {spanFilters.serviceName
              ? ` service=${spanFilters.serviceName}`
              : ''}
            {spanFilters.route ? ` route=${spanFilters.route}` : ''}
            {spanFilters.statusGroup && spanFilters.statusGroup !== 'all'
              ? ` status=${spanFilters.statusGroup}`
              : ''}
            {spanFilters.traceId
              ? ` trace=${spanFilters.traceId.slice(0, 8)}…`
              : ''}
          </Text>
        </Box>
      )}

      <Box flexDirection="row" gap={2}>
        <Box
          flexDirection="column"
          width="55%"
          borderStyle="single"
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

          {drilldownTraceId != null && (
            <>
              {/* Trace header */}
              <Box marginBottom={0} flexDirection="row" gap={2}>
                <Text color="yellow">
                  {drilldownSummary?.rootName ?? 'unknown'}
                </Text>
                <Text dimColor>{drilldownTraceId.slice(0, 16)}…</Text>
                <Text color="green">
                  {drilldownSummary
                    ? formatDurationMs(drilldownSummary.durationMs)
                    : '?'}
                </Text>
                <Text dimColor>
                  {drilldownSpans.length} spans • {drilldownLogs.length} logs
                </Text>
              </Box>
              {/* Tabs */}
              <Box marginBottom={0} flexDirection="row" gap={2}>
                <Text
                  color={drilldownTab === 'timeline' ? 'yellow' : undefined}
                  dimColor={drilldownTab !== 'timeline'}
                  underline={drilldownTab === 'timeline'}
                >
                  Timeline
                </Text>
                <Text
                  color={drilldownTab === 'spans' ? 'yellow' : undefined}
                  dimColor={drilldownTab !== 'spans'}
                  underline={drilldownTab === 'spans'}
                >
                  Spans ({drilldownSpans.length})
                </Text>
                <Text
                  color={drilldownTab === 'logs' ? 'yellow' : undefined}
                  dimColor={drilldownTab !== 'logs'}
                  underline={drilldownTab === 'logs'}
                >
                  Logs ({drilldownLogs.length})
                </Text>
              </Box>
            </>
          )}

          {drilldownTraceId != null &&
            drilldownTab === 'timeline' &&
            drilldownTimeline.map((item, i) => {
              const isSel = i === drilldownSelectedIndex;
              if (item.type === 'span' && item.span) {
                const s = item.span;
                const node = drilldownTree.find(
                  (n) => n.span.spanId === s.spanId,
                );
                const depth = node?.depth ?? 0;
                const indent = '  '.repeat(depth);
                const barLen = Math.max(
                  1,
                  Math.round(
                    (s.durationMs /
                      Math.max(1, drilldownSummary?.durationMs ?? 1)) *
                      10,
                  ),
                );
                const bar = '█'.repeat(barLen);
                return (
                  <Box key={`${s.spanId}-${i}`}>
                    <Text
                      backgroundColor={isSel ? 'gray' : undefined}
                      color={isSel ? 'white' : undefined}
                    >
                      {isSel ? '▸' : ' '} {indent}
                      <Text color="green">{bar}</Text> {s.name}{' '}
                      <Text dimColor>
                        {formatDurationMs(s.durationMs)}
                        {s.kind ? ` ${s.kind}` : ''}
                      </Text>
                    </Text>
                  </Box>
                );
              } else if (item.type === 'log' && item.log) {
                const l = item.log;
                const levelColor =
                  l.level === 'error'
                    ? 'red'
                    : l.level === 'warn'
                      ? 'yellow'
                      : 'blue';
                const relTime = drilldownSummary
                  ? `+${formatDurationMs(l.time - (drilldownSummary.spans[0]?.startTime ?? l.time))}`
                  : '';
                return (
                  <Box key={`log-${i}`}>
                    <Text
                      backgroundColor={isSel ? 'gray' : undefined}
                      color={isSel ? 'white' : undefined}
                    >
                      {isSel ? '▸' : ' '}
                      {'  '}
                      <Text color={levelColor}>
                        ℹ {l.level.toUpperCase()}
                      </Text>{' '}
                      <Text dimColor>{truncate(l.message, 40)}</Text>{' '}
                      <Text dimColor>{relTime}</Text>
                    </Text>
                  </Box>
                );
              }
              return null;
            })}

          {drilldownTraceId != null &&
            drilldownTab === 'spans' &&
            drilldownTree.map((node, i) => renderTreeRow(node, i))}

          {drilldownTraceId != null &&
            drilldownTab === 'logs' &&
            drilldownLogs.map((log, i) => {
              const isSel = i === drilldownSelectedIndex;
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
                    backgroundColor={isSel ? 'gray' : undefined}
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

          {drilldownTraceId == null && (
            <>
              {viewMode === 'trace' ? (
                filteredSummaries.length === 0 ? (
                  <Box flexDirection="column">
                    <Text dimColor>
                      No traces yet. Call a traced function or hit an endpoint
                      to see them here.
                    </Text>
                    <Text dimColor>
                      Tip: trace() your handlers with autotel to get spans.
                    </Text>
                  </Box>
                ) : (
                  <>
                    {drilldownTraceId == null
                      ? filteredSummaries.slice(0, 20).map((t, i) => {
                          const isSel = i === selected;
                          return (
                            <Box key={t.traceId} flexDirection="row">
                              <Text color={isSel ? 'cyan' : undefined}>
                                {isSel ? '› ' : '  '}
                              </Text>
                              <Text color={t.hasError ? 'red' : undefined}>
                                {truncate(t.rootName, 20)}
                              </Text>
                              <Text dimColor>
                                {' '}
                                {formatDurationMs(t.durationMs)}
                              </Text>
                              <Text dimColor> {truncate(t.traceId, 8)}</Text>
                              <Text dimColor>
                                {' '}
                                {formatRelative(t.lastEndTime)}
                              </Text>
                            </Box>
                          );
                        })
                      : traceTree
                          .slice(0, 20)
                          .map((node, i) => renderTreeRow(node, i))}
                  </>
                )
              ) : viewMode === 'span' ? (
                filteredSpans.length === 0 ? (
                  <Box flexDirection="column">
                    <Text dimColor>
                      No spans yet. Call a traced function or hit an endpoint to
                      see them here.
                    </Text>
                    <Text dimColor>
                      Tip: trace() your handlers with autotel to get spans.
                    </Text>
                  </Box>
                ) : (
                  filteredSpans.slice(0, 20).map((s, i) => {
                    const isSel = i === selected;
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
                        <Text dimColor> {formatDurationMs(s.durationMs)}</Text>
                        <Text dimColor> {formatRelative(s.endTime)}</Text>
                      </Box>
                    );
                  })
                )
              ) : viewMode === 'service-summary' ? (
                serviceStats.length === 0 ? (
                  <Box flexDirection="column">
                    <Text dimColor>
                      No service stats yet. Add `service.name` attributes to
                      spans.
                    </Text>
                  </Box>
                ) : (
                  serviceStats.slice(0, 20).map((svc, i) => {
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
                  })
                )
              ) : viewMode === 'errors' ? (
                filteredErrorSummaries.length === 0 ? (
                  <Box flexDirection="column">
                    <Text dimColor>No errors yet.</Text>
                  </Box>
                ) : (
                  filteredErrorSummaries.slice(0, 20).map((e, i) => {
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
                  })
                )
              ) : filteredLogs.length === 0 ? (
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
              ) : (
                filteredLogs.slice(0, 20).map((log, i) => {
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
                })
              )}
            </>
          )}
        </Box>

        <Box
          flexDirection="column"
          width="45%"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          paddingY={0}
        >
          {aiActive ? (
            <>
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
                  <Text dimColor>
                    Set AI_PROVIDER and AI_MODEL env vars, or start Ollama
                    locally.
                  </Text>
                  <Text dimColor>Press 'a' to close this panel.</Text>
                </Box>
              ) : (
                <>
                  {aiMessages.length === 0 && aiState.status !== 'error' && (
                    <Text dimColor>
                      Ask a question about your telemetry data. Press Enter to
                      send.
                    </Text>
                  )}
                  {aiMessages.slice(-10).map((msg, i) => (
                    <Box
                      key={i}
                      flexDirection="column"
                      marginBottom={msg.role === 'assistant' ? 1 : 0}
                    >
                      <Text color={msg.role === 'user' ? 'cyan' : undefined}>
                        {msg.role === 'user' ? '> ' : ''}
                        {msg.content.slice(0, 500)}
                        {msg.content.length > 500 ? '...' : ''}
                      </Text>
                    </Box>
                  ))}
                  {aiState.status === 'error' && (
                    <Text color="red">Error: {aiState.message}</Text>
                  )}
                  <Box
                    marginTop={1}
                    borderStyle="single"
                    borderColor="cyan"
                    paddingX={1}
                  >
                    <Text color="cyan">&gt; </Text>
                    <Text>
                      {aiInput ||
                        (aiInputMode
                          ? '(type your question)'
                          : '(press a to focus)')}
                    </Text>
                  </Box>
                </>
              )}
            </>
          ) : (
            <>
              <Box marginBottom={1}>
                <Text bold>Details</Text>
              </Box>

              {drilldownTraceId != null &&
              drilldownSelectedItem?.type === 'span' &&
              drilldownSelectedItem.span ? (
                (() => {
                  const span = drilldownSelectedItem.span;
                  const { key: keyAttrs, rest: restAttrs } = keyAttrsAndRest(
                    span.attributes,
                  );
                  return (
                    <>
                      <Text>
                        <Text dimColor>Name: </Text>
                        <Text>{span.name}</Text>
                      </Text>
                      <Text>
                        <Text dimColor>Status: </Text>
                        <Text color={span.status === 'ERROR' ? 'red' : 'green'}>
                          {span.status}
                        </Text>
                      </Text>
                      <Text>
                        <Text dimColor>Duration: </Text>
                        <Text>{formatDurationMs(span.durationMs)}</Text>
                      </Text>
                      <Text dimColor>Trace: {span.traceId}</Text>
                      <Text dimColor>Span: {span.spanId}</Text>
                      {span.parentSpanId && (
                        <Text dimColor>Parent: {span.parentSpanId}</Text>
                      )}
                      {span.kind && <Text dimColor>Kind: {span.kind}</Text>}
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
                })()
              ) : drilldownTraceId != null &&
                drilldownSelectedItem?.type === 'log' &&
                drilldownSelectedItem.log ? (
                (() => {
                  const log = drilldownSelectedItem.log;
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
                    </>
                  );
                })()
              ) : drilldownTraceId == null ? null : (
                <Text dimColor>Select an item to view details.</Text>
              )}

              {drilldownTraceId == null &&
                (viewMode === 'errors' ? (
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
                ))}
            </>
          )}
        </Box>
      </Box>

      {showStats && (
        <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
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
export type { TerminalSpanEvent, TerminalSpanStream } from './span-stream';
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
