/**
 * Errors view - displays aggregated error groups
 */

import { h, Fragment } from 'preact';
import { useState } from 'preact/hooks';
import {
  AlertTriangle,
  Clock,
  Hash,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from 'lucide-preact';
import {
  errorGroupsSignal,
  sortedErrorGroupsSignal,
  errorGroupsByFrequencySignal,
  totalErrorCountSignal,
  recentErrorCountSignal,
  setSelectedTrace,
  setSelectedTab,
} from '../store';
import { formatTimestamp, formatDuration } from '../utils';
import { cn } from '../utils/cn';
import type { ErrorGroup } from '../types';

type SortMode = 'recent' | 'frequent';

export function ErrorsView() {
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const errorGroups =
    sortMode === 'recent'
      ? sortedErrorGroupsSignal.value
      : errorGroupsByFrequencySignal.value;
  const totalErrors = totalErrorCountSignal.value;
  const recentErrors = recentErrorCountSignal.value;

  const toggleGroup = (fingerprint: string) => {
    setExpandedGroup(expandedGroup === fingerprint ? null : fingerprint);
  };

  const viewTrace = (traceId: string) => {
    setSelectedTrace(traceId);
    setSelectedTab('traces');
  };

  return (
    <div className="flex flex-col h-full p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-200">
        <h3 className="text-sm font-semibold flex items-center gap-2 text-zinc-900">
          <AlertTriangle size={16} className="text-red-500" />
          Errors
          {totalErrors > 0 && (
            <span className="ml-1 px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
              {totalErrors}
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <select
            className="text-xs border border-zinc-200 rounded px-2 py-1 bg-white text-zinc-700"
            value={sortMode}
            onChange={(e) =>
              setSortMode((e.target as HTMLSelectElement).value as SortMode)
            }
          >
            <option value="recent">Most Recent</option>
            <option value="frequent">Most Frequent</option>
          </select>
        </div>
      </div>

      {/* Stats bar */}
      {totalErrors > 0 && (
        <div className="flex gap-4 mb-4 p-3 bg-zinc-50 rounded-md border border-zinc-200">
          <div className="text-sm">
            <span className="text-zinc-600">Groups:</span>{' '}
            <span className="font-semibold text-zinc-900">
              {errorGroups.length}
            </span>
          </div>
          <div className="text-sm">
            <span className="text-zinc-600">Total:</span>{' '}
            <span className="font-semibold text-zinc-900">{totalErrors}</span>
          </div>
          <div className="text-sm">
            <span className="text-zinc-600">Last hour:</span>{' '}
            <span className="font-semibold text-red-600">{recentErrors}</span>
          </div>
        </div>
      )}

      {/* Error groups list */}
      <div className="flex-1 overflow-auto space-y-2">
        {errorGroups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 py-12">
            <AlertTriangle size={32} className="mb-2 text-zinc-400" />
            <p className="text-sm">No errors captured</p>
            <p className="text-xs text-zinc-400 mt-1">
              Errors from failed traces will appear here
            </p>
          </div>
        ) : (
          errorGroups.map((group) => (
            <ErrorGroupCard
              key={group.fingerprint}
              group={group}
              isExpanded={expandedGroup === group.fingerprint}
              onToggle={() => toggleGroup(group.fingerprint)}
              onViewTrace={viewTrace}
            />
          ))
        )}
      </div>
    </div>
  );
}

interface ErrorGroupCardProps {
  group: ErrorGroup;
  isExpanded: boolean;
  onToggle: () => void;
  onViewTrace: (traceId: string) => void;
}

function ErrorGroupCard({
  group,
  isExpanded,
  onToggle,
  onViewTrace,
}: ErrorGroupCardProps) {
  const timeSinceFirstSeen = Date.now() - group.firstSeen;
  const timeSinceLastSeen = Date.now() - group.lastSeen;

  return (
    <div className="border border-zinc-200 rounded-md bg-white overflow-hidden">
      {/* Header - clickable */}
      <button
        onClick={onToggle}
        className="w-full p-3 flex items-start gap-3 hover:bg-zinc-50 transition-colors text-left"
      >
        <div className="mt-0.5">
          {isExpanded ? (
            <ChevronDown size={16} className="text-zinc-400" />
          ) : (
            <ChevronRight size={16} className="text-zinc-400" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Error type and count */}
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-semibold text-red-600">
              {group.type}
            </span>
            <span className="px-1.5 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded">
              {group.count}x
            </span>
            {group.service && (
              <span className="px-1.5 py-0.5 text-xs font-medium bg-zinc-100 text-zinc-600 rounded">
                {group.service}
              </span>
            )}
          </div>

          {/* Error message */}
          <p className="text-sm text-zinc-700 truncate mb-2">{group.message}</p>

          {/* Timestamps */}
          <div className="flex items-center gap-4 text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              <Clock size={12} />
              First: {formatRelativeTime(timeSinceFirstSeen)}
            </span>
            <span className="flex items-center gap-1">
              <Clock size={12} />
              Last: {formatRelativeTime(timeSinceLastSeen)}
            </span>
          </div>
        </div>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-zinc-200 p-3 bg-zinc-50 space-y-3">
          {/* Stack trace */}
          {group.stackTrace && (
            <div>
              <h5 className="text-xs font-semibold text-zinc-700 mb-1.5">
                Stack Trace
              </h5>
              <pre className="text-xs font-mono bg-zinc-900 text-zinc-100 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                {group.stackTrace}
              </pre>
            </div>
          )}

          {/* Affected spans */}
          {group.affectedSpans.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold text-zinc-700 mb-1.5">
                Affected Operations
              </h5>
              <div className="flex flex-wrap gap-1">
                {group.affectedSpans.map((span, i) => (
                  <span
                    key={i}
                    className="px-2 py-0.5 text-xs font-mono bg-zinc-200 text-zinc-700 rounded"
                  >
                    {span}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Affected traces */}
          {group.affectedTraces.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold text-zinc-700 mb-1.5">
                Recent Traces
              </h5>
              <div className="space-y-1">
                {group.affectedTraces.slice(0, 5).map((traceId) => (
                  <button
                    key={traceId}
                    onClick={() => onViewTrace(traceId)}
                    className="flex items-center gap-1 text-xs text-zinc-600 hover:text-zinc-900 font-mono"
                  >
                    <Hash size={10} />
                    {traceId.slice(0, 16)}...
                    <ExternalLink size={10} />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Attributes */}
          {group.attributes && Object.keys(group.attributes).length > 0 && (
            <div>
              <h5 className="text-xs font-semibold text-zinc-700 mb-1.5">
                Context
              </h5>
              <div className="text-xs space-y-0.5">
                {Object.entries(group.attributes).map(([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <span className="text-zinc-500">{key}:</span>
                    <span className="font-mono text-zinc-700">
                      {String(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Full timestamps */}
          <div className="text-xs text-zinc-500 pt-2 border-t border-zinc-200">
            <div className="flex gap-4">
              <span>First seen: {formatTimestamp(group.firstSeen)}</span>
              <span>Last seen: {formatTimestamp(group.lastSeen)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
