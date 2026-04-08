/**
 * Service Map Visualization
 * Shows services as nodes and their connections as edges
 * Highlights error paths and displays latency information
 */

import { h } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import {
  Server,
  AlertCircle,
  ArrowRight,
  Clock,
  Activity,
} from 'lucide-preact';
import { cn } from '../utils/cn';
import { formatDuration } from '../utils';
import { tracesSignal } from '../store';
import type { TraceData, SpanData } from '../types';
import { inferResourceName } from '../utils/resources';

/**
 * Service node in the map
 */
interface ServiceNode {
  id: string;
  name: string;
  requestCount: number;
  errorCount: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  spanKinds: Set<SpanData['kind']>;
}

/**
 * Connection between services
 */
interface ServiceConnection {
  id: string;
  source: string;
  target: string;
  requestCount: number;
  errorCount: number;
  avgLatency: number;
  p50Latency: number;
  p99Latency: number;
  latencies: number[];
}

/**
 * Extract service name from span
 */
function getServiceFromSpan(span: SpanData, traceService: string): string {
  return inferResourceName(span, traceService);
}

/**
 * Calculate a percentile from a sorted array
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

/**
 * Build service map from traces
 */
function buildServiceMap(traces: TraceData[]): {
  nodes: ServiceNode[];
  connections: ServiceConnection[];
} {
  const nodeMap = new Map<string, ServiceNode>();
  const connectionMap = new Map<string, ServiceConnection>();

  for (const trace of traces) {
    const spanMap = new Map<string, SpanData>();
    for (const span of trace.spans) spanMap.set(span.spanId, span);

    for (const span of trace.spans) {
      const serviceName = getServiceFromSpan(span, trace.service);

      // Update or create service node
      let node = nodeMap.get(serviceName);
      if (!node) {
        node = {
          id: serviceName,
          name: serviceName,
          requestCount: 0,
          errorCount: 0,
          avgLatency: 0,
          minLatency: Infinity,
          maxLatency: 0,
          spanKinds: new Set(),
        };
        nodeMap.set(serviceName, node);
      }

      node.requestCount++;
      if (span.status.code === 'ERROR') {
        node.errorCount++;
      }
      node.avgLatency =
        (node.avgLatency * (node.requestCount - 1) + span.duration) /
        node.requestCount;
      node.minLatency = Math.min(node.minLatency, span.duration);
      node.maxLatency = Math.max(node.maxLatency, span.duration);
      node.spanKinds.add(span.kind);

      // Find connections (CLIENT -> SERVER patterns)
      if (span.kind === 'CLIENT' && span.parentSpanId) {
        const parentSpan = spanMap.get(span.parentSpanId);
        if (parentSpan) {
          const parentService = getServiceFromSpan(parentSpan, trace.service);

          // Look for the target service from attributes
          const targetService =
            span.attributes?.['peer.service'] ||
            span.attributes?.['http.host'] ||
            span.attributes?.['db.system'] ||
            span.attributes?.['net.peer.name'] ||
            span.attributes?.['rpc.service'] ||
            'external';

          if (parentService !== targetService) {
            const connId = `${parentService}->${targetService}`;
            let conn = connectionMap.get(connId);
            if (!conn) {
              conn = {
                id: connId,
                source: parentService,
                target: targetService,
                requestCount: 0,
                errorCount: 0,
                avgLatency: 0,
                p50Latency: 0,
                p99Latency: 0,
                latencies: [],
              };
              connectionMap.set(connId, conn);

              // Ensure target node exists
              if (!nodeMap.has(targetService)) {
                nodeMap.set(targetService, {
                  id: targetService,
                  name: targetService,
                  requestCount: 0,
                  errorCount: 0,
                  avgLatency: 0,
                  minLatency: Infinity,
                  maxLatency: 0,
                  spanKinds: new Set(),
                });
              }
            }

            conn.requestCount++;
            if (span.status.code === 'ERROR') {
              conn.errorCount++;
            }
            conn.avgLatency =
              (conn.avgLatency * (conn.requestCount - 1) + span.duration) /
              conn.requestCount;
            conn.latencies.push(span.duration);
            const sortedLatencies = [...conn.latencies].sort((a, b) => a - b);
            conn.p50Latency = percentile(sortedLatencies, 50);
            conn.p99Latency = percentile(sortedLatencies, 99);
          }
        }
      }

      // Also look for SERVER spans that indicate incoming requests
      if (span.kind === 'SERVER') {
        // Check if there's a parent CLIENT span from different service
        const parentSpan = span.parentSpanId
          ? spanMap.get(span.parentSpanId)
          : null;
        if (parentSpan && parentSpan.kind === 'CLIENT') {
          const sourceService = getServiceFromSpan(parentSpan, trace.service);
          if (sourceService !== serviceName) {
            const connId = `${sourceService}->${serviceName}`;
            if (!connectionMap.has(connId)) {
              const sortedInit = [span.duration];
              connectionMap.set(connId, {
                id: connId,
                source: sourceService,
                target: serviceName,
                requestCount: 1,
                errorCount: span.status.code === 'ERROR' ? 1 : 0,
                avgLatency: span.duration,
                p50Latency: span.duration,
                p99Latency: span.duration,
                latencies: sortedInit,
              });
            }
          }
        }
      }
    }
  }

  // Convert to arrays and fix min latency
  const nodes = [...nodeMap.values()].map((node) => ({
    ...node,
    minLatency: node.minLatency === Infinity ? 0 : node.minLatency,
  }));

  const connections = [...connectionMap.values()];

  return { nodes, connections };
}

