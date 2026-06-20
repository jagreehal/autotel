import {
  AUTOTEL_SAMPLING_TAIL_EVALUATED,
  AUTOTEL_SAMPLING_TAIL_KEEP,
} from 'autotel';
import {
  HTTP_STATUS_ATTRIBUTES,
  SECURITY_ATTR,
  SECURITY_DENIED_STATUSES,
  SECURITY_METRICS,
} from 'autotel/security-schema';
import { lazyCounter } from './lazy-counter';
import { applySecurityEventAttributes } from './security.js';

/**
 * Zero-code security signal derivation from spans you already have.
 *
 * `createSecuritySignalProcessor()` watches ordinary HTTP server spans and:
 *
 * - flags suspicious request paths (traversal, `.env`/`.git` probes,
 *   SQLi/XSS probes) at span start, marking them `security.suspicious_request`
 *   and force-keeping them through tail sampling
 * - counts denied responses (401/403/429 by default) into the
 *   `autotel.security.http.denied` metric
 * - detects auth-failure bursts per client (sliding window) and surfaces
 *   them via the `autotel.security.anomaly` metric and an `onSignal` callback
 *
 * ```typescript
 * init({
 *   service: 'api',
 *   spanProcessors: [createSecuritySignalProcessor()],
 * });
 * ```
 *
 * Detection rules, alert thresholds, and dashboards belong in your
 * observability backend — this processor's job is to make the signals
 * exist, survive sampling, and stay queryable under a stable schema.
 */

// Structural subset of @opentelemetry/sdk-trace-base types — kept local so
// autotel-audit adds no new dependencies. Objects returned here satisfy the
// real SpanProcessor interface structurally (must mirror @opentelemetry/api's
// AttributeValue, including nullable array entries).
type AttributeValue =
  | string
  | number
  | boolean
  | Array<null | undefined | string>
  | Array<null | undefined | number>
  | Array<null | undefined | boolean>;

interface MutableSpanLike {
  attributes: Record<string, AttributeValue | undefined>;
  spanContext?: { traceId: string };
  setAttribute(key: string, value: AttributeValue): unknown;
}

interface ReadableSpanLike {
  attributes: Record<string, AttributeValue | undefined>;
  spanContext?: { traceId: string };
}

export interface SecuritySignalProcessor {
  onStart(span: MutableSpanLike, parentContext?: unknown): void;
  onEnd(span: ReadableSpanLike): void;
  shutdown(): Promise<void>;
  forceFlush(): Promise<void>;
}

export interface SuspiciousRequestSignal {
  signal: 'suspicious_request';
  /** Which pattern matched, e.g. `path_traversal`. */
  pattern: string;
  /** The matched request path/URL (as found on the span). */
  target: string;
}

export interface AuthFailureBurstSignal {
  signal: 'auth_failure_burst';
  /** Value of the configured key attribute (e.g. client address). */
  key: string;
  /** Denied responses observed inside the window. */
  count: number;
  windowMs: number;
  status: number;
}

export interface LlmExcessiveTokensSignal {
  signal: 'llm_excessive_tokens';
  /** Total tokens consumed by the single LLM call. */
  tokens: number;
  maxTokens: number;
  model?: string;
}

export interface LlmTokenBudgetSignal {
  signal: 'llm_token_budget_exceeded';
  /** Value of the configured key attribute (e.g. end-user id). */
  key: string;
  /** Tokens consumed inside the window. */
  tokens: number;
  budget: number;
  windowMs: number;
}

export interface LlmActionChainSuspiciousSignal {
  signal: 'llm_action_chain_suspicious';
  /** Trace where the suspicious chain was observed. */
  traceId: string;
  /** Tool that followed untrusted-content processing. */
  toolName?: string;
  /** Milliseconds since the untrusted tool call on the same trace. */
  elapsedMs: number;
  untrustedTool?: string;
}

