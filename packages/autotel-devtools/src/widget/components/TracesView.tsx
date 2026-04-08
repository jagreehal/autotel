/**
 * Traces view - displays trace list and detailed trace viewer with waterfall visualization
 */

import { h } from 'preact';
import { useState } from 'preact/hooks';
import {
  Database,
  Clock,
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  LayoutList,
  BarChart3,
  Flame,
  Download,
  Copy,
  Check,
} from 'lucide-preact';
import {
  sortedTracesSignal,
  selectedTraceSignal,
  setSelectedTrace,
} from '../store';
import { formatDuration, formatTimestamp, getStatusColor } from '../utils';
import { cn } from '../utils/cn';
import { Copyable } from './Copyable';
import { WaterfallView } from './WaterfallView';
import { FlameGraphView } from './FlameGraphView';
import { SpanDetailPanel } from './SpanDetailPanel';
import {
  downloadTraceAsJson,
  copyTraceToClipboard,
  downloadTracesAsJson,
} from '../export-import';
import type { TraceData, SpanData } from '../types';

type ViewMode = 'waterfall' | 'flame' | 'list';

export function TracesView() {
  const traces = sortedTracesSignal.value;
  const selectedTrace = selectedTraceSignal.value;

  if (selectedTrace) {
    return <TraceDetailView trace={selectedTrace} />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2 text-zinc-900">
          <Database size={16} />
          Traces ({traces.length})
        </h3>
        <div className="flex items-center gap-1">
          {traces.length > 0 && (
            <button
              onClick={() => downloadTracesAsJson(traces)}
              className="p-1.5 hover:bg-zinc-100 rounded transition-colors"
              title="Export all traces as JSON"
            >
              <Download size={14} className="text-zinc-500" />
            </button>
          )}
        </div>
      </div>

      {/* Traces list */}
      <div className="flex-1 overflow-auto p-4">
        {traces.length === 0 ? (
          <div className="text-center text-zinc-500 text-sm py-12">
            <p className="mb-3">No traces yet. Waiting for data...</p>
          </div>
        ) : (
          <div className="space-y-2">
            {traces.map((trace) => (
              <TraceRow
                key={trace.traceId}
                trace={trace}
                onClick={() => setSelectedTrace(trace.traceId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface TraceRowProps {
  trace: TraceData;
  onClick: () => void;
}

function TraceRow({ trace, onClick }: TraceRowProps) {
  const isError = trace.status === 'ERROR';

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left p-3 rounded-md border transition-all',
        'hover:shadow-sm hover:border-zinc-300',
        isError
          ? 'bg-red-50 border-red-200 hover:border-red-300'
          : 'bg-white border-zinc-200 hover:border-zinc-300',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-mono text-xs text-zinc-500">
              {trace.correlationId}
            </span>
            {isError && (
              <AlertCircle size={14} className="text-red-600 flex-shrink-0" />
            )}
          </div>

          <div className="font-medium text-sm mb-2 truncate text-zinc-900">
            {trace.rootSpan.name || 'unknown'}
          </div>

          <div className="flex items-center gap-3 text-xs text-zinc-600 flex-wrap">
            <span className="flex items-center gap-1">
              <Clock size={12} />
              {formatDuration(trace.duration)}
            </span>
            <span>{trace.spans.length} spans</span>
            <span className={cn('font-medium', getStatusColor(trace.status))}>
              {trace.status}
            </span>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
          <span className="text-xs text-zinc-500">
            {formatTimestamp(trace.startTime)}
          </span>
          <ChevronRight size={16} className="text-zinc-400" />
        </div>
      </div>
    </button>
  );
}

interface TraceDetailViewProps {
  trace: TraceData;
}

function TraceDetailView({ trace }: TraceDetailViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('waterfall');
  const [selectedSpan, setSelectedSpan] = useState<SpanData | null>(null);
  const [copied, setCopied] = useState(false);

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const handleDownload = () => {
    downloadTraceAsJson(trace);
  };

  const handleCopy = async () => {
    await copyTraceToClipboard(trace);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-200">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setSelectedTrace(null)}
            className={cn(
              'text-xs text-zinc-600 hover:text-zinc-900',
              'flex items-center gap-1 transition-colors',
            )}
          >
            <ChevronLeft size={14} />
            Back to traces
          </button>

          <div className="flex items-center gap-2">
            {/* Export buttons */}
            <div className="flex items-center gap-1">
              <button
                onClick={handleCopy}
                className="p-1.5 hover:bg-zinc-100 rounded transition-colors"
                title="Copy trace JSON to clipboard"
              >
                {copied ? (
                  <Check size={14} className="text-green-600" />
                ) : (
                  <Copy size={14} className="text-zinc-500" />
                )}
              </button>
              <button
                onClick={handleDownload}
                className="p-1.5 hover:bg-zinc-100 rounded transition-colors"
                title="Download trace as JSON"
              >
                <Download size={14} className="text-zinc-500" />
              </button>
            </div>

            {/* View mode toggle */}
            <div className="flex items-center gap-1 bg-zinc-100 rounded-md p-0.5">
              <button
                onClick={() => setViewMode('waterfall')}
                className={cn(
                  'px-2 py-1 text-xs rounded transition-colors flex items-center gap-1',
                  viewMode === 'waterfall'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900',
                )}
                title="Waterfall view"
              >
                <BarChart3 size={12} />
                Timeline
              </button>
              <button
                onClick={() => setViewMode('flame')}
                className={cn(
                  'px-2 py-1 text-xs rounded transition-colors flex items-center gap-1',
                  viewMode === 'flame'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900',
                )}
                title="Flame graph view"
              >
                <Flame size={12} />
                Flame
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={cn(
                  'px-2 py-1 text-xs rounded transition-colors flex items-center gap-1',
                  viewMode === 'list'
                    ? 'bg-white text-zinc-900 shadow-sm'
                    : 'text-zinc-600 hover:text-zinc-900',
                )}
                title="List view"
              >
                <LayoutList size={12} />
                List
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base mb-1.5 text-zinc-900">
              {trace.rootSpan.name || 'Trace'}
            </h3>
            <div className="text-xs text-zinc-500 space-y-0.5">
              <div>{formatDate(trace.startTime)}</div>
              <div className="font-mono">Trace ID: {trace.traceId}</div>
            </div>
          </div>

          <div className="text-right flex-shrink-0">
            <div
              className={cn(
                'font-medium text-sm mb-1',
                getStatusColor(trace.status),
              )}
            >
              {trace.status}
            </div>
            <div className="text-xs text-zinc-600">
              {formatDuration(trace.duration)}
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              {trace.spans.length} spans
            </div>
          </div>
        </div>
      </div>

      {/* Content area - flex row for waterfall + detail panel */}
      <div className="flex-1 overflow-hidden flex">
        {/* Main content */}
        <div
          className={cn(
            'flex-1 overflow-hidden',
            selectedSpan && 'border-r border-zinc-200',
          )}
        >
          {viewMode === 'waterfall' ? (
            <WaterfallView
              trace={trace}
              onSpanSelect={setSelectedSpan}
              selectedSpanId={selectedSpan?.spanId}
            />
          ) : viewMode === 'flame' ? (
            <FlameGraphView
              trace={trace}
              onSpanSelect={setSelectedSpan}
              selectedSpanId={selectedSpan?.spanId}
            />
          ) : (
            <div className="overflow-auto h-full">
              <div className="divide-y divide-zinc-100">
                {trace.spans.map((span) => (
                  <SpanRow
                    key={span.spanId}
                    span={span}
                    trace={trace}
                    isSelected={selectedSpan?.spanId === span.spanId}
                    onSelect={() => setSelectedSpan(span)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Span detail panel (right side) */}
        {selectedSpan && (
          <div className="w-[320px] flex-shrink-0 overflow-hidden">
            <SpanDetailPanel
              span={selectedSpan}
              trace={trace}
              onClose={() => setSelectedSpan(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

interface SpanRowProps {
  span: SpanData;
  trace: TraceData;
  isSelected: boolean;
  onSelect: () => void;
}

function SpanRow({ span, trace, isSelected, onSelect }: SpanRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({
    attributes: false,
    events: false,
  });
  const isError = span.status.code === 'ERROR';

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  // Calculate indent level based on parent relationships
  const getIndentLevel = () => {
    let level = 0;
    let currentSpan = span;
    while (currentSpan.parentSpanId) {
      level++;
      const parent = trace.spans.find(
        (s) => s.spanId === currentSpan.parentSpanId,
      );
      if (!parent) break;
      currentSpan = parent;
    }
    return level;
  };

  const indentLevel = getIndentLevel();
  const hasAttributes = Object.keys(span.attributes || {}).length > 0;
  const hasEvents = span.events && span.events.length > 0;

  return (
    <div
      className={cn(
        'px-4 py-3',
        'hover:bg-zinc-50 transition-colors cursor-pointer',
        isError && 'bg-red-50/30',
        isSelected && 'bg-zinc-100 hover:bg-zinc-100',
      )}
      style={{ paddingLeft: `${16 + indentLevel * 20}px` }}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm mb-1 text-zinc-900">
            {span.name || 'unknown'}
          </div>
          <div className="flex items-center gap-3 text-xs text-zinc-600">
            <span
              className={cn('font-medium', getStatusColor(span.status.code))}
            >
              {span.status.code}
            </span>
            <span>{formatDuration(span.duration)}</span>
            <span className="text-zinc-400">{span.kind}</span>
          </div>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
          className="p-1 hover:bg-zinc-200 rounded"
        >
          <ChevronDown
            size={14}
            className={cn(
              'text-zinc-400 transition-transform flex-shrink-0',
              expanded && 'rotate-180',
            )}
          />
        </button>
      </div>

      {expanded && (
        <div
          className="mt-3 pt-3 border-t border-zinc-200 space-y-3"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Attributes section */}
          {hasAttributes && (
            <ExpandableSection
              label="All attributes"
              expanded={expandedSections.attributes}
              onToggle={() => toggleSection('attributes')}
            >
              <Copyable content={JSON.stringify(span.attributes, null, 2)}>
                <div className="bg-zinc-50 rounded p-3 border border-zinc-200 font-mono text-xs">
                  <pre className="whitespace-pre-wrap break-words text-zinc-800">
                    {JSON.stringify(span.attributes, null, 2)}
                  </pre>
                </div>
              </Copyable>
            </ExpandableSection>
          )}

          {/* Events section */}
          {hasEvents && (
            <ExpandableSection
              label={`Events (${span.events!.length})`}
              expanded={expandedSections.events}
              onToggle={() => toggleSection('events')}
            >
              <div className="space-y-2">
                {span.events!.map((event, idx) => (
                  <div
                    key={idx}
                    className="bg-zinc-50 rounded p-2.5 border border-zinc-200"
                  >
                    <div className="font-medium text-xs text-zinc-900 mb-1.5">
                      {event.name}
                    </div>
                    {event.attributes &&
                      Object.keys(event.attributes).length > 0 && (
                        <Copyable
                          content={JSON.stringify(event.attributes, null, 2)}
                        >
                          <div className="font-mono text-xs text-zinc-600 mt-1">
                            {JSON.stringify(event.attributes, null, 2)}
                          </div>
                        </Copyable>
                      )}
                  </div>
                ))}
              </div>
            </ExpandableSection>
          )}

          {/* Status message */}
          {span.status.message && (
            <div className="text-xs text-zinc-600">
              <span className="font-medium">Status message:</span>{' '}
              {span.status.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface ExpandableSectionProps {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  children: any;
}

function ExpandableSection({
  label,
  expanded,
  onToggle,
  children,
}: ExpandableSectionProps) {
  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 cursor-pointer text-zinc-700 hover:text-zinc-900 transition-colors w-fit"
      >
        <ChevronDown
          size={12}
          className={cn(
            'text-zinc-500 transition-transform',
            expanded && 'rotate-180',
          )}
        />
        <span className="text-xs font-medium">{label}</span>
      </button>
      {expanded && <div>{children}</div>}
    </div>
  );
}
