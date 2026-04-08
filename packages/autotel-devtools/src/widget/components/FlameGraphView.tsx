/**
 * Flame Graph visualization for trace spans
 * Shows spans as stacked horizontal bars where width represents duration
 * and vertical position represents call hierarchy
 */

import { h } from 'preact';
import { useState, useMemo, useRef } from 'preact/hooks';
import { ZoomIn, ZoomOut, RotateCcw, AlertCircle } from 'lucide-preact';
import { cn } from '../utils/cn';
import { formatDuration } from '../utils';
import type { TraceData, SpanData } from '../types';

interface FlameGraphViewProps {
  trace: TraceData;
  onSpanSelect?: (span: SpanData | null) => void;
  selectedSpanId?: string | null;
}

interface FlameNode {
  span: SpanData;
  children: FlameNode[];
  depth: number;
  // Calculated layout properties
  x: number; // percentage from left
  width: number; // percentage width
}

interface ZoomState {
  focusedSpanId: string | null;
  // When zoomed, we show this span and its descendants at full width
}

/**
 * Build a tree structure from flat spans array
 */
function buildFlameTree(spans: SpanData[], trace: TraceData): FlameNode[] {
  const spanMap = new Map<string, FlameNode>();
  const roots: FlameNode[] = [];
  const traceDuration = trace.duration || 1;
  const traceStart = trace.startTime;

  // Create nodes for all spans
  for (const span of spans) {
    const x = ((span.startTime - traceStart) / traceDuration) * 100;
    const width = (span.duration / traceDuration) * 100;
    spanMap.set(span.spanId, {
      span,
      children: [],
      depth: 0,
      x: Math.max(0, x),
      width: Math.max(0.5, Math.min(100 - x, width)), // Min 0.5% for visibility
    });
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
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  }

  // Sort children by start time
  const sortChildren = (nodes: FlameNode[]) => {
    nodes.sort((a, b) => a.span.startTime - b.span.startTime);
    for (const node of nodes) sortChildren(node.children);
  };
  sortChildren(roots);

  return roots;
}

/**
 * Flatten tree to array with depth info, for rendering
 */
function flattenFlameTree(nodes: FlameNode[]): FlameNode[] {
  const result: FlameNode[] = [];
  const traverse = (node: FlameNode) => {
    result.push(node);
    node.children.forEach(traverse);
  };
  nodes.forEach(traverse);
  return result;
}

/**
 * Get max depth in tree
 */
function getMaxDepth(nodes: FlameNode[]): number {
  let max = 0;
  const traverse = (node: FlameNode) => {
    max = Math.max(max, node.depth);
    node.children.forEach(traverse);
  };
  nodes.forEach(traverse);
  return max;
}

/**
 * Recalculate positions when zoomed to a specific span
 */
function recalculateForZoom(
  nodes: FlameNode[],
  focusedSpanId: string,
  allSpans: SpanData[],
): FlameNode[] {
  // Find the focused span
  const focusedSpan = allSpans.find((s) => s.spanId === focusedSpanId);
  if (!focusedSpan) return nodes;

  const focusStart = focusedSpan.startTime;
  const focusDuration = focusedSpan.duration || 1;

  // Get all descendants of focused span
  const isDescendant = (spanId: string, ancestorId: string): boolean => {
    const span = allSpans.find((s) => s.spanId === spanId);
    if (!span) return false;
    if (span.parentSpanId === ancestorId) return true;
    if (span.parentSpanId) return isDescendant(span.parentSpanId, ancestorId);
    return false;
  };

  // Recalculate x and width for visible spans
  const recalc = (node: FlameNode): FlameNode => {
    const isVisible =
      node.span.spanId === focusedSpanId ||
      isDescendant(node.span.spanId, focusedSpanId);

    if (!isVisible) {
      return {
        ...node,
        x: -100,
        width: 0,
        children: node.children.map(recalc),
      };
    }

    const x = ((node.span.startTime - focusStart) / focusDuration) * 100;
    const width = (node.span.duration / focusDuration) * 100;

    return {
      ...node,
      x: Math.max(0, x),
      width: Math.max(0.5, Math.min(100 - Math.max(0, x), width)),
      children: node.children.map(recalc),
    };
  };

  return nodes.map(recalc);
}

