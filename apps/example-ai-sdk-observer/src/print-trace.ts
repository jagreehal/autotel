import { SpanKind, SpanStatusCode, type HrTime } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';

const KIND_LABEL: Record<number, string> = {
  [SpanKind.INTERNAL]: 'internal',
  [SpanKind.CLIENT]: 'client',
  [SpanKind.SERVER]: 'server',
  [SpanKind.PRODUCER]: 'producer',
  [SpanKind.CONSUMER]: 'consumer',
};

/** Render captured spans as a tree, surfacing the canonical gen_ai.* fields. */
export function printTrace(spans: ReadableSpan[]): void {
  if (spans.length === 0) {
    console.log('  (no spans captured)');
    return;
  }
  const ids = new Set(spans.map((s) => s.spanContext().spanId));
  const childrenOf = new Map<string, ReadableSpan[]>();
  const roots: ReadableSpan[] = [];
  for (const span of spans) {
    const parentId = span.parentSpanContext?.spanId;
    if (parentId && ids.has(parentId)) {
      const siblings = childrenOf.get(parentId) ?? [];
      siblings.push(span);
      childrenOf.set(parentId, siblings);
    } else {
      roots.push(span);
    }
  }

  const byStart = (a: ReadableSpan, b: ReadableSpan) =>
    hrToMs(a.startTime) - hrToMs(b.startTime);
  const walk = (span: ReadableSpan, depth: number) => {
    console.log(formatSpan(span, depth));
    const children = childrenOf.get(span.spanContext().spanId) ?? [];
    for (const child of children.sort(byStart)) walk(child, depth + 1);
  };
  for (const root of roots.sort(byStart)) walk(root, 0);
}

function formatSpan(span: ReadableSpan, depth: number): string {
  const a = span.attributes;
  const prefix = depth === 0 ? '' : `${'  '.repeat(depth)}└ `;
  const head = `${prefix}${span.name} [${KIND_LABEL[span.kind] ?? span.kind}]`;

  const detail: string[] = [];
  const input = a['gen_ai.usage.input_tokens'];
  const output = a['gen_ai.usage.output_tokens'];
  if (input !== undefined || output !== undefined) {
    detail.push(`tokens ${input ?? '?'}→${output ?? '?'}`);
  }
  const cost = a['gen_ai.usage.cost.usd'];
  if (cost !== undefined) detail.push(`$${Number(cost).toFixed(6)}`);

  // Streaming timing — an autotel-genai extension over @ai-sdk/otel.
  const ttfc = a['gen_ai.response.time_to_first_chunk'];
  if (ttfc !== undefined) detail.push(`ttfc ${Number(ttfc).toFixed(2)}s`);
  const tps = a['gen_ai.response.output_tokens_per_second'];
  if (tps !== undefined) detail.push(`${Number(tps).toFixed(1)} tok/s`);

  const args = a['gen_ai.tool.call.arguments'];
  if (args !== undefined) detail.push(`args ${String(args)}`);
  const result = a['gen_ai.tool.call.result'];
  if (result !== undefined) detail.push(`result ${String(result)}`);
  if (span.status.code === SpanStatusCode.ERROR) {
    detail.push(`ERROR ${span.status.message ?? ''}`.trim());
  }

  return detail.length > 0 ? `${head}  —  ${detail.join(' · ')}` : head;
}

function hrToMs(time: HrTime): number {
  return time[0] * 1000 + time[1] / 1e6;
}