export type SecuritySignal =
  | SuspiciousRequestSignal
  | AuthFailureBurstSignal
  | LlmExcessiveTokensSignal
  | LlmTokenBudgetSignal
  | LlmActionChainSuspiciousSignal;

export interface BurstOptions {
  /** HTTP statuses counted toward a burst. Default `[401, 403]`. */
  statuses?: number[];
  /** Denied responses within the window that trigger a signal. Default 10. */
  threshold?: number;
  /** Sliding window size in milliseconds. Default 60_000. */
  windowMs?: number;
  /**
   * Span attribute identifying the client. Default `client.address`
   * (falls back to `http.client_ip`).
   */
  keyAttribute?: string;
  /** Max distinct clients tracked (oldest evicted). Default 10_000. */
  maxKeys?: number;
}

export interface LlmSignalOptions {
  /**
   * Single-call token ceiling (`gen_ai.usage.total_tokens`, or input+output).
   * Default 100_000. Pass `false` to disable the per-call check.
   */
  maxTokensPerCall?: number | false;
  /**
   * Sliding-window token budget per key — catches slow-drip abuse that
   * stays under the per-call ceiling (OWASP LLM10: Unbounded Consumption).
   * Off unless configured.
   */
  tokenBudget?: {
    budget: number;
    /** Window size in milliseconds. Default 300_000 (5 min). */
    windowMs?: number;
    /**
     * Span attribute identifying the consumer. Default `enduser.id`
     * (falls back to `client.address`).
     */
    keyAttribute?: string;
    /** Max distinct keys tracked (oldest evicted). Default 10_000. */
    maxKeys?: number;
  };
}

export interface SecuritySignalProcessorOptions {
  /** Flag suspicious request paths on span start. Default true. */
  detectSuspiciousRequests?: boolean;
  /** Additional name → pattern pairs checked against the request target. */
  extraPatterns?: Record<string, RegExp>;
  /** Force-keep flagged spans through tail sampling. Default true. */
  forceKeepSuspicious?: boolean;
  /** HTTP statuses counted as denied. Default `[401, 403, 429]`. */
  deniedStatuses?: number[];
  /** Burst detection over denied responses. Pass `false` to disable. */
  burst?: BurstOptions | false;
  /**
   * LLM consumption signals from `gen_ai.*` spans (OWASP LLM10).
   * Enabled with the per-call ceiling by default; pass `false` to disable.
   */
  llm?: LlmSignalOptions | false;
  /**
   * Detect destructive MCP tool calls that follow untrusted-content tool usage
   * on the same trace (Google's "read email then send externally" pattern).
   * Default true.
   */
  detectSuspiciousActionChains?: boolean;
  /** Max ms between untrusted and destructive tool calls on one trace. Default 300_000. */
  actionChainWindowMs?: number;
  /** Emit `autotel.security.*` metrics. Default true. */
  metrics?: boolean;
  /** Called whenever a signal fires. Keep it fast and non-throwing. */
  onSignal?: (signal: SecuritySignal) => void;
  /** Clock override for tests. */
  now?: () => number;
}

/**
 * Conservative request-target patterns. Tuned for scanner/probe traffic —
 * high signal, low false-positive — not as a WAF. Extend via `extraPatterns`.
 */
export const SUSPICIOUS_REQUEST_PATTERNS: Record<string, RegExp> = {
  path_traversal: /(\.\.[/\\]|%2e%2e(%2f|%5c|\/)|\.\.%2f|%252e%252e)/i,
  sensitive_file_probe:
    /(\/\.env\b|\/\.git\b|\/etc\/passwd|\/wp-admin\b|\/\.aws\b|\/id_rsa\b)/i,
  sqli_probe:
    /(\bunion\b[\s+%20]+(all[\s+%20]+)?select\b|'[\s+%20]*or[\s+%20]*'?1'?[\s+%20]*=[\s+%20]*'?1)/i,
  xss_probe: /(<script\b|%3cscript)/i,
  null_byte: /%00/,
};

const TARGET_ATTRIBUTES = [
  'url.path',
  'url.full',
  'http.target',
  'http.url',
] as const;