/**
 * Get color for span based on kind and status
 */
function getSpanColor(span: SpanData): string {
  if (span.status.code === 'ERROR') {
    return 'bg-red-500 hover:bg-red-400';
  }
  switch (span.kind) {
    case 'SERVER': {
      return 'bg-blue-500 hover:bg-blue-400';
    }
    case 'CLIENT': {
      return 'bg-green-500 hover:bg-green-400';
    }
    case 'PRODUCER': {
      return 'bg-purple-500 hover:bg-purple-400';
    }
    case 'CONSUMER': {
      return 'bg-orange-500 hover:bg-orange-400';
    }
    case 'INTERNAL':
    default: {
      return 'bg-gray-500 hover:bg-gray-400';
    }
  }
}

/**
 * Get border color for selected state
 */
function getSelectedBorder(span: SpanData): string {
  if (span.status.code === 'ERROR') {
    return 'ring-2 ring-red-700';
  }
  return 'ring-2 ring-gray-900';
}

const ROW_HEIGHT = 24;
const ROW_GAP = 2;

export function FlameGraphView({
  trace,
  onSpanSelect,
  selectedSpanId,
}: FlameGraphViewProps) {
  const [zoom, setZoom] = useState<ZoomState>({ focusedSpanId: null });
  const [hoveredSpan, setHoveredSpan] = useState<SpanData | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Build the flame tree
  const baseTree = useMemo(() => buildFlameTree(trace.spans, trace), [trace]);

  // Apply zoom if needed
  const flameTree = useMemo(() => {
    if (zoom.focusedSpanId) {
      return recalculateForZoom(baseTree, zoom.focusedSpanId, trace.spans);
    }
    return baseTree;
  }, [baseTree, zoom.focusedSpanId, trace.spans]);

  const flatNodes = useMemo(() => flattenFlameTree(flameTree), [flameTree]);
  const maxDepth = useMemo(() => getMaxDepth(flameTree), [flameTree]);

  // Group nodes by depth for rendering
  const nodesByDepth = useMemo(() => {
    const grouped: Map<number, FlameNode[]> = new Map();
    for (const node of flatNodes) {
      if (node.width > 0) {
        // Only visible nodes
        const existing = grouped.get(node.depth) || [];
        existing.push(node);
        grouped.set(node.depth, existing);
      }
    }
    return grouped;
  }, [flatNodes]);

  const handleZoomIn = (spanId: string) => {
    setZoom({ focusedSpanId: spanId });
  };

  const handleZoomOut = () => {
    setZoom({ focusedSpanId: null });
  };

  const handleMouseMove = (e: MouseEvent, span: SpanData) => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setTooltipPos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
    setHoveredSpan(span);
  };

  const handleMouseLeave = () => {
    setHoveredSpan(null);
  };

  const graphHeight = (maxDepth + 1) * (ROW_HEIGHT + ROW_GAP) + 20;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
        <div className="text-xs text-gray-600">
          {zoom.focusedSpanId ? (
            <span className="flex items-center gap-2">
              <span className="font-medium">Zoomed:</span>
              <span className="truncate max-w-[200px]">
                {trace.spans.find((s) => s.spanId === zoom.focusedSpanId)?.name}
              </span>
            </span>
          ) : (
            <span>Click a span to zoom in, double-click to select</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {zoom.focusedSpanId && (
            <button
              onClick={handleZoomOut}
              className="p-1.5 hover:bg-gray-200 rounded transition-colors flex items-center gap-1 text-xs text-gray-700"
              title="Reset zoom"
            >
              <RotateCcw size={14} />
              Reset
            </button>
          )}
        </div>
      </div>

      {/* Flame graph container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto p-4 relative"
        onMouseLeave={handleMouseLeave}
      >
        <div
          className="relative w-full"
          style={{ height: `${graphHeight}px`, minWidth: '100%' }}
        >
          {/* Render rows by depth (bottom-up for flame graph, but we'll do top-down for icicle) */}
          {[...nodesByDepth.entries()].map(([depth, nodes]) => (
            <div
              key={depth}
              className="absolute left-0 right-0"
              style={{ top: `${depth * (ROW_HEIGHT + ROW_GAP)}px` }}
            >
              {nodes.map((node) => (
                <FlameBar
                  key={node.span.spanId}
                  node={node}
                  isSelected={selectedSpanId === node.span.spanId}
                  isHovered={hoveredSpan?.spanId === node.span.spanId}
                  onClick={() => handleZoomIn(node.span.spanId)}
                  onDoubleClick={() => onSpanSelect?.(node.span)}
                  onMouseMove={(e) => handleMouseMove(e, node.span)}
                  onMouseLeave={handleMouseLeave}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Tooltip */}
        {hoveredSpan && (
          <div
            className="absolute z-50 pointer-events-none"
            style={{
              left: `${Math.min(tooltipPos.x + 10, (containerRef.current?.clientWidth || 300) - 220)}px`,
              top: `${tooltipPos.y + 10}px`,
            }}
          >
            <div className="bg-gray-900 text-white text-xs rounded-md shadow-lg p-2 max-w-[200px]">
              <div className="font-medium truncate mb-1">
                {hoveredSpan.name}
              </div>
              <div className="flex items-center gap-2 text-gray-300">
                <span>{formatDuration(hoveredSpan.duration)}</span>
                <span>|</span>
                <span>{hoveredSpan.kind}</span>
              </div>
              {hoveredSpan.status.code === 'ERROR' && (
                <div className="flex items-center gap-1 mt-1 text-red-400">
                  <AlertCircle size={10} />
                  <span>Error</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-3 py-2 border-t border-gray-200 bg-gray-50 text-xs">
        <span className="text-gray-500 font-medium">Kind:</span>
        {(
          ['SERVER', 'CLIENT', 'INTERNAL', 'PRODUCER', 'CONSUMER'] as const
        ).map((kind) => (
          <div key={kind} className="flex items-center gap-1">
            <div
              className={cn(
                'w-3 h-3 rounded-sm',
                kind === 'SERVER' && 'bg-blue-500',
                kind === 'CLIENT' && 'bg-green-500',
                kind === 'PRODUCER' && 'bg-purple-500',
                kind === 'CONSUMER' && 'bg-orange-500',
                kind === 'INTERNAL' && 'bg-gray-500',
              )}
            />
            <span className="text-gray-600">{kind}</span>
          </div>
        ))}
        <div className="flex items-center gap-1 ml-2">
          <div className="w-3 h-3 rounded-sm bg-red-500" />
          <span className="text-gray-600">ERROR</span>
        </div>
      </div>
    </div>
  );
}

interface FlameBarProps {
  node: FlameNode;
  isSelected: boolean;
  isHovered: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
  onMouseMove: (e: MouseEvent) => void;
  onMouseLeave: () => void;
}

function FlameBar({
  node,
  isSelected,
  isHovered,
  onClick,
  onDoubleClick,
  onMouseMove,
  onMouseLeave,
}: FlameBarProps) {
  const { span, x, width } = node;

  // Don't render if not visible
  if (width <= 0 || x < 0) return null;

  return (
    <div
      className={cn(
        'absolute cursor-pointer transition-all',
        getSpanColor(span),
        isSelected && getSelectedBorder(span),
        'rounded-sm',
      )}
      style={{
        left: `${x}%`,
        width: `${width}%`,
        height: `${ROW_HEIGHT}px`,
        minWidth: '4px',
      }}
      onClick={onClick}
      onDblClick={onDoubleClick}
      onMouseMove={onMouseMove as any}
      onMouseLeave={onMouseLeave}
      title={`${span.name}: ${formatDuration(span.duration)}`}
    >
      {/* Show label if wide enough */}
      {width > 5 && (
        <div className="absolute inset-0 flex items-center px-1.5 overflow-hidden">
          <span className="text-[10px] text-white font-medium truncate">
            {span.name}
          </span>
        </div>
      )}
    </div>
  );
}

export default FlameGraphView;
