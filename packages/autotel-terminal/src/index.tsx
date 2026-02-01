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
}

const THROTTLE_MS = 50;
const MAX_TRACES = 50;
const NEW_ERROR_DISPLAY_MS = 2000;

interface DashboardProps {
  title: string;
  showStats: boolean;
  maxSpans: number;
  colors: boolean;
  stream: TerminalSpanStream;
}

function Dashboard({
  title,
  showStats,
  maxSpans,
  colors,
  stream,
}: DashboardProps): React.ReactElement {
  const [paused, setPaused] = useState(false);
  const [spans, setSpans] = useState<TerminalSpanEvent[]>([]);
  const [selected, setSelected] = useState(0);
  const [filterErrorsOnly, setFilterErrorsOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [viewMode, setViewMode] = useState<'trace' | 'span'>('trace');
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedSpanIndex, setSelectedSpanIndex] = useState(0);
  const [newErrorCount, setNewErrorCount] = useState(0);
  const [searchMode, setSearchMode] = useState(false);
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSpansRef = useRef<TerminalSpanEvent[]>([]);

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
      setSelectedTraceId(null);
    };
    const unsubscribe = stream.onSpanEnd((span) => {
      if (paused) return;
      if (span.status === 'ERROR') {
        setNewErrorCount((n) => n + 1);
        setTimeout(() => setNewErrorCount((n) => Math.max(0, n - 1)), NEW_ERROR_DISPLAY_MS);
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
  }, [stream, paused, maxSpans]);

  const traceMap = useMemo(
    () => buildTraceMap(spans, MAX_TRACES),
    [spans],
  );
  const traceSummaries = useMemo(
    () => buildTraceSummaries(traceMap),
    [traceMap],
  );
  const filteredSummaries = useMemo(
    () => filterTraceSummaries(traceSummaries, searchQuery, filterErrorsOnly),
    [traceSummaries, searchQuery, filterErrorsOnly],
  );
  const filteredSpans = useMemo(
    () => filterBySearch(spans, searchQuery, filterErrorsOnly),
    [spans, searchQuery, filterErrorsOnly],
  );

  const stats = useMemo(() => computeStats(spans), [spans]);
  const perSpanNameStats = useMemo(() => computePerSpanNameStats(spans), [spans]);

  const selectedTraceSummary =
    selectedTraceId == null
      ? filteredSummaries[selected] ?? null
      : filteredSummaries.find((t) => t.traceId === selectedTraceId) ?? null;
  const traceTree =
    selectedTraceSummary == null
      ? []
      : flattenTraceTree(buildTraceTree(selectedTraceSummary.spans));
  const waterfallSpans =
    selectedTraceSummary == null
      ? []
      : sortSpansForWaterfall(selectedTraceSummary.spans);

  const currentSpanInTrace =
    traceTree[selectedSpanIndex] ?? null;
  const currentSpanInFlat =
    filteredSpans[selected] ?? null;
  const selectedTraceSummaryForDetails =
    viewMode === 'trace' && selectedTraceId == null && filteredSummaries[selected]
      ? filteredSummaries[selected]!
      : null;
  const rootSpanOfSelectedTrace =
    selectedTraceSummaryForDetails != null && selectedTraceSummaryForDetails.spans.length > 0
      ? selectedTraceSummaryForDetails.spans.find(
          (s) =>
            !selectedTraceSummaryForDetails.spans.some(
              (p) => p.spanId === s.parentSpanId,
            ),
        ) ?? selectedTraceSummaryForDetails.spans[0]
      : null;
  const currentSpan =
    viewMode === 'trace'
      ? selectedTraceId == null
        ? rootSpanOfSelectedTrace ?? null
        : currentSpanInTrace?.span ?? null
      : currentSpanInFlat;

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
        if (key.backspace || key.delete) {
          setSearchQuery((q) => q.slice(0, -1));
        } else if (key.return) {
          setSearchMode(false);
        } else if (input && input.length === 1 && !key.ctrl && !key.meta) {
          setSearchQuery((q) => q + input);
        }
        return;
      }
      if (key.escape) {
        if (viewMode === 'trace' && selectedTraceId != null) {
          setSelectedTraceId(null);
          setSelectedSpanIndex(0);
        } else {
          setSearchMode(false);
        }
        return;
      }
      if (key.return && viewMode === 'trace' && selectedTraceId == null && filteredSummaries[selected]) {
        setSelectedTraceId(filteredSummaries[selected]!.traceId);
        setSelectedSpanIndex(0);
        return;
      }
      if (key.upArrow) {
        if (viewMode === 'trace') {
          if (selectedTraceId != null && traceTree.length > 0) {
            setSelectedSpanIndex((i) => Math.max(0, i - 1));
          } else {
            setSelected((i) => Math.max(0, i - 1));
            setSelectedSpanIndex(0);
          }
        } else {
          setSelected((i) => Math.max(0, i - 1));
        }
      }
      if (key.downArrow) {
        if (viewMode === 'trace') {
          if (selectedTraceId != null && selectedSpanIndex < traceTree.length - 1) {
            setSelectedSpanIndex((i) => Math.min(traceTree.length - 1, i + 1));
          } else if (selectedTraceId != null && traceTree.length > 0 && selectedSpanIndex >= traceTree.length - 1) {
            const nextIdx = filteredSummaries.findIndex((t) => t.traceId === selectedTraceId) + 1;
            if (nextIdx < filteredSummaries.length) {
              setSelected(nextIdx);
              setSelectedTraceId(filteredSummaries[nextIdx]!.traceId);
              setSelectedSpanIndex(0);
            }
          } else if (selectedTraceId == null) {
            setSelected((i) => Math.min(filteredSummaries.length - 1, i + 1));
            setSelectedSpanIndex(0);
          }
        } else {
          setSelected((i) => Math.min(filteredSpans.length - 1, i + 1));
        }
      }
      if (input === 'p') setPaused((p) => !p);
      if (input === 'e') setFilterErrorsOnly((v) => !v);
      if (input === 't') {
        setViewMode((m) => (m === 'trace' ? 'span' : 'trace'));
        setSelected(0);
        setSelectedTraceId(null);
        setSelectedSpanIndex(0);
      }
      if (input === 'c') {
        setSpans([]);
        setSelected(0);
        setSelectedTraceId(null);
        setSelectedSpanIndex(0);
        setNewErrorCount(0);
      }
    },
    { isActive: isRawModeSupported },
  );

  const headerRight = paused ? '[Paused]' : '[Live]';
  const showNewError = newErrorCount > 0;

  function renderTreeRow(node: SpanTreeNode, index: number): React.ReactElement {
    const isSel = viewMode === 'trace' && selectedTraceId != null && index === selectedSpanIndex;
    const prefix =
      node.depth === 0 ? '' : '  '.repeat(node.depth) + (node.children.length > 0 ? '├── ' : '└── ');
    const statusColor =
      node.span.status === 'ERROR' ? 'red' : node.span.durationMs > 500 ? 'yellow' : 'green';
    return (
      <Box key={`${node.span.spanId}-${node.span.startTime}`} flexDirection="row">
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
      return { key: [] as [string, unknown][], rest: [] as [string, unknown][] };
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
        <Text key="title" bold>🔭 {title}</Text>
        <Box flexDirection="row" gap={1}>
          {showNewError && (
            <Text key="newError" color="red">1 new error</Text>
          )}
          <Text key="status" color={paused ? 'yellow' : 'green'}>{headerRight}</Text>
        </Box>
      </Box>

      {showHelp ? (
        <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
          <Text bold>Shortcuts</Text>
          <Text dimColor>↑/↓   Select trace or span</Text>
          <Text dimColor>Enter  Open trace (trace view)</Text>
          <Text dimColor>Esc    Back to trace list / exit search</Text>
          <Text dimColor>t      Toggle trace view / span list</Text>
          <Text dimColor>/      Search by name</Text>
          <Text dimColor>p      Pause / resume</Text>
          <Text dimColor>e      Errors only</Text>
          <Text dimColor>c      Clear all</Text>
          <Text dimColor>?      This help</Text>
          <Text dimColor>Ctrl+C Exit</Text>
        </Box>
      ) : (
        <Box marginBottom={1} flexDirection="row" justifyContent="space-between">
          {searchMode ? (
            <Text key="search" color="cyan">Search: {searchQuery || '(type to filter)'}</Text>
          ) : (
            <Text key="controls" dimColor>
              ↑/↓ select • Enter open • Esc back • t view • / search • p pause • e errors • c clear • ? help
            </Text>
          )}
          <Text key="count" dimColor>
            {viewMode === 'trace' ? `traces ${filteredSummaries.length}/${traceSummaries.length}` : `spans ${filteredSpans.length}/${spans.length}`}
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
              {viewMode === 'trace' ? 'Recent traces' : 'Recent spans'}
            </Text>
            {filterErrorsOnly && <Text key="errors-only-label" color="red"> (errors only)</Text>}
            {searchQuery && <Text key="search-label" dimColor> /{searchQuery}</Text>}
          </Box>

          {viewMode === 'trace' ? (
            filteredSummaries.length === 0 ? (
              <Box flexDirection="column">
                <Text dimColor>No traces yet. Call a traced function or hit an endpoint to see them here.</Text>
                <Text dimColor>Tip: trace() your handlers with autotel to get spans.</Text>
              </Box>
            ) : (
              <>
                {selectedTraceId == null
                  ? filteredSummaries.slice(0, 20).map((t, i) => {
                      const isSel = i === selected;
                      return (
                        <Box key={t.traceId} flexDirection="row">
                          <Text color={isSel ? 'cyan' : undefined}>{isSel ? '› ' : '  '}</Text>
                          <Text color={t.hasError ? 'red' : undefined}>
                            {truncate(t.rootName, 20)}
                          </Text>
                          <Text dimColor> {formatDurationMs(t.durationMs)}</Text>
                          <Text dimColor> {truncate(t.traceId, 8)}</Text>
                          <Text dimColor> {formatRelative(t.lastEndTime)}</Text>
                        </Box>
                      );
                    })
                  : traceTree.slice(0, 20).map((node, i) => renderTreeRow(node, i))}
              </>
            )
          ) : filteredSpans.length === 0 ? (
            <Box flexDirection="column">
              <Text dimColor>No spans yet. Call a traced function or hit an endpoint to see them here.</Text>
              <Text dimColor>Tip: trace() your handlers with autotel to get spans.</Text>
            </Box>
          ) : (
            filteredSpans.slice(0, 20).map((s, i) => {
              const isSel = i === selected;
              const statusColor =
                s.status === 'ERROR' ? 'red' : s.durationMs > 500 ? 'yellow' : 'green';
              return (
                <Box key={`${s.spanId}-${s.startTime}`} flexDirection="row">
                  <Text color={isSel ? 'cyan' : undefined}>{isSel ? '› ' : '  '}</Text>
                  <Text color={colors ? statusColor : undefined}>
                    {truncate(s.name, 26)}
                  </Text>
                  <Text dimColor> {formatDurationMs(s.durationMs)}</Text>
                  <Text dimColor> {formatRelative(s.endTime)}</Text>
                </Box>
              );
            })
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
          <Box marginBottom={1}>
            <Text bold>Details</Text>
          </Box>

          {currentSpan ? (
            <>
              <Text>
                <Text dimColor>Name: </Text>
                <Text>{currentSpan.name}</Text>
              </Text>
              <Text>
                <Text dimColor>Status: </Text>
                <Text color={currentSpan.status === 'ERROR' ? 'red' : 'green'}>
                  {currentSpan.status}
                </Text>
              </Text>
              <Text>
                <Text dimColor>Duration: </Text>
                <Text>
                  {formatDurationMs(currentSpan.durationMs)}
                  {perSpanNameStats.byName.has(currentSpan.name) && (() => {
                    const p = perSpanNameStats.byName.get(currentSpan.name)!;
                    const ratio = p.avgMs > 0 ? currentSpan.durationMs / p.avgMs : 1;
                    if (ratio >= 1.5) return ` (${ratio.toFixed(1)}x avg)`;
                    return '';
                  })()}
                </Text>
              </Text>
              <Text dimColor>Trace: {currentSpan.traceId}</Text>
              <Text dimColor>Span: {currentSpan.spanId}</Text>
              {currentSpan.parentSpanId && (
                <Text dimColor>Parent: {currentSpan.parentSpanId}</Text>
              )}
              {currentSpan.kind && <Text dimColor>Kind: {currentSpan.kind}</Text>}

              {(() => {
                const { key: keyAttrs, rest: restAttrs } = keyAttrsAndRest(currentSpan.attributes);
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

              {waterfallSpans.length > 0 && selectedTraceId != null && (
                <Box marginTop={1} flexDirection="column">
                  <Text bold>Waterfall</Text>
                  {waterfallSpans.slice(0, 10).map((w) => {
                    const barLen = Math.round((w.span.durationMs / waterfallMaxMs) * barWidth) || 1;
                    const bar = '█'.repeat(barLen);
                    const indent = '  '.repeat(w.depth);
                    return (
                      <Box key={w.span.spanId} flexDirection="row">
                        <Text dimColor>{indent}</Text>
                        <Text>{truncate(w.span.name, 12)}</Text>
                        <Text dimColor> {bar}</Text>
                        <Text dimColor> {formatDurationMs(w.span.durationMs)}</Text>
                      </Box>
                    );
                  })}
                </Box>
              )}
            </>
          ) : (
            <Text dimColor>Select a trace or span to view details.</Text>
          )}
        </Box>
      </Box>

      {showStats && (
        <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
          <Text dimColor>
            Spans: {stats.total} | Errors: {stats.errors} | Avg: {formatDurationMs(stats.avg)} | P95: {formatDurationMs(stats.p95)}
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

// Re-export OpenTelemetry types for advanced users
export type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
export { SpanStatusCode, SpanKind } from 'autotel';

// Re-export PrettyConsoleExporter for convenience
export {
  PrettyConsoleExporter,
  type PrettyConsoleExporterOptions,
} from 'autotel/exporters';