/**
 * Calculate node positions in a force-directed-like layout
 */
function calculateLayout(
  nodes: ServiceNode[],
  connections: ServiceConnection[],
  width: number,
  height: number,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  if (nodes.length === 0) return positions;

  if (nodes.length === 1) {
    positions.set(nodes[0].id, { x: width / 2, y: height / 2 });
    return positions;
  }

  // Simple circular layout for now
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.35;

  for (const [index, node] of nodes.entries()) {
    const angle = (2 * Math.PI * index) / nodes.length - Math.PI / 2;
    positions.set(node.id, {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    });
  }

  return positions;
}

export function ServiceMapView() {
  const traces = tracesSignal.value;
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const { nodes, connections } = useMemo(
    () => buildServiceMap(traces),
    [traces],
  );

  // Layout dimensions
  const width = 600;
  const height = 400;
  const nodeRadius = 40;

  const positions = useMemo(
    () => calculateLayout(nodes, connections, width, height),
    [nodes, connections, width, height],
  );

  const selectedNodeData = selectedNode
    ? nodes.find((n) => n.id === selectedNode)
    : null;

  const relatedConnections = selectedNode
    ? connections.filter(
        (c) => c.source === selectedNode || c.target === selectedNode,
      )
    : [];

  if (traces.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 p-8">
        <Activity size={48} className="mb-4 opacity-50" />
        <p className="text-sm text-center">
          No traces available to build service map.
          <br />
          Traces will appear here as they are captured.
        </p>
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-500 p-8">
        <Server size={48} className="mb-4 opacity-50" />
        <p className="text-sm text-center">
          No services detected in traces.
          <br />
          Service information is extracted from span attributes.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2 text-gray-900">
          <Activity size={16} />
          Service Map ({nodes.length} services)
        </h3>
        <div className="text-xs text-gray-500">
          {connections.length} connections
        </div>
      </div>

      {/* Map container */}
      <div className="flex-1 overflow-hidden flex">
        {/* SVG Map */}
        <div className="flex-1 overflow-auto p-4">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-full"
            style={{ minHeight: '300px' }}
          >
            {/* Connection lines */}
            {connections.map((conn) => {
              const source = positions.get(conn.source);
              const target = positions.get(conn.target);
              if (!source || !target) return null;

              const isHighlighted =
                selectedNode === conn.source || selectedNode === conn.target;
              const hasError = conn.errorCount > 0;

              // Calculate control point for curved line
              const midX = (source.x + target.x) / 2;
              const midY = (source.y + target.y) / 2;
              const dx = target.x - source.x;
              const dy = target.y - source.y;
              const offset = 20;
              const ctrlX = midX - (dy / Math.hypot(dx, dy)) * offset;
              const ctrlY = midY + (dx / Math.hypot(dx, dy)) * offset;

              return (
                <g key={conn.id}>
                  <path
                    d={`M ${source.x} ${source.y} Q ${ctrlX} ${ctrlY} ${target.x} ${target.y}`}
                    fill="none"
                    stroke={hasError ? '#ef4444' : '#94a3b8'}
                    strokeWidth={isHighlighted ? 3 : 2}
                    strokeOpacity={selectedNode && !isHighlighted ? 0.2 : 1}
                    markerEnd="url(#arrowhead)"
                  />
                  {/* Request count and p50 latency label */}
                  {isHighlighted && (
                    <text
                      x={ctrlX}
                      y={ctrlY - 8}
                      textAnchor="middle"
                      className="text-[10px] fill-gray-600"
                    >
                      {conn.requestCount} calls · p50: {Math.round(conn.p50Latency)}ms
                    </text>
                  )}
                </g>
              );
            })}

            {/* Arrow marker definition */}
            <defs>
              <marker
                id="arrowhead"
                markerWidth="10"
                markerHeight="7"
                refX="9"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
              </marker>
            </defs>

            {/* Service nodes */}
            {nodes.map((node) => {
              const pos = positions.get(node.id);
              if (!pos) return null;

              const isSelected = selectedNode === node.id;
              const isHovered = hoveredNode === node.id;
              const hasError = node.errorCount > 0;
              const errorRate =
                node.requestCount > 0
                  ? (node.errorCount / node.requestCount) * 100
                  : 0;

              return (
                <g
                  key={node.id}
                  transform={`translate(${pos.x}, ${pos.y})`}
                  onClick={() => setSelectedNode(isSelected ? null : node.id)}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                  className="cursor-pointer"
                >
                  {/* Node circle */}
                  <circle
                    r={nodeRadius}
                    fill={isSelected || isHovered ? '#f1f5f9' : '#ffffff'}
                    stroke={hasError ? '#ef4444' : '#3b82f6'}
                    strokeWidth={isSelected ? 3 : 2}
                    opacity={
                      selectedNode &&
                      !isSelected &&
                      !relatedConnections.some(
                        (c) => c.source === node.id || c.target === node.id,
                      )
                        ? 0.3
                        : 1
                    }
                  />

                  {/* Error indicator */}
                  {hasError && (
                    <circle
                      cx={nodeRadius * 0.6}
                      cy={-nodeRadius * 0.6}
                      r={8}
                      fill="#ef4444"
                    />
                  )}

                  {/* Service icon */}
                  <g transform="translate(-8, -20)">
                    <Server size={16} className="text-gray-500" />
                  </g>

                  {/* Service name */}
                  <text
                    textAnchor="middle"
                    y={5}
                    className="text-xs font-medium fill-gray-900"
                  >
                    {node.name.length > 12
                      ? node.name.slice(0, 10) + '...'
                      : node.name}
                  </text>

                  {/* Request count */}
                  <text
                    textAnchor="middle"
                    y={20}
                    className="text-[10px] fill-gray-500"
                  >
                    {node.requestCount} req
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Details panel */}
        {selectedNodeData && (
          <div className="w-64 border-l border-gray-200 bg-gray-50 overflow-auto">
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold text-gray-900">
                  {selectedNodeData.name}
                </h4>
                <button
                  onClick={() => setSelectedNode(null)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              </div>

              {/* Stats */}
              <div className="space-y-3">
                <StatRow
                  label="Requests"
                  value={selectedNodeData.requestCount.toString()}
                />
                <StatRow
                  label="Errors"
                  value={selectedNodeData.errorCount.toString()}
                  isError={selectedNodeData.errorCount > 0}
                />
                <StatRow
                  label="Error Rate"
                  value={`${(
                    (selectedNodeData.errorCount /
                      selectedNodeData.requestCount) *
                    100
                  ).toFixed(1)}%`}
                  isError={selectedNodeData.errorCount > 0}
                />
                <StatRow
                  label="Avg Latency"
                  value={formatDuration(selectedNodeData.avgLatency)}
                />
                <StatRow
                  label="Min Latency"
                  value={formatDuration(selectedNodeData.minLatency)}
                />
                <StatRow
                  label="Max Latency"
                  value={formatDuration(selectedNodeData.maxLatency)}
                />
              </div>

              {/* Connections */}
              {relatedConnections.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <h5 className="text-xs font-medium text-gray-700 mb-2">
                    Connections
                  </h5>
                  <div className="space-y-2">
                    {relatedConnections.map((conn) => (
                      <div
                        key={conn.id}
                        className="text-xs p-2 bg-white rounded border border-gray-200"
                      >
                        <div className="flex items-center gap-1 text-gray-700">
                          <span className="font-medium">
                            {conn.source === selectedNode
                              ? conn.target
                              : conn.source}
                          </span>
                          {conn.source === selectedNode ? (
                            <ArrowRight size={10} />
                          ) : (
                            <ArrowRight size={10} className="rotate-180" />
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-gray-500">
                          <span>{conn.requestCount} req</span>
                          {conn.errorCount > 0 && (
                            <span className="text-red-600">
                              {conn.errorCount} err
                            </span>
                          )}
                          <span>{formatDuration(conn.avgLatency)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-200 bg-gray-50 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded-full border-2 border-blue-500 bg-white" />
          <span className="text-gray-600">Healthy</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded-full border-2 border-red-500 bg-white" />
          <span className="text-gray-600">Has Errors</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-6 h-0.5 bg-gray-400" />
          <span className="text-gray-600">Connection</span>
        </div>
      </div>
    </div>
  );
}

interface StatRowProps {
  label: string;
  value: string;
  isError?: boolean;
}

function StatRow({ label, value, isError }: StatRowProps) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-gray-500">{label}</span>
      <span
        className={cn(
          'font-medium',
          isError ? 'text-red-600' : 'text-gray-900',
        )}
      >
        {value}
      </span>
    </div>
  );
}

export default ServiceMapView;
