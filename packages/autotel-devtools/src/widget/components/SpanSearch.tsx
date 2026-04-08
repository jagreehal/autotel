import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { Search, X, ChevronUp, ChevronDown } from 'lucide-preact';
import { cn } from '../utils/cn';
import type { SpanData } from '../types';

interface SpanSearchProps {
  spans: SpanData[];
  onMatchesChange: (matchedSpanIds: Set<string>) => void;
  onCurrentMatchChange: (spanId: string | null) => void;
  debounceMs?: number;
}

function searchSpan(span: SpanData, query: string): boolean {
  const q = query.toLowerCase();
  if (span.spanId.toLowerCase().includes(q)) return true;
  if (span.name.toLowerCase().includes(q)) return true;
  if (span.kind.toLowerCase().includes(q)) return true;
  for (const [key, val] of Object.entries(span.attributes)) {
    if (key.toLowerCase().includes(q)) return true;
    if (String(val).toLowerCase().includes(q)) return true;
  }
  if (span.events) {
    for (const event of span.events) {
      if (event.name.toLowerCase().includes(q)) return true;
    }
  }
  return false;
}

export function SpanSearch({
  spans,
  onMatchesChange,
  onCurrentMatchChange,
  debounceMs = 300,
}: SpanSearchProps) {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<string[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const debounceTimer = useRef<number | null>(null);

  useEffect(() => {
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current);
    }

    if (!query.trim()) {
      setMatches([]);
      onMatchesChange(new Set());
      onCurrentMatchChange(null);
      return;
    }

    debounceTimer.current = window.setTimeout(() => {
      const matched = spans
        .filter((s) => searchSpan(s, query))
        .map((s) => s.spanId);
      setMatches(matched);
      setCurrentIdx(0);
      onMatchesChange(new Set(matched));
      onCurrentMatchChange(matched[0] || null);
    }, debounceMs);

    return () => {
      if (debounceTimer.current !== null) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [query, spans, debounceMs]);

  const goNext = () => {
    if (matches.length === 0) return;
    const next = (currentIdx + 1) % matches.length;
    setCurrentIdx(next);
    onCurrentMatchChange(matches[next]);
  };

  const goPrev = () => {
    if (matches.length === 0) return;
    const prev = (currentIdx - 1 + matches.length) % matches.length;
    setCurrentIdx(prev);
    onCurrentMatchChange(matches[prev]);
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50">
      <Search size={14} className="text-gray-400" />
      <input
        type="text"
        value={query}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        placeholder="Search spans... (press /)"
        className="flex-1 text-xs bg-transparent outline-none text-gray-700 placeholder-gray-400"
      />
      {query && (
        <>
          <span className="text-xs text-gray-500">
            {matches.length > 0
              ? `${currentIdx + 1}/${matches.length}`
              : 'No matches'}
          </span>
          <button
            onClick={goPrev}
            className="p-0.5 hover:bg-gray-200 rounded"
            title="Previous (N)"
          >
            <ChevronUp size={12} />
          </button>
          <button
            onClick={goNext}
            className="p-0.5 hover:bg-gray-200 rounded"
            title="Next (n)"
          >
            <ChevronDown size={12} />
          </button>
          <button
            onClick={() => setQuery('')}
            className="p-0.5 hover:bg-gray-200 rounded"
          >
            <X size={12} />
          </button>
        </>
      )}
    </div>
  );
}
