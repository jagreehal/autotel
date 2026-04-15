import { z } from 'zod';

const configSchema = z.object({
  backend: z.enum(['collector', 'jaeger']).default('collector'),
  transport: z.enum(['stdio', 'http']).default('stdio'),
  port: z.coerce.number().default(3000),
  host: z.string().default('127.0.0.1'),
  collectorPort: z.coerce.number().default(4318),
  persist: z.string().optional(),
  retentionMs: z.coerce.number().optional(),
  maxTraces: z.coerce.number().default(10_000),
  jaegerBaseUrl: z.string().default('http://localhost:16686'),
  fixturePath: z.string().default('./fixtures/telemetry.json'),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(): AppConfig {
  const raw = {
    backend: process.env.AUTOTEL_BACKEND,
    transport: process.env.AUTOTEL_TRANSPORT,
    port: process.env.AUTOTEL_PORT,
    host: process.env.AUTOTEL_HOST,
    collectorPort: process.env.AUTOTEL_COLLECTOR_PORT,
    persist: process.env.AUTOTEL_PERSIST,
    retentionMs: process.env.AUTOTEL_RETENTION_MS,
    maxTraces: process.env.AUTOTEL_MAX_TRACES,
    jaegerBaseUrl: process.env.JAEGER_BASE_URL,
    fixturePath: process.env.AUTOTEL_FIXTURE_PATH,
  };

  const config = configSchema.parse(raw);

  // Default retention: 1h in-memory, 24h persistent
  if (config.retentionMs === undefined) {
    config.retentionMs = config.persist ? 86_400_000 : 3_600_000;
  }

  return config;
}
