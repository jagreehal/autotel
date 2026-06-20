import { Command } from 'commander';
import { toSpanSearchQuery, type SpanRecord, type TagValue } from 'autotel-mcp';
import { runInvestigate, type InvestigateFlags } from './runtime';
import {
  addBackendFlags,
  addTimeWindowFlags,
  backendFlagsFromOpts,
  windowFlagsFromOpts,
  type TimeWindowFlags,
} from './cli-helpers';

/**
 * `autotel security` — security telemetry for incident triage.
 *
 * Reads the stable schema emitted by autotel-audit:
 * - `security.event` / `security.category` / `security.severity` /
 *   `security.outcome` span attributes (securityEvent / withSecurity)
 * - `security.suspicious_request` + `security.signal`
 *   (createSecuritySignalProcessor)
 * - denied HTTP responses (401/403/429)
 */

export type SecurityWindowFlags = InvestigateFlags & TimeWindowFlags;

export type SecuritySummaryFlags = SecurityWindowFlags & {
  deniedStatuses?: number[];
};

export type SecurityEventsFlags = SecurityWindowFlags & {
  category?: string;
  severity?: string;
};

const DEFAULT_LIMIT = 500;
// Mirrors SECURITY_DENIED_STATUSES in `autotel/security-schema` — the CLI
// deliberately avoids depending on the full autotel package, so keep this
// literal in sync with the schema module.
const DEFAULT_DENIED_STATUSES = [401, 403, 429];
const SAMPLE_TRACE_IDS = 10;

