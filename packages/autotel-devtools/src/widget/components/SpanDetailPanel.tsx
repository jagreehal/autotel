/**
 * Span Detail Panel - Shows detailed information about a selected span
 * Includes attributes, events, timing info, and status
 */

import { h } from 'preact';
import { useState } from 'preact/hooks';
import {
  X,
  ChevronDown,
  Clock,
  Tag,
  AlertCircle,
  Info,
  Copy,
  Check,
  Layers,
} from 'lucide-preact';
import { cn } from '../utils/cn';
import { formatDuration } from '../utils';
import { Copyable } from './Copyable';
import type { SpanData, TraceData } from '../types';
import { inferResourceName, inferResourceType } from '../utils/resources';

interface SpanDetailPanelProps {
  span: SpanData;
  trace: TraceData;
  onClose: () => void;
}

export function SpanDetailPanel({
  span,
  trace,
  onClose,
}: SpanDetailPanelProps) {
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({
    timing: true,
    attributes: true,
    events: false,
  });

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const isError = span.status.code === 'ERROR';
  const hasAttributes = Object.keys(span.attributes || {}).length > 0;
  const hasEvents = span.events && span.events.length > 0;
  const resourceName = inferResourceName(span, trace.service);
  const resourceType = inferResourceType(span.attributes, resourceName);
  const resourceAttributes = Object.entries(span.attributes || {}).filter(([key]) =>
    key.startsWith('service.') ||
    key.startsWith('deployment.') ||
    key.startsWith('host.') ||
    key.startsWith('container.') ||
    key.startsWith('process.'),
  );
  const sortedAttributes = Object.entries(span.attributes || {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  // Calculate timing relative to trace
  const relativeStart = span.startTime - trace.startTime;
  const relativeEnd = span.endTime - trace.startTime;

  // Find parent span name
  const parentSpan = trace.spans.find((s) => s.spanId === span.parentSpanId);

  // Find child spans
  const childSpans = trace.spans.filter((s) => s.parentSpanId === span.spanId);

  return (
    <div className="flex flex-col h-full bg-white border-l border-zinc-200">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-zinc-200 bg-zinc-50">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm text-zinc-900 truncate mb-1">
            {span.name || 'Unknown Span'}
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                'px-2 py-0.5 rounded text-xs font-medium',
                isError
                  ? 'bg-red-100 text-red-700'
                  : 'bg-green-100 text-green-700',
              )}
            >
              {span.status.code}
            </span>
            <span className="px-2 py-0.5 rounded bg-zinc-100 text-zinc-600 text-xs font-medium">
              {span.kind}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 hover:bg-zinc-200 rounded-md transition-colors flex-shrink-0"
          title="Close"
        >
          <X size={16} className="text-zinc-500" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {/* Error message if present */}
        {span.status.message && (
          <div className="mx-4 mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
            <div className="flex items-start gap-2">
              <AlertCircle
                size={14}
                className="text-red-500 flex-shrink-0 mt-0.5"
              />
              <div className="text-xs text-red-700">
                <span className="font-medium">Error: </span>
                {span.status.message}
              </div>
            </div>
          </div>
        )}

        {/* Timing section */}
        <CollapsibleSection
          title="Timing"
          icon={<Clock size={14} />}
          expanded={expandedSections.timing}
          onToggle={() => toggleSection('timing')}
        >
          <div className="grid grid-cols-2 gap-3 text-xs">
            <TimingItem
              label="Duration"
              value={formatDuration(span.duration)}
            />
            <TimingItem
              label="Start (relative)"
              value={formatDuration(relativeStart)}
            />
            <TimingItem
              label="End (relative)"
              value={formatDuration(relativeEnd)}
            />
            <TimingItem
              label="Start Time"
              value={new Date(span.startTime).toLocaleTimeString()}
            />
          </div>
        </CollapsibleSection>

        {/* IDs section */}
        <div className="px-4 py-3 border-b border-zinc-100">
          <div className="space-y-2 text-xs">
            <IdRow label="Span ID" value={span.spanId} />
            <IdRow label="Trace ID" value={span.traceId} />
            {span.parentSpanId && (
              <IdRow label="Parent Span ID" value={span.parentSpanId} />
            )}
          </div>
        </div>

        <div className="px-4 py-3 border-b border-zinc-100">
          <div className="flex items-center gap-2 mb-2">
            <Tag size={14} className="text-zinc-500" />
            <span className="text-xs font-medium text-zinc-700">Resource</span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <TimingItem label="Trace Service" value={trace.service} />
            <TimingItem label="Derived Resource" value={resourceName} />
            <TimingItem label="Resource Type" value={resourceType} />
            <TimingItem
              label="Resource Attrs"
              value={String(resourceAttributes.length)}
            />
          </div>
        </div>

        {/* Relationships */}
        {(parentSpan || childSpans.length > 0) && (
          <div className="px-4 py-3 border-b border-zinc-100">
            <div className="flex items-center gap-2 mb-2">
              <Layers size={14} className="text-zinc-500" />
              <span className="text-xs font-medium text-zinc-700">
                Relationships
              </span>
            </div>
            <div className="space-y-2 text-xs">
              {parentSpan && (
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500">Parent:</span>
                  <span className="font-medium text-zinc-900">
                    {parentSpan.name}
                  </span>
                </div>
              )}
              {childSpans.length > 0 && (
                <div>
                  <span className="text-zinc-500">
                    Children ({childSpans.length}):
                  </span>
                  <div className="mt-1 space-y-1 pl-2">
                    {childSpans.slice(0, 5).map((child) => (
                      <div
                        key={child.spanId}
                        className="text-zinc-700 truncate"
                      >
                        {child.name}
                      </div>
                    ))}
                    {childSpans.length > 5 && (
                      <div className="text-zinc-400">
                        +{childSpans.length - 5} more
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Attributes section */}
        {hasAttributes && (
          <CollapsibleSection
            title={`Attributes (${Object.keys(span.attributes).length})`}
            icon={<Tag size={14} />}
            expanded={expandedSections.attributes}
            onToggle={() => toggleSection('attributes')}
          >
            <Copyable content={JSON.stringify(span.attributes, null, 2)}>
              <div className="bg-zinc-50 rounded p-3 border border-zinc-200 font-mono text-xs max-h-[200px] overflow-auto">
                {sortedAttributes.map(([key, value]) => {
                  const isSensitive = /(password|secret|token|authorization|api[-_.]?key)/i.test(key);
                  const isResourceAttribute =
                    key.startsWith('service.') ||
                    key.startsWith('deployment.') ||
                    key.startsWith('host.') ||
                    key.startsWith('container.') ||
                    key.startsWith('process.');

                  return (
                  <div key={key} className="flex gap-2 py-0.5">
                    <span className="text-zinc-500 flex-shrink-0">{key}:</span>
                    <span className="text-zinc-800 break-all">
                      {isSensitive ? '[redacted]' : null}
                      {!isSensitive
                        ? typeof value === 'object'
                          ? JSON.stringify(value)
                          : String(value)
                        : null}
                    </span>
                    <span
                      className={cn(
                        'text-[10px] uppercase tracking-wide ml-auto',
                        isSensitive ? 'text-red-500' : 'text-zinc-400',
                      )}
                    >
                      {isSensitive
                        ? 'sensitive'
                        : isResourceAttribute
                          ? 'resource'
                          : 'span'}
                    </span>
                  </div>
                  );
                })}
              </div>
            </Copyable>
          </CollapsibleSection>
        )}

        {/* Events section */}
        {hasEvents && (
          <CollapsibleSection
            title={`Events (${span.events!.length})`}
            icon={<Info size={14} />}
            expanded={expandedSections.events}
            onToggle={() => toggleSection('events')}
          >
            <div className="space-y-2">
              {span.events!.map((event, idx) => (
                <div
                  key={idx}
                  className="bg-zinc-50 rounded p-2.5 border border-zinc-200"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-xs text-zinc-900">
                      {event.name}
                    </span>
                    <span className="text-[10px] text-zinc-500">
                      +{formatDuration(event.timestamp - span.startTime)}
                    </span>
                  </div>
                  {event.attributes &&
                    Object.keys(event.attributes).length > 0 && (
                      <Copyable
                        content={JSON.stringify(event.attributes, null, 2)}
                      >
                        <div className="font-mono text-[11px] text-zinc-600 mt-1">
                          <pre className="whitespace-pre-wrap break-words">
                            {JSON.stringify(event.attributes, null, 2)}
                          </pre>
                        </div>
                      </Copyable>
                    )}
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
}

interface CollapsibleSectionProps {
  title: string;
  icon: any;
  expanded: boolean;
  onToggle: () => void;
  children: any;
}

function CollapsibleSection({
  title,
  icon,
  expanded,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  return (
    <div className="border-b border-zinc-100">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-3 hover:bg-zinc-50 transition-colors"
      >
        <span className="text-zinc-500">{icon}</span>
        <span className="text-xs font-medium text-zinc-700 flex-1 text-left">
          {title}
        </span>
        <ChevronDown
          size={14}
          className={cn(
            'text-zinc-400 transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>
      {expanded && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

interface TimingItemProps {
  label: string;
  value: string;
}

function TimingItem({ label, value }: TimingItemProps) {
  return (
    <div>
      <div className="text-zinc-500 mb-0.5">{label}</div>
      <div className="font-mono font-medium text-zinc-900">{value}</div>
    </div>
  );
}

interface IdRowProps {
  label: string;
  value: string;
}

function IdRow({ label, value }: IdRowProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-zinc-500 w-24 flex-shrink-0">{label}:</span>
      <code className="font-mono text-zinc-700 truncate flex-1">{value}</code>
      <button
        onClick={handleCopy}
        className="p-1 hover:bg-zinc-100 rounded transition-colors flex-shrink-0"
        title="Copy to clipboard"
      >
        {copied ? (
          <Check size={12} className="text-green-500" />
        ) : (
          <Copy size={12} className="text-zinc-400" />
        )}
      </button>
    </div>
  );
}

export default SpanDetailPanel;
