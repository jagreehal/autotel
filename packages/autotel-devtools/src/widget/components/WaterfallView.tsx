/**
 * Waterfall visualization for trace spans
 * Shows spans in a timeline view with bars representing duration
 */

import { h } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { AlertCircle, ChevronDown, ChevronRight, Info } from 'lucide-preact';
import { cn } from '../utils/cn';
import { formatDuration } from '../utils';
import type { TraceData, SpanData } from '../types';

interface WaterfallViewProps {
  trace: TraceData;
  onSpanSelect?: (span: SpanData | null) => void;
  selectedSpanId?: string | null;
}

interface SpanNode {
  span: SpanData;
  children: SpanNode[];
  depth: number;
}

/**
 * Build a tree structure from flat spans array
 */
function buildSpanTree(spans: SpanData[]): SpanNode[] {
  const spanMap = new Map<string, SpanNode>();
  const roots: SpanNode[] = [];

  // Create nodes for all spans
  for (const span of spans) {
    spanMap.set(span.spanId, { span, children: [], depth: 0 });
  }

  // Build tree structure
  for (const span of spans) {
    const node = spanMap.get(span.spanId)!;
    if (span.parentSpanId) {
      const parent = spanMap.get(span.parentSpanId);
      if (parent) {
        parent.children.push(node);
        node.depth = parent.depth + 1;
      } else {
        // Parent not found, treat as root
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  // Sort children by start time
  const sortChildren = (nodes: SpanNode[]) => {
    nodes.sort((a, b) => a.span.startTime - b.span.startTime);
    for (const node of nodes) sortChildren(node.children);
  };
  sortChildren(roots);

  return roots;
}

/**
 * Flatten tree to array while preserving depth info, skipping children of collapsed nodes
 */
function flattenTree(nodes: SpanNode[], collapsed: Set<string>): SpanNode[] {
  const result: SpanNode[] = []
  const traverse = (node: SpanNode) => {
    result.push(node)
    if (!collapsed.has(node.span.spanId)) {
      node.children.forEach(traverse)
    }
  }
  nodes.forEach(traverse)
  return result
}

/**
 * Count all descendants of a node
 */
function countDescendants(node: SpanNode): number {
  let count = node.children.length
  for (const child of node.children) count += countDescendants(child)
  return count
}

/**
 * Calculate timing info for waterfall bar positioning
 */
function calculateTimingInfo(span: SpanData, trace: TraceData) {
  const traceStart = trace.startTime;
  const traceDuration = trace.duration || 1; // Prevent division by zero

  const offsetMs = span.startTime - traceStart;
  const offsetPercent = (offsetMs / traceDuration) * 100;
  const widthPercent = (span.duration / traceDuration) * 100;

  return {
    offsetMs,
    offsetPercent: Math.max(0, Math.min(100, offsetPercent)),
    widthPercent: Math.max(0.5, Math.min(100 - offsetPercent, widthPercent)), // Min 0.5% for visibility
  };
}

/**
 * Get color for span kind
 */
function getSpanKindColor(kind: SpanData['kind']): string {
  switch (kind) {
    case 'SERVER': {
      return 'bg-blue-500';
    }
    case 'CLIENT': {
      return 'bg-green-500';
    }
    case 'PRODUCER': {
      return 'bg-purple-500';
    }
    case 'CONSUMER': {
      return 'bg-orange-500';
    }
    case 'INTERNAL':
    default: {
      return 'bg-gray-500';
    }
  }
}

/**
 * Get lighter color for span kind (hover state)
 */
function getSpanKindColorLight(kind: SpanData['kind']): string {
  switch (kind) {
    case 'SERVER': {
      return 'bg-blue-400';
    }
    case 'CLIENT': {
      return 'bg-green-400';
    }
    case 'PRODUCER': {
      return 'bg-purple-400';
    }
    case 'CONSUMER': {
      return 'bg-orange-400';
    }
    case 'INTERNAL':
    default: {
      return 'bg-gray-400';
    }
  }
}

export function WaterfallView({
  trace,
  onSpanSelect,
  selectedSpanId,
}: WaterfallViewProps) {
  const [collapsed, setCollapsed] = useState(new Set<string>());

  // Build span tree and flatten (skipping children of collapsed nodes)
  const spanTree = useMemo(() => buildSpanTree(trace.spans), [trace.spans]);
  const visibleSpans = useMemo(() => flattenTree(spanTree, collapsed), [spanTree, collapsed]);

  const toggleCollapse = (spanId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(spanId)) next.delete(spanId)
      else next.add(spanId)
      return next
    })
  }

  const hasChildren = (spanId: string) => {
    return trace.spans.some((s) => s.parentSpanId === spanId);
  };

  // Generate time markers
  const timeMarkers = useMemo(() => {
    const duration = trace.duration || 1;
    const markers: { percent: number; label: string }[] = [];
    const numMarkers = 5;

    for (let i = 0; i <= numMarkers; i++) {
      const percent = (i / numMarkers) * 100;
      const time = (i / numMarkers) * duration;
      markers.push({
        percent,
        label: formatDuration(time),
      });
    }
    return markers;
  }, [trace.duration]);

  return (
    <div className="flex flex-col h-full">
      {/* Timeline header with time markers */}
      <div className="flex border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
        <div className="w-[200px] shrink-0 px-3 py-2 font-medium text-gray-700">
          Span Name
        </div>
        <div className="flex-1 relative py-2">
          {timeMarkers.map((marker, idx) => (
            <div
              key={idx}
              className="absolute text-[10px]"
              style={{
                left: `${marker.percent}%`,
                transform: 'translateX(-50%)',
              }}
            >
              {marker.label}
            </div>
          ))}
        </div>
        <div className="w-[80px] shrink-0 px-2 py-2 text-right font-medium text-gray-700">
          Duration
        </div>
      </div>

      {/* Timeline grid lines */}
      <div className="flex-1 overflow-auto relative">
        {/* Grid lines behind content */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ left: '200px', right: '80px' }}
        >
          {timeMarkers.map((marker, idx) => (
            <div
              key={idx}
              className="absolute top-0 bottom-0 border-l border-gray-100"
              style={{ left: `${marker.percent}%` }}
            />
          ))}
        </div>

        {/* Span rows */}
        <div className="relative">
          {visibleSpans.map((node) => (
            <WaterfallRow
              key={node.span.spanId}
              node={node}
              trace={trace}
              isSelected={selectedSpanId === node.span.spanId}
              isCollapsed={collapsed.has(node.span.spanId)}
              hasChildren={hasChildren(node.span.spanId)}
              onSelect={() => onSpanSelect?.(node.span)}
              onToggleCollapse={() => toggleCollapse(node.span.spanId)}
            />
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-3 py-2 border-t border-gray-200 bg-gray-50 text-xs">
        <span className="text-gray-500 font-medium">Kind:</span>
        {(
          ['SERVER', 'CLIENT', 'INTERNAL', 'PRODUCER', 'CONSUMER'] as const
        ).map((kind) => (
          <div key={kind} className="flex items-center gap-1">
            <div className={cn('w-3 h-3 rounded-sm', getSpanKindColor(kind))} />
            <span className="text-gray-600">{kind}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface WaterfallRowProps {
  node: SpanNode;
  trace: TraceData;
  isSelected: boolean;
  isCollapsed: boolean;
  hasChildren: boolean;
  onSelect: () => void;
  onToggleCollapse: () => void;
}

function WaterfallRow({
  node,
  trace,
  isSelected,
  isCollapsed,
  hasChildren,
  onSelect,
  onToggleCollapse,
}: WaterfallRowProps) {
  const { span } = node;
  const timing = calculateTimingInfo(span, trace);
  const isError = span.status.code === 'ERROR';
  const hasEvents = span.events && span.events.length > 0;

  return (
    <div
      className={cn(
        'flex items-center border-b border-gray-100 hover:bg-blue-50/50 cursor-pointer transition-colors',
        isSelected && 'bg-blue-50 hover:bg-blue-100/50',
        isError && 'bg-red-50/30 hover:bg-red-50/50',
      )}
      onClick={onSelect}
    >
      {/* Span name column */}
      <div
        className="w-[200px] shrink-0 px-2 py-2 flex items-center gap-1 min-w-0"
        style={{ paddingLeft: `${8 + node.depth * 16}px` }}
      >
        {/* Collapse/expand button */}
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse();
            }}
            className="p-0.5 hover:bg-gray-200 rounded flex-shrink-0"
          >
            {isCollapsed ? (
              <ChevronRight size={12} className="text-gray-500" />
            ) : (
              <ChevronDown size={12} className="text-gray-500" />
            )}
          </button>
        ) : (
          <div className="w-4" />
        )}

        {/* Error indicator */}
        {isError && (
          <AlertCircle size={12} className="text-red-500 flex-shrink-0" />
        )}

        {/* Events indicator */}
        {hasEvents && (
          <Info size={10} className="text-blue-500 flex-shrink-0" />
        )}

        {/* Span name */}
        <span
          className={cn(
            'text-xs truncate',
            isError ? 'text-red-700' : 'text-gray-900',
          )}
          title={span.name}
        >
          {span.name || 'unknown'}
        </span>

        {/* Collapsed children count */}
        {isCollapsed && node.children.length > 0 && (
          <span className="text-xs text-gray-400 ml-1">(+{countDescendants(node)})</span>
        )}
      </div>

      {/* Timeline bar column */}
      <div className="flex-1 py-2 px-1 relative h-8">
        <div
          className={cn(
            'absolute h-5 rounded-sm transition-colors group',
            isError ? 'bg-red-500' : getSpanKindColor(span.kind),
            isSelected &&
              (isError ? 'bg-red-600' : getSpanKindColorLight(span.kind)),
          )}
          style={{
            left: `${timing.offsetPercent}%`,
            width: `${timing.widthPercent}%`,
            top: '50%',
            transform: 'translateY(-50%)',
            minWidth: '4px',
          }}
          title={`${span.name}: ${formatDuration(span.duration)}`}
        >
          {/* Show duration label inside bar if wide enough */}
          {timing.widthPercent > 10 && (
            <span className="absolute inset-0 flex items-center justify-center text-[10px] text-white font-medium">
              {formatDuration(span.duration)}
            </span>
          )}

          {/* Inline event markers */}
          {span.events && span.events.length > 0 && span.events.map((event, idx) => {
            const eventPos = trace.duration > 0
              ? ((event.timestamp - trace.startTime) / trace.duration) * 100
              : 0
            return (
              <div
                key={idx}
                className={cn(
                  'absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full border border-white z-10',
                  event.name === 'exception' ? 'bg-red-500' : 'bg-yellow-500',
                )}
                style={{ left: `${Math.min(Math.max(eventPos, 0), 100)}%` }}
                title={`${event.name} at ${formatDuration(event.timestamp - trace.startTime)}`}
              />
            )
          })}
        </div>
      </div>

      {/* Duration column */}
      <div className="w-[80px] shrink-0 px-2 py-2 text-right">
        <span
          className={cn(
            'text-xs font-mono',
            isError ? 'text-red-600' : 'text-gray-600',
          )}
        >
          {formatDuration(span.duration)}
        </span>
      </div>
    </div>
  );
}

export default WaterfallView;
