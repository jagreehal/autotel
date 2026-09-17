import type { SpanRecord } from '../types';

export interface InstrumentationScore {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  findings: string[];
}

export function scoreSpan(
  span: Pick<SpanRecord, 'operationName' | 'serviceName' | 'tags' | 'hasError'>,
): InstrumentationScore {
  const findings: string[] = [];
  let score = 100;

  if (!span.serviceName || span.serviceName === 'unknown') {
    findings.push('missing service name');
    score -= 30;
  }

  if (!span.operationName || span.operationName === 'unknown') {
    findings.push('missing operation name');
    score -= 20;
  }

  if (span.hasError && !('error' in span.tags)) {
    findings.push('error signal present but not captured consistently in tags');
    score -= 10;
  }

  if (
    !('http.request.method' in span.tags) &&
    !('http.method' in span.tags) &&
    !('rpc.system.name' in span.tags) &&
    !('rpc.system' in span.tags) &&
    !('db.system.name' in span.tags) &&
    !('db.system' in span.tags)
  ) {
    findings.push('no semantic convention tags found');
    score -= 10;
  }

  if (score < 0) score = 0;

  return {
    score,
    grade: toGrade(score),
    findings,
  };
}

export function suggestInstrumentationFixes(
  span: Pick<SpanRecord, 'operationName' | 'serviceName' | 'tags' | 'hasError'>,
): string[] {
  const suggestions: string[] = [];
  if (!span.serviceName || span.serviceName === 'unknown')
    suggestions.push('set service.name on the resource');
  if (!span.operationName || span.operationName === 'unknown')
    suggestions.push('use a stable operation/span name');
  if (span.hasError && !('error' in span.tags))
    suggestions.push('tag error spans consistently');
  return suggestions;
}

function toGrade(score: number): InstrumentationScore['grade'] {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}
