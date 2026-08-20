import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { estimateCost } from '../modules/estimate';
import { respondSafe, READ_ONLY } from './shared';

export function registerEstimateTools(server: McpServer): void {
  server.registerTool(
    'estimate_telemetry_cost',
    {
      description: `Estimate what a month of telemetry costs today against what the same traffic costs once each request emits one canonical log line instead of a line per step.

WHEN TO USE: someone asks whether instrumenting will raise their observability bill, what sampling would save, or how much a given traffic level costs to ingest.

HOW IT WORKS: byte sizes are measured from real serialized records, not assumed — the saving comes from dropping repeated envelope (level, time, pid, hostname, request bindings, once per line) rather than payload, which is why one canonical line is larger than one log line and still smaller than the set it replaces. Spans are counted on the after side, so the answer can and does come back as "this costs more" when tracing is added on top.

No provider rates are bundled: pass perGb (and perMillionEvents when your provider meters indexed events too) from your own bill or the vendor's current price page. A rate this tool invented would be wrong quietly. Sampling via keepPercent applies to both shapes, since any logger can drop events.`,
      annotations: READ_ONLY,
      inputSchema: z.object({
        requestsPerMonth: z
          .number()
          .positive()
          .describe('Requests the application serves per month'),
        perGb: z
          .number()
          .positive()
          .describe('USD per gigabyte ingested, from your provider'),
        logLinesPerRequest: z
          .number()
          .min(1)
          .default(4)
          .describe('Log lines written per request today'),
        spansPerRequest: z
          .number()
          .min(0)
          .default(0)
          .describe('Spans exported per request after instrumenting'),
        perMillionEvents: z
          .number()
          .min(0)
          .default(0)
          .describe(
            'USD per million events indexed; 0 when only bytes are metered',
          ),
        keepPercent: z
          .number()
          .min(1)
          .max(100)
          .default(100)
          .describe('Traffic kept after sampling, applied to both shapes'),
      }),
    },
    async (input) => respondSafe(async () => estimateCost(input)),
  );
}