function countBy(
  spans: SpanRecord[],
  tagKey: string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const span of spans) {
    const value = span.tags[tagKey];
    if (value === undefined) continue;
    const key = String(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function topEntries(
  counts: Record<string, number>,
  n: number,
): Array<{ value: string; count: number }> {
  return Object.entries(counts)
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([value, count]) => ({ value, count }));
}

function sampleTraceIds(spans: SpanRecord[]): string[] {
  const ids = new Set<string>();
  for (const span of spans) {
    ids.add(span.traceId);
    if (ids.size >= SAMPLE_TRACE_IDS) break;
  }
  return [...ids];
}

function dedupeSpans(...lists: SpanRecord[][]): SpanRecord[] {
  const seen = new Set<string>();
  const merged: SpanRecord[] = [];
  for (const list of lists) {
    for (const span of list) {
      const key = `${span.traceId}:${span.spanId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(span);
    }
  }
  return merged;
}

function countByService(spans: SpanRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const span of spans) {
    counts[span.serviceName] = (counts[span.serviceName] ?? 0) + 1;
  }
  return counts;
}

function readStatus(span: SpanRecord): number | undefined {
  // Current semconv attribute first, legacy fallback second — mirrors
  // HTTP_STATUS_ATTRIBUTES in `autotel/security-schema`.
  const value =
    span.tags['http.response.status_code'] ?? span.tags['http.status_code'];
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

export async function runSecuritySummary(
  flags: SecuritySummaryFlags,
): Promise<void> {
  await runInvestigate('security summary', flags, async (backend) => {
    const limit = flags.limit ?? DEFAULT_LIMIT;
    const deniedStatuses = flags.deniedStatuses ?? DEFAULT_DENIED_STATUSES;
    const base = toSpanSearchQuery({
      serviceName: flags.serviceName,
      lookbackMinutes: flags.lookbackMinutes,
      from: flags.from,
      to: flags.to,
      limit,
    });

    const statusValues = deniedStatuses as TagValue[];
    const [events, suspicious, deniedNew, deniedLegacy] = await Promise.all([
      backend.searchSpans({
        ...base,
        filters: [{ field: 'security.event', operator: 'exists' }],
      }),
      backend.searchSpans({
        ...base,
        filters: [
          { field: 'security.suspicious_request', operator: 'exists' },
        ],
      }),
      backend.searchSpans({
        ...base,
        filters: [
          {
            field: 'http.response.status_code',
            operator: 'in',
            value: statusValues,
            valueType: 'number',
          },
        ],
      }),
      backend.searchSpans({
        ...base,
        filters: [
          {
            field: 'http.status_code',
            operator: 'in',
            value: statusValues,
            valueType: 'number',
          },
        ],
      }),
    ]);

    const denied = dedupeSpans(deniedNew.items, deniedLegacy.items);
    const deniedByStatus: Record<string, number> = {};
    for (const span of denied) {
      const status = readStatus(span);
      if (status === undefined) continue;
      deniedByStatus[status] = (deniedByStatus[status] ?? 0) + 1;
    }

    return {
      window: {
        lookbackMinutes: flags.lookbackMinutes ?? 60,
        from: flags.from,
        to: flags.to,
        limitPerQuery: limit,
      },
      securityEvents: {
        total: events.items.length,
        bySeverity: countBy(events.items, 'security.severity'),
        byCategory: countBy(events.items, 'security.category'),
        byOutcome: countBy(events.items, 'security.outcome'),
        topEvents: topEntries(countBy(events.items, 'security.event'), 10),
        sampleTraceIds: sampleTraceIds(events.items),
      },
      suspiciousRequests: {
        total: suspicious.items.length,
        bySignal: countBy(suspicious.items, 'security.signal'),
        byService: countByService(suspicious.items),
        sampleTraceIds: sampleTraceIds(suspicious.items),
      },
      deniedResponses: {
        total: denied.length,
        byStatus: deniedByStatus,
        topClients: topEntries(countBy(denied, 'client.address'), 10),
        sampleTraceIds: sampleTraceIds(denied),
      },
    };
  });
}

export async function runSecurityEvents(
  flags: SecurityEventsFlags,
): Promise<void> {
  await runInvestigate('security events', flags, async (backend) => {
    const base = toSpanSearchQuery({
      serviceName: flags.serviceName,
      lookbackMinutes: flags.lookbackMinutes,
      from: flags.from,
      to: flags.to,
      limit: flags.limit ?? DEFAULT_LIMIT,
    });

    const filters: NonNullable<typeof base.filters> = [
      { field: 'security.event', operator: 'exists' },
    ];
    if (flags.category !== undefined) {
      filters.push({
        field: 'security.category',
        operator: 'equals',
        value: flags.category,
      });
    }
    if (flags.severity !== undefined) {
      filters.push({
        field: 'security.severity',
        operator: 'equals',
        value: flags.severity,
      });
    }

    const result = await backend.searchSpans({ ...base, filters });
    return {
      totalCount: result.totalCount,
      items: result.items.map((span) => ({
        traceId: span.traceId,
        spanId: span.spanId,
        serviceName: span.serviceName,
        operationName: span.operationName,
        startTimeUnixMs: span.startTimeUnixMs,
        event: span.tags['security.event'],
        category: span.tags['security.category'],
        outcome: span.tags['security.outcome'],
        severity: span.tags['security.severity'],
        reason: span.tags['security.reason'],
      })),
    };
  });
}

/**
 * `autotel security mcp` — MCP protocol-boundary security signals emitted by
 * `autotel-mcp-instrumentation`:
 * - `mcp.security.injection.*` — pluggable classifier verdicts on tool args/results
 * - `mcp.security.budget.exceeded` — tool output over the configured char budget
 * - `mcp.tool.untrusted_content` — tools flagged via the WebMCP untrustedContentHint
 *
 * Keep these field literals in sync with `MCP_SEMCONV` in
 * `autotel-mcp-instrumentation/semantic-conventions`.
 */
const MCP_TOOL_NAME = 'gen_ai.tool.name';
const MCP_INJECTION_VERDICT = 'mcp.security.injection.verdict';
const MCP_INJECTION_SOURCE = 'mcp.security.injection.source';
const MCP_BUDGET_EXCEEDED = 'mcp.security.budget.exceeded';
const MCP_UNTRUSTED_CONTENT = 'mcp.tool.untrusted_content';

export async function runSecurityMcp(
  flags: SecurityWindowFlags,
): Promise<void> {
  await runInvestigate('security mcp', flags, async (backend) => {
    const base = toSpanSearchQuery({
      serviceName: flags.serviceName,
      lookbackMinutes: flags.lookbackMinutes,
      from: flags.from,
      to: flags.to,
      limit: flags.limit ?? DEFAULT_LIMIT,
    });

    const [injection, budget, untrusted] = await Promise.all([
      backend.searchSpans({
        ...base,
        filters: [{ field: MCP_INJECTION_VERDICT, operator: 'exists' }],
      }),
      backend.searchSpans({
        ...base,
        filters: [{ field: MCP_BUDGET_EXCEEDED, operator: 'exists' }],
      }),
      backend.searchSpans({
        ...base,
        filters: [{ field: MCP_UNTRUSTED_CONTENT, operator: 'exists' }],
      }),
    ]);

    const suspected = injection.items.filter(
      (span) =>
        span.tags[MCP_INJECTION_VERDICT] !== undefined &&
        String(span.tags[MCP_INJECTION_VERDICT]) !== 'clean',
    );
    const untrustedTrue = untrusted.items.filter(
      (span) => String(span.tags[MCP_UNTRUSTED_CONTENT]) === 'true',
    );

    return {
      window: {
        lookbackMinutes: flags.lookbackMinutes ?? 60,
        from: flags.from,
        to: flags.to,
        limitPerQuery: flags.limit ?? DEFAULT_LIMIT,
      },
      injection: {
        scanned: injection.items.length,
        suspected: suspected.length,
        byVerdict: countBy(injection.items, MCP_INJECTION_VERDICT),
        bySource: countBy(suspected, MCP_INJECTION_SOURCE),
        byTool: topEntries(countBy(suspected, MCP_TOOL_NAME), 10),
        sampleTraceIds: sampleTraceIds(suspected),
      },
      budgetBreaches: {
        total: budget.items.length,
        byTool: topEntries(countBy(budget.items, MCP_TOOL_NAME), 10),
        byService: countByService(budget.items),
        sampleTraceIds: sampleTraceIds(budget.items),
      },
      untrustedContent: {
        toolCalls: untrustedTrue.length,
        byTool: topEntries(countBy(untrustedTrue, MCP_TOOL_NAME), 10),
      },
    };
  });
}

function csvIntArg(value: string): number[] {
  return value
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((n) => !Number.isNaN(n));
}

export function registerSecurityCommands(program: Command): void {
  const securityCmd = new Command('security').description(
    'Security telemetry: events, suspicious requests, denied responses (JSON)',
  );

  const summaryCmd = addTimeWindowFlags(new Command('summary'))
    .description(
      'Security posture summary: events by severity/category, probe signals, denied responses with top clients',
    )
    .option(
      '--denied-statuses <csv>',
      'HTTP statuses counted as denied (default 401,403,429)',
      csvIntArg,
    )
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runSecuritySummary({
        ...backendFlagsFromOpts(o),
        ...windowFlagsFromOpts(o),
        deniedStatuses: o.deniedStatuses as number[] | undefined,
      });
    });

  const eventsCmd = addTimeWindowFlags(new Command('events'))
    .description('List spans carrying security events (security.* schema)')
    .option('--category <name>', 'Filter by security.category')
    .option('--severity <level>', 'Filter by security.severity')
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runSecurityEvents({
        ...backendFlagsFromOpts(o),
        ...windowFlagsFromOpts(o),
        category: o.category as string | undefined,
        severity: o.severity as string | undefined,
      });
    });

  const mcpCmd = addTimeWindowFlags(new Command('mcp'))
    .description(
      'MCP protocol-boundary security: prompt-injection verdicts, output-budget breaches, untrusted-content tool calls',
    )
    .action(async function (this: Command) {
      const o = this.optsWithGlobals();
      await runSecurityMcp({
        ...backendFlagsFromOpts(o),
        ...windowFlagsFromOpts(o),
      });
    });

  addBackendFlags(securityCmd);
  securityCmd.addCommand(summaryCmd);
  securityCmd.addCommand(eventsCmd);
  securityCmd.addCommand(mcpCmd);
  program.addCommand(securityCmd);
}