function readAttribute(
  attributes: Record<string, AttributeValue | undefined>,
  keys: readonly string[],
): AttributeValue | undefined {
  for (const key of keys) {
    const value = attributes[key];
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Weighted sliding-window counter with bounded key cardinality.
 * Weight 1 per hit counts occurrences; token counts as weights sum usage.
 */
class SlidingWindow {
  private readonly hits = new Map<string, Array<[number, number]>>();

  constructor(
    private readonly windowMs: number,
    private readonly maxKeys: number,
  ) {}

  /**
   * Record a hit; returns the totals inside the window before and after it,
   * so callers can signal exactly once on a threshold crossing.
   */
  record(key: string, now: number, weight = 1): { before: number; after: number } {
    let entries = this.hits.get(key);
    if (!entries) {
      // Bound memory: random client addresses must not grow the map forever.
      if (this.hits.size >= this.maxKeys) {
        const oldest = this.hits.keys().next().value;
        if (oldest !== undefined) this.hits.delete(oldest);
      }
      entries = [];
      this.hits.set(key, entries);
    }

    const cutoff = now - this.windowMs;
    while (entries.length > 0 && (entries[0] as [number, number])[0] < cutoff) {
      entries.shift();
    }

    let before = 0;
    for (const [, w] of entries) before += w;
    entries.push([now, weight]);
    return { before, after: before + weight };
  }
}

/** Burst detection options with defaults applied and the window attached. */
interface BurstConfig {
  statuses: Set<number>;
  threshold: number;
  windowMs: number;
  keyAttribute: string;
  window: SlidingWindow;
}

function resolveBurstConfig(
  option: BurstOptions | false | undefined,
): BurstConfig | undefined {
  if (option === false) return undefined;
  const opts = option ?? {};
  const windowMs = opts.windowMs ?? 60_000;
  return {
    statuses: new Set(opts.statuses ?? [401, 403]),
    threshold: opts.threshold ?? 10,
    windowMs,
    keyAttribute: opts.keyAttribute ?? 'client.address',
    window: new SlidingWindow(windowMs, opts.maxKeys ?? 10_000),
  };
}

/** LLM consumption options with defaults applied and windows attached. */
interface LlmConfig {
  maxTokensPerCall?: number;
  budget?: {
    budget: number;
    windowMs: number;
    keyAttribute: string;
    window: SlidingWindow;
  };
}

function resolveLlmConfig(
  option: LlmSignalOptions | false | undefined,
): LlmConfig | undefined {
  if (option === false) return undefined;
  const opts = option ?? {};
  const tokenBudget = opts.tokenBudget;
  const windowMs = tokenBudget?.windowMs ?? 300_000;
  return {
    maxTokensPerCall:
      opts.maxTokensPerCall === false
        ? undefined
        : (opts.maxTokensPerCall ?? 100_000),
    budget: tokenBudget && {
      budget: tokenBudget.budget,
      windowMs,
      keyAttribute: tokenBudget.keyAttribute ?? 'enduser.id',
      window: new SlidingWindow(windowMs, tokenBudget.maxKeys ?? 10_000),
    },
  };
}

const MCP_TOOL_UNTRUSTED = 'mcp.tool.untrusted_content';
const MCP_TOOL_DESTRUCTIVE = 'mcp.tool.destructive';
const MCP_TOOL_NAME = 'mcp.tool.name';

interface UntrustedToolHit {
  toolName?: string;
  timestamp: number;
}

function pruneExpiredUntrustedTraces(
  hits: Map<string, UntrustedToolHit>,
  cutoff: number,
): void {
  for (const [traceId, hit] of hits) {
    if (hit.timestamp < cutoff) {
      hits.delete(traceId);
    }
  }
}

function readTraceId(span: ReadableSpanLike): string | undefined {
  const fromContext = span.spanContext?.traceId;
  if (typeof fromContext === 'string' && fromContext.length > 0) {
    return fromContext;
  }
  const fromAttr = readAttribute(span.attributes, ['trace_id']);
  return typeof fromAttr === 'string' && fromAttr.length > 0 ? fromAttr : undefined;
}

function readBooleanAttribute(
  attributes: Record<string, AttributeValue | undefined>,
  key: string,
): boolean {
  return readAttribute(attributes, [key]) === true;
}

export function createSecuritySignalProcessor(
  options: SecuritySignalProcessorOptions = {},
): SecuritySignalProcessor {
  const detect = options.detectSuspiciousRequests !== false;
  const forceKeep = options.forceKeepSuspicious !== false;
  const metricsEnabled = options.metrics !== false;
  const deniedStatuses = new Set(
    options.deniedStatuses ?? SECURITY_DENIED_STATUSES,
  );
  const now = options.now ?? Date.now;

  const patterns: Record<string, RegExp> = {
    ...SUSPICIOUS_REQUEST_PATTERNS,
    ...options.extraPatterns,
  };

  const burst = resolveBurstConfig(options.burst);
  const llm = resolveLlmConfig(options.llm);
  const detectActionChains = options.detectSuspiciousActionChains !== false;
  const actionChainWindowMs = options.actionChainWindowMs ?? 300_000;
  const untrustedByTrace = new Map<string, UntrustedToolHit>();

  const counters = {
    suspicious: lazyCounter(
      SECURITY_METRICS.httpSuspicious,
      'Requests matching suspicious-path patterns',
    ),
    denied: lazyCounter(
      SECURITY_METRICS.httpDenied,
      'HTTP responses with denied status codes (401/403/429)',
    ),
    anomaly: lazyCounter(
      SECURITY_METRICS.anomaly,
      'Security anomaly signals (e.g. auth-failure bursts)',
    ),
  };

  function count(
    which: keyof typeof counters,
    attributes: Record<string, string | number>,
  ): void {
    if (!metricsEnabled) return;
    counters[which].add(1, attributes);
  }

  function emit(signal: SecuritySignal): void {
    try {
      options.onSignal?.(signal);
    } catch {
      // Callbacks must never break the span pipeline.
    }
  }

  function checkDeniedResponse(span: ReadableSpanLike): void {
    const status = readAttribute(span.attributes, HTTP_STATUS_ATTRIBUTES);
    if (typeof status !== 'number' || !deniedStatuses.has(status)) return;

    count('denied', { status });

    if (!burst || !burst.statuses.has(status)) return;

    const key = readAttribute(span.attributes, [
      burst.keyAttribute,
      'http.client_ip',
    ]);
    if (typeof key !== 'string' || key.length === 0) return;

    const { before, after } = burst.window.record(key, now());
    // Signal once per window on the exact crossing, not on every
    // subsequent hit — keeps anomaly volume bounded under attack.
    if (before < burst.threshold && after >= burst.threshold) {
      count('anomaly', { signal: 'auth_failure_burst', status });
      emit({
        signal: 'auth_failure_burst',
        key,
        count: after,
        windowMs: burst.windowMs,
        status,
      });
    }
  }

  function checkLlmConsumption(span: ReadableSpanLike): void {
    if (!llm) return;

    const total = readAttribute(span.attributes, ['gen_ai.usage.total_tokens']);
    let tokens: number | undefined;
    if (typeof total === 'number') {
      tokens = total;
    } else {
      const input = readAttribute(span.attributes, ['gen_ai.usage.input_tokens']);
      const output = readAttribute(span.attributes, [
        'gen_ai.usage.output_tokens',
      ]);
      if (typeof input === 'number' || typeof output === 'number') {
        tokens =
          (typeof input === 'number' ? input : 0) +
          (typeof output === 'number' ? output : 0);
      }
    }
    if (tokens === undefined || tokens <= 0) return;

    if (llm.maxTokensPerCall !== undefined && tokens > llm.maxTokensPerCall) {
      const model = readAttribute(span.attributes, [
        'gen_ai.response.model',
        'gen_ai.request.model',
      ]);
      count('anomaly', { signal: 'llm_excessive_tokens' });
      emit({
        signal: 'llm_excessive_tokens',
        tokens,
        maxTokens: llm.maxTokensPerCall,
        ...(typeof model === 'string' && { model }),
      });
    }

    const budget = llm.budget;
    if (!budget) return;

    const key = readAttribute(span.attributes, [
      budget.keyAttribute,
      'client.address',
    ]);
    if (typeof key !== 'string' || key.length === 0) return;

    const { before, after } = budget.window.record(key, now(), tokens);
    if (before < budget.budget && after >= budget.budget) {
      count('anomaly', { signal: 'llm_token_budget_exceeded' });
      emit({
        signal: 'llm_token_budget_exceeded',
        key,
        tokens: after,
        budget: budget.budget,
        windowMs: budget.windowMs,
      });
    }
  }

  function checkSuspiciousActionChain(span: MutableSpanLike): void {
    if (!detectActionChains) return;

    const traceId = readTraceId(span);
    if (!traceId) return;

    const nowMs = now();
    const cutoff = nowMs - actionChainWindowMs;
    pruneExpiredUntrustedTraces(untrustedByTrace, cutoff);

    if (readBooleanAttribute(span.attributes, MCP_TOOL_UNTRUSTED)) {
      const toolName = readAttribute(span.attributes, [MCP_TOOL_NAME]);
      untrustedByTrace.set(traceId, {
        timestamp: nowMs,
        ...(typeof toolName === 'string' && { toolName }),
      });
      return;
    }

    if (!readBooleanAttribute(span.attributes, MCP_TOOL_DESTRUCTIVE)) {
      return;
    }

    const prior = untrustedByTrace.get(traceId);
    if (!prior) {
      return;
    }
    untrustedByTrace.delete(traceId);

    const toolName = readAttribute(span.attributes, [MCP_TOOL_NAME]);
    const elapsedMs = nowMs - prior.timestamp;
    count('anomaly', { signal: 'llm_action_chain_suspicious' });
    emit({
      signal: 'llm_action_chain_suspicious',
      traceId,
      elapsedMs,
      ...(typeof toolName === 'string' && { toolName }),
      ...(prior.toolName !== undefined && { untrustedTool: prior.toolName }),
    });
    applySecurityEventAttributes(
      span,
      {
        name: 'llm.action_chain.suspicious',
        category: 'llm',
        outcome: 'denied',
        severity: 'warning',
        reason: 'untrusted_then_destructive',
        targetType: 'trace',
        targetId: traceId,
        ...(typeof toolName === 'string' && { destructiveTool: toolName }),
        ...(prior.toolName !== undefined && { untrustedTool: prior.toolName }),
        elapsedMs,
      },
      { forceKeep: true, metrics: false },
    );
  }

  return {
    onStart(span) {
      checkSuspiciousActionChain(span);
      if (!detect) return;

      const target = readAttribute(span.attributes, TARGET_ATTRIBUTES);
      if (typeof target !== 'string' || target.length === 0) return;

      for (const [name, pattern] of Object.entries(patterns)) {
        if (!pattern.test(target)) continue;

        span.setAttribute(SECURITY_ATTR.suspiciousRequest, true);
        span.setAttribute(SECURITY_ATTR.signal, name);
        if (forceKeep) {
          span.setAttribute(AUTOTEL_SAMPLING_TAIL_EVALUATED, true);
          span.setAttribute(AUTOTEL_SAMPLING_TAIL_KEEP, true);
        }

        count('suspicious', { pattern: name });
        emit({ signal: 'suspicious_request', pattern: name, target });
        return; // first match wins — one signal per span
      }
    },

    onEnd(span) {
      checkDeniedResponse(span);
      checkLlmConsumption(span);
    },

    shutdown() {
      return Promise.resolve();
    },

    forceFlush() {
      return Promise.resolve();
    },
  };
}
