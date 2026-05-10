/**
 * Logs view - OTel log stream with optional trace linking
 */

import { h } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { FileText, Link2, Pause, Play, Search, X } from 'lucide-preact';
import {
  sortedLogsSignal,
  setSelectedTrace,
  setSelectedTab,
  pausedSignal,
  pendingLogCountSignal,
  togglePaused,
  dropPendingBuffer,
} from '../store';
import { formatTimestamp } from '../utils';
import { cn } from '../utils/cn';
import type { LogData } from '../types';

type SeverityFilter = 'all' | 'error' | 'warn' | 'info';

function severityRank(log: LogData): SeverityFilter {
  const severityNumber = log.severityNumber;
  const text = (log.severityText ?? '').toUpperCase();
  if (text === 'ERROR' || (severityNumber !== undefined && severityNumber >= 17))
    return 'error';
  if (
    text === 'WARN' ||
    text === 'WARNING' ||
    (severityNumber !== undefined && severityNumber >= 13)
  )
    return 'warn';
  return 'info';
}

function logBodyText(body: string | Record<string, unknown>): string {
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function logMatches(
  log: LogData,
  query: string,
  severity: SeverityFilter,
): boolean {
  if (severity !== 'all') {
    const rank = severityRank(log);
    if (severity === 'error' && rank !== 'error') return false;
    if (severity === 'warn' && rank !== 'warn' && rank !== 'error') return false;
    if (severity === 'info' && rank !== 'info') return false;
  }
  if (!query) return true;
  const needle = query.toLowerCase();
  if (logBodyText(log.body).toLowerCase().includes(needle)) return true;
  if (log.severityText?.toLowerCase().includes(needle)) return true;
  if (log.resourceName?.toLowerCase().includes(needle)) return true;
  if (log.traceId?.toLowerCase().includes(needle)) return true;
  return false;
}

function severityColor(severityText?: string, severityNumber?: number): string {
  const s = (severityText ?? '').toUpperCase();
  if (s === 'ERROR' || (severityNumber !== undefined && severityNumber >= 17))
    return 'text-red-700 bg-red-50 border-red-200';
  if (s === 'WARN' || s === 'WARNING' || (severityNumber !== undefined && severityNumber >= 13))
    return 'text-amber-700 bg-amber-50 border-amber-200';
  if (s === 'INFO' || (severityNumber !== undefined && severityNumber >= 9))
    return 'text-zinc-700 bg-zinc-50 border-zinc-200';
  if (s === 'DEBUG') return 'text-zinc-600 bg-zinc-50 border-zinc-200';
  return 'text-zinc-700 bg-zinc-50 border-zinc-200';
}

export function LogsView() {
  const logs = sortedLogsSignal.value;
  const paused = pausedSignal.value;
  const pendingCount = pendingLogCountSignal.value;
  const [query, setQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');

  const filtered = useMemo(
    () => logs.filter((log) => logMatches(log, query, severityFilter)),
    [logs, query, severityFilter],
  );

  const isFiltered = query.length > 0 || severityFilter !== 'all';

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-2 text-zinc-900">
          <FileText size={16} />
          Logs ({isFiltered ? `${filtered.length} of ${logs.length}` : logs.length})
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={togglePaused}
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors',
              paused
                ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                : 'hover:bg-zinc-100 text-zinc-600',
            )}
            title={paused ? 'Resume live tail' : 'Pause live tail'}
          >
            {paused ? <Play size={12} /> : <Pause size={12} />}
            {paused
              ? `Resume${pendingCount > 0 ? ` (+${pendingCount})` : ''}`
              : 'Pause'}
          </button>
          {paused && pendingCount > 0 && (
            <button
              onClick={dropPendingBuffer}
              className="px-2 py-1 text-xs rounded text-zinc-500 hover:bg-zinc-100 transition-colors"
              title="Drop buffered logs received while paused"
            >
              Drop buffer
            </button>
          )}
        </div>
      </div>

      <div className="px-4 py-2 border-b border-zinc-200 flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400"
          />
          <input
            value={query}
            onInput={(event) =>
              setQuery((event.currentTarget as HTMLInputElement).value)
            }
            className="w-full pl-7 pr-7 py-1 text-xs rounded border border-zinc-200 focus:border-zinc-400 focus:outline-none"
            placeholder="Filter by message, resource, trace id…"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-zinc-400 hover:text-zinc-700"
              title="Clear filter"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <select
          value={severityFilter}
          onChange={(event) =>
            setSeverityFilter(
              (event.currentTarget as HTMLSelectElement).value as SeverityFilter,
            )
          }
          className="text-xs border border-zinc-200 rounded px-1.5 py-1 bg-white text-zinc-700"
        >
          <option value="all">All</option>
          <option value="error">Errors</option>
          <option value="warn">Warn+</option>
          <option value="info">Info</option>
        </select>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-2">
        {logs.length === 0 ? (
          <div className="text-center text-zinc-500 text-sm py-12">
            No logs yet. Send logs via AutotelLogExporter or POST /ingest/logs.
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center text-zinc-500 text-sm py-12">
            No logs match the current filter.
          </div>
        ) : (
          filtered.map((log) => <LogRow key={log.id} log={log} />)
        )}
      </div>
    </div>
  );
}

function LogRow({ log }: { log: LogData }) {
  const colorClass = severityColor(log.severityText, log.severityNumber);
  const body = logBodyText(log.body);

  const goToTrace = () => {
    if (log.traceId) {
      setSelectedTrace(log.traceId);
      setSelectedTab('traces');
    }
  };

  return (
    <div
      className={cn(
        'p-3 rounded-md border text-sm',
        colorClass,
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <span className="font-medium text-xs uppercase">
          {log.severityText ?? 'LOG'}
        </span>
        <span className="text-xs text-zinc-500 flex-shrink-0">
          {formatTimestamp(log.timestamp)}
        </span>
      </div>
      <div className="font-mono text-xs break-words mb-2">{body}</div>
      {log.traceId && (
        <button
          type="button"
          onClick={goToTrace}
          className="inline-flex items-center gap-1 text-xs text-zinc-600 hover:underline"
        >
          <Link2 size={12} />
          Go to trace
        </button>
      )}
    </div>
  );
}
