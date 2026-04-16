import { z } from 'zod';

export const otlpReceiverConfigSchema = z.object({
  protocols: z.object({
    grpc: z
      .object({
        endpoint: z.string().optional(),
      })
      .optional(),
    http: z
      .object({
        endpoint: z.string().optional(),
        traces_url_path: z.string().optional(),
        metrics_url_path: z.string().optional(),
        logs_url_path: z.string().optional(),
      })
      .optional(),
  }),
});

export type OtelCollectorValidationResult =
  | { valid: true; summary: string }
  | { valid: false; summary: string; issues: string[] };

export function validateOtlpReceiverConfig(
  input: unknown,
): OtelCollectorValidationResult {
  const result = otlpReceiverConfigSchema.safeParse(input);
  if (result.success) {
    return {
      valid: true,
      summary: 'Valid OTLP receiver config',
    };
  }

  return {
    valid: false,
    summary: 'Invalid OTLP receiver config',
    issues: result.error.issues.map(
      (issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`,
    ),
  };
}

export function suggestCollectorConfig(): string {
  return [
    'Use an otlp receiver with grpc and http enabled.',
    'Default ports are 4317 for gRPC and 4318 for HTTP.',
    'Prefer explicit traces_url_path, metrics_url_path, and logs_url_path when routing is custom.',
  ].join(' ');
}
