/**
 * Span kind and status label utilities.
 * Maps OTLP integer enums to human-readable labels.
 */

const SPAN_KIND_LABELS: Record<number, string> = {
  0: 'UNSPECIFIED',
  1: 'INTERNAL',
  2: 'SERVER',
  3: 'CLIENT',
  4: 'PRODUCER',
  5: 'CONSUMER',
};

export function spanKindLabel(kind: number): string {
  return SPAN_KIND_LABELS[kind] ?? 'UNKNOWN';
}

const STATUS_LABELS: Record<number, string> = {
  0: 'UNSET',
  1: 'OK',
  2: 'ERROR',
};

export function statusLabel(code: number): string {
  return STATUS_LABELS[code] ?? 'UNKNOWN';
}
