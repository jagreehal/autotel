/**
 * Logs view - OTel log stream with optional trace linking
 */

import { h } from 'preact';
import { FileText, Link2 } from 'lucide-preact';
import { sortedLogsSignal } from '../store';
import { setSelectedTrace, setSelectedTab } from '../store';
import { formatTimestamp } from '../utils';
import { cn } from '../utils/cn';
import type { LogData } from '../types';

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

function logBodyDisplay(body: string | Record<string, unknown>): string {
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

export function LogsView() {
  const logs = sortedLogsSignal.value;

  return (
    <div className="flex flex-col h-full p-4">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-zinc-200">
        <h3 className="text-sm font-semibold flex items-center gap-2 text-zinc-900">
          <FileText size={16} />
          Logs ({logs.length})
        </h3>
      </div>

      <div className="flex-1 overflow-auto space-y-2">
        {logs.length === 0 ? (
          <div className="text-center text-zinc-500 text-sm py-12">
            No logs yet. Send logs via AutotelLogExporter or POST /ingest/logs.
          </div>
        ) : (
          logs.map((log) => <LogRow key={log.id} log={log} />)
        )}
      </div>
    </div>
  );
}

function LogRow({ log }: { log: LogData }) {
  const colorClass = severityColor(log.severityText, log.severityNumber);
  const body = logBodyDisplay(log.body);

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
