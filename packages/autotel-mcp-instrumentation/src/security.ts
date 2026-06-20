/**
 * MCP security observability — make the agentic-web threat model visible and
 * actionable at the MCP protocol boundary.
 *
 * Tracing tells you what a tool _did_. This module adds the security half of a
 * defense-in-depth strategy at the place untrusted data actually crosses the
 * wire: tool annotations (the "malicious manifest" vector), payload sizes and
 * character budgets (token-exhaustion signals), a pluggable prompt-injection
 * classifier (the "contaminated output" vector), and spotlighting helpers to
 * demarcate untrusted content before an agent consumes it.
 *
 * It does **not** replace the agent runtime's guardrails. Deterministic
 * kill-switches (cost/token/tool-call ceilings, loop detection) live in
 * `autotel-genai/guard`; identity/scope/policy lives in `autotel-genai/agent`.
 * This package observes and signals at the MCP edge so those layers — and your
 * backend's alerting — have the data they need.
 *
 * Aligned with Chrome/Google's WebMCP security guidance (June 2026):
 * @see https://developer.chrome.com/docs/ai/webmcp/secure-tools
 * @see https://developer.chrome.com/docs/agents/security
 *
 * @packageDocumentation
 */

import type { Attributes } from '@opentelemetry/api';
import {
  MCP_SEMCONV,
  MCP_SECURITY_EVENT,
  MCP_CHAR_BUDGETS,
} from './semantic-conventions';
import { recordSecurityEvent } from './metrics';

// Re-export so the WebMCP character budgets are reachable from the `security`
// subpath alongside the helpers that use them.
export { MCP_CHAR_BUDGETS } from './semantic-conventions';

/** Minimal bridge sink — maps MCP boundary signals to unified `security.*` events. */
export interface SecurityEventBridgeLike {
  (metadata: {
    name: string;
    category: 'llm';
    outcome: 'success' | 'failure' | 'denied' | 'blocked' | 'error';
    severity?: 'info' | 'warning' | 'error' | 'critical';
    reason?: string;
    toolName?: string;
    verdict?: string;
    source?: string;
    [key: string]: unknown;
  }): void;
}

export interface McpSecurityBridgeOptions {
  bridge?: SecurityEventBridgeLike;
  toolName?: string;
}

function emitBridgedSecurityEvent(
  options: McpSecurityBridgeOptions | undefined,
  metadata: Parameters<SecurityEventBridgeLike>[0],
): void {
  if (!options?.bridge) return;
  try {
    options.bridge({
      ...metadata,
      ...(options.toolName !== undefined && { toolName: options.toolName }),
    });
  } catch {
    // Bridge failures must never break traced MCP operations.
  }
}

/** Minimal telemetry sink — the subset of autotel's `TraceContext` we use. */
export interface SecuritySink {
  setAttribute(key: string, value: string | number | boolean): void;
  setAttributes(attrs: Attributes): void;
  track(name: string, attrs?: Attributes): void;
}

// --- Guard wire-through (enforcement bridge) -------------------------------

/** A single supervised step fed to a guard. Mirrors `autotel-genai`'s `GenAiGuardStep`. */
export interface GuardStepLike {
  kind?: string;
  name?: string;
  signature?: string;
  error?: boolean;
  usage?: { costUsd?: number; inputTokens?: number; outputTokens?: number };
}

/**
 * Structural shape of `autotel-genai`'s `GenAiGuard`. Duck-typed so this package
 * takes **no** dependency on genai — pass a `createGenAiGuard(...)` / budget
 * instance and every MCP tool call is recorded as a step. The guard's `stop`
 * rules throw, unwinding the agent loop (detection → enforcement).
 */
export interface GuardLike {
  record(step: GuardStepLike, ctx?: unknown): unknown;
}

/**
 * Record a tool call against a guard. Surfaces `GuardLike` so the MCP layer
 * (detection) can drive the genai guard (enforcement) without a hard dependency.
 * A guard `stop` rule throws — let it propagate to halt the run.
 */
export function recordGuardStep(
  guard: GuardLike,
  step: GuardStepLike,
  ctx?: unknown,
): void {
  guard.record({ kind: 'tool', ...step }, ctx);
}

// --- Annotation hints ------------------------------------------------------

/**
 * MCP tool annotations plus the WebMCP `untrustedContentHint`. All optional;
 * read off `registerTool`'s config `annotations` block.
 */
export interface McpToolAnnotations {
  /** Human-facing title. */
  title?: string;
  /** Tool does not mutate state. (`readOnlyHint`) */
  readOnlyHint?: boolean;
  /** Tool may perform destructive updates. (`destructiveHint`) */
  destructiveHint?: boolean;
  /** Repeated calls with the same args have no additional effect. (`idempotentHint`) */
  idempotentHint?: boolean;
  /** Tool interacts with an open/external world (e.g. the web). (`openWorldHint`) */
  openWorldHint?: boolean;
  /**
   * Tool returns user-generated or externally sourced content that must be
   * treated as untrusted. (WebMCP `untrustedContentHint`)
   */
  untrustedContentHint?: boolean;
}

/** Set span attributes from a tool's annotation hints. Skips absent fields. */
export function applyToolAnnotations(
  sink: SecuritySink,
  annotations: McpToolAnnotations | undefined,
): void {
  if (!annotations) return;
  if (typeof annotations.readOnlyHint === 'boolean') {
    sink.setAttribute(MCP_SEMCONV.TOOL_READ_ONLY, annotations.readOnlyHint);
  }
  if (typeof annotations.destructiveHint === 'boolean') {
    sink.setAttribute(
      MCP_SEMCONV.TOOL_DESTRUCTIVE,
      annotations.destructiveHint,
    );
  }
  if (typeof annotations.idempotentHint === 'boolean') {
    sink.setAttribute(MCP_SEMCONV.TOOL_IDEMPOTENT, annotations.idempotentHint);
  }
  if (typeof annotations.openWorldHint === 'boolean') {
    sink.setAttribute(MCP_SEMCONV.TOOL_OPEN_WORLD, annotations.openWorldHint);
  }
  if (typeof annotations.untrustedContentHint === 'boolean') {
    sink.setAttribute(
      MCP_SEMCONV.TOOL_UNTRUSTED_CONTENT,
      annotations.untrustedContentHint,
    );
  }
}

// --- Serialization & sizing ------------------------------------------------

/** Serialize a value to a string, tolerating circular / non-serializable input. */
export function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return '[Circular or non-serializable]';
  }
}

/**
 * Record a payload's character size onto the span and return it. The size is
 * the contaminated-output / token-exhaustion signal: a tool whose output
 * suddenly balloons is a classic injection / DoS tell.
 */
export function recordPayloadSize(
  sink: SecuritySink,
  key: string,
  value: unknown,
): number {
  const size = safeStringify(value).length;
  sink.setAttribute(key, size);
  return size;
}

// --- Character budgets -----------------------------------------------------

/** A single character-budget violation. */
export interface BudgetViolation {
  /** What overflowed, e.g. `tool.description` or `param.name:location`. */
  field: string;
  /** Observed character count. */
  observed: number;
  /** Configured limit. */
  limit: number;
}

/** A tool definition's text surface, for budget validation. */
export interface ToolBudgetInput {
  name: string;
  description?: string;
  /** Parameter name → description (e.g. from a JSON schema / Zod shape). */
  parameters?: Record<string, { description?: string } | undefined>;
}

export interface ManifestTextSurface {
  type: 'tool' | 'resource' | 'prompt';
  name: string;
  description?: string;
  parameters?: Record<string, { description?: string } | undefined>;
}

export interface ManifestAssessment {
  text?: string;
  verdict?: ClassifierVerdict;
  budgetViolations?: BudgetViolation[];
}

/**
 * Validate a tool's text surface against the WebMCP recommended character
 * budgets ({@link MCP_CHAR_BUDGETS}). Returns every violation found — empty
 * means within budget. Pure; emits no telemetry (caller decides what to do).
 */
export function validateToolBudget(
  tool: ToolBudgetInput,
  budgets: Partial<typeof MCP_CHAR_BUDGETS> = MCP_CHAR_BUDGETS,
): BudgetViolation[] {
  const limits = { ...MCP_CHAR_BUDGETS, ...budgets };
  const violations: BudgetViolation[] = [];

  if (tool.name.length > limits.TOOL_NAME) {
    violations.push({
      field: 'tool.name',
      observed: tool.name.length,
      limit: limits.TOOL_NAME,
    });
  }
  if (tool.description && tool.description.length > limits.TOOL_DESCRIPTION) {
    violations.push({
      field: 'tool.description',
      observed: tool.description.length,
      limit: limits.TOOL_DESCRIPTION,
    });
  }
  for (const [paramName, param] of Object.entries(tool.parameters ?? {})) {
    if (paramName.length > limits.PARAM_NAME) {
      violations.push({
        field: `param.name:${paramName}`,
        observed: paramName.length,
        limit: limits.PARAM_NAME,
      });
    }
    const desc = param?.description;
    if (desc && desc.length > limits.PARAM_DESCRIPTION) {
      violations.push({
        field: `param.description:${paramName}`,
        observed: desc.length,
        limit: limits.PARAM_DESCRIPTION,
      });
    }
  }
  return violations;
}

/**
 * Check a tool output against the output character budget and, if exceeded,
 * record the signal + emit a `mcp.security.budget_exceeded` event. Returns
 * whether the budget was exceeded.
 */
export function enforceOutputBudget(
  sink: SecuritySink,
  size: number,
  limit: number,
  attrs: Attributes = {},
  bridge?: McpSecurityBridgeOptions,
): boolean {
  const exceeded = size > limit;
  sink.setAttribute(MCP_SEMCONV.SECURITY_BUDGET_LIMIT, limit);
  if (!exceeded) return false;
  sink.setAttribute(MCP_SEMCONV.SECURITY_BUDGET_EXCEEDED, true);
  sink.setAttribute(MCP_SEMCONV.SECURITY_BUDGET_OBSERVED, size);
  sink.track(MCP_SECURITY_EVENT.BUDGET_EXCEEDED, {
    [MCP_SEMCONV.SECURITY_BUDGET_OBSERVED]: size,
    [MCP_SEMCONV.SECURITY_BUDGET_LIMIT]: limit,
    ...attrs,
  });
  recordSecurityEvent({ event: 'budget_exceeded', ...stringAttrs(attrs) });
  const toolName = attrs[MCP_SEMCONV.TOOL_NAME];
  emitBridgedSecurityEvent(bridge, {
    name: 'llm.output.budget_exceeded',
    category: 'llm',
    outcome: 'blocked',
    severity: 'warning',
    reason: 'output_char_budget_exceeded',
    ...(typeof toolName === 'string' && { toolName }),
    observed: size,
    limit,
  });
  return true;
}

/**
 * Build one normalized text surface from a tool/resource/prompt config. This is
 * the manifest-time input for classifier scans and budget checks.
 */
export function extractManifestTextSurface(
  type: 'tool' | 'resource' | 'prompt',
  name: string,
  config: unknown,
): ManifestTextSurface {
  const obj =
    config && typeof config === 'object'
      ? (config as Record<string, unknown>)
      : {};
  const description =
    typeof obj.description === 'string' && obj.description.length > 0
      ? obj.description
      : undefined;

  const parameters = extractParameterDescriptions(obj);
  return { type, name, description, parameters };
}

/**
 * Analyze a manifest surface once at registration time. Async classifiers are
 * supported; failures degrade quietly to "no assessment".
 */
export async function assessManifest(
  classifier: McpSecurityClassifier | undefined,
  surface: ManifestTextSurface,
  options: { validateToolBudgets?: boolean } = {},
): Promise<ManifestAssessment | undefined> {
  const text = buildManifestText(surface);
  if (!text && surface.type !== 'tool') {
    return undefined;
  }

  let verdict: ClassifierVerdict | undefined;
  if (classifier && text) {
    try {
      verdict = await classifier({
        source: 'description',
        type: surface.type,
        name: surface.name,
        text,
        value: surface,
      });
    } catch {
      verdict = undefined;
    }
  }

  const budgetViolations =
    surface.type === 'tool' && options.validateToolBudgets !== false
      ? validateToolBudget({
          name: surface.name,
          description: surface.description,
          parameters: surface.parameters,
        })
      : [];

  if (!verdict && budgetViolations.length === 0) {
    return undefined;
  }

  return {
    text: text || undefined,
    verdict,
    budgetViolations,
  };
}

/**
 * Attach a manifest assessment to a live span / request snapshot and emit
 * events for suspicious manifests and budget overflows.
 */
export function applyManifestAssessment(
  sink: SecuritySink,
  assessment: ManifestAssessment | undefined,
  attrs: Attributes = {},
  bridge?: McpSecurityBridgeOptions,
): void {
  if (!assessment) return;

  const suspected = assessment.verdict?.verdict
    ? assessment.verdict.verdict !== 'clean'
    : false;
  if (assessment.verdict) {
    sink.setAttribute(MCP_SEMCONV.SECURITY_MANIFEST_SUSPECTED, suspected);
    sink.setAttribute(
      MCP_SEMCONV.SECURITY_MANIFEST_VERDICT,
      assessment.verdict.verdict,
    );
    if (typeof assessment.verdict.score === 'number') {
      sink.setAttribute(
        MCP_SEMCONV.SECURITY_MANIFEST_SCORE,
        assessment.verdict.score,
      );
    }
    if (assessment.verdict.categories?.length) {
      sink.setAttribute(
        MCP_SEMCONV.SECURITY_MANIFEST_CATEGORIES,
        assessment.verdict.categories.join(','),
      );
    }
    if (suspected) {
      sink.track(MCP_SECURITY_EVENT.MANIFEST_SUSPECTED, {
        [MCP_SEMCONV.SECURITY_MANIFEST_VERDICT]: assessment.verdict.verdict,
        ...(typeof assessment.verdict.score === 'number' && {
          [MCP_SEMCONV.SECURITY_MANIFEST_SCORE]: assessment.verdict.score,
        }),
        ...attrs,
      });
      recordSecurityEvent({
        event: 'manifest_suspected',
        verdict: assessment.verdict.verdict,
        ...stringAttrs(attrs),
      });
      const toolName = attrs[MCP_SEMCONV.TOOL_NAME];
      emitBridgedSecurityEvent(bridge, {
        name: 'llm.manifest.suspicious',
        category: 'llm',
        outcome:
          assessment.verdict.verdict === 'malicious' ? 'blocked' : 'denied',
        severity:
          assessment.verdict.verdict === 'malicious' ? 'error' : 'warning',
        reason:
          assessment.verdict.categories?.join(',') ?? 'manifest_suspected',
        ...(typeof toolName === 'string' && { toolName }),
        verdict: assessment.verdict.verdict,
        ...(typeof assessment.verdict.score === 'number' && {
          score: assessment.verdict.score,
        }),
      });
    }
  }

  if (assessment.budgetViolations?.length) {
    sink.setAttribute(
      MCP_SEMCONV.SECURITY_MANIFEST_BUDGET_VIOLATION_COUNT,
      assessment.budgetViolations.length,
    );
    sink.track(MCP_SECURITY_EVENT.MANIFEST_BUDGET_EXCEEDED, {
      [MCP_SEMCONV.SECURITY_MANIFEST_BUDGET_VIOLATION_COUNT]:
        assessment.budgetViolations.length,
      violations: assessment.budgetViolations
        .map((violation) => violation.field)
        .join(','),
      ...attrs,
    });
    recordSecurityEvent({
      event: 'manifest_budget_exceeded',
      count: String(assessment.budgetViolations.length),
      ...stringAttrs(attrs),
    });
  }
}

// --- Prompt-injection classifier -------------------------------------------

/** Where the inspected content came from. */
export type SecuritySource = 'arguments' | 'result' | 'description';

/** Input handed to a {@link McpSecurityClassifier}. */
export interface ClassifierInput {
  source: SecuritySource;
  type: 'tool' | 'resource' | 'prompt';
  /** Tool / prompt name, or resource URI. */
  name: string;
  /** Serialized text content under inspection. */
  text: string;
  /** Raw value (arguments object or result). */
  value: unknown;
}

/** Verdict returned by a classifier. */
export interface ClassifierVerdict {
  verdict: 'clean' | 'suspicious' | 'malicious';
  /** 0..1 confidence the content is an injection. */
  score?: number;
  /** Detected categories (e.g. `instruction_override`, `exfiltration`). */
  categories?: string[];
}

/**
 * A pluggable prompt-injection / content classifier. Return a verdict, or
 * `undefined` to abstain. The integration point for Model Armor, Promptfoo,
 * an LLM critic, or the built-in {@link heuristicInjectionClassifier}.
 */
export type McpSecurityClassifier = (
  input: ClassifierInput,
) => ClassifierVerdict | undefined | Promise<ClassifierVerdict | undefined>;

/**
 * Run a classifier over one payload, record the signal onto the span, and emit
 * a `mcp.security.injection_suspected` event for non-clean verdicts. Returns
 * the verdict (or `undefined` if the classifier abstained / threw). Classifier
 * failures never break the traced operation — they are swallowed.
 */
export async function runClassifier(
  sink: SecuritySink,
  classifier: McpSecurityClassifier,
  input: ClassifierInput,
  bridge?: McpSecurityBridgeOptions,
): Promise<ClassifierVerdict | undefined> {
  let verdict: ClassifierVerdict | undefined;
  try {
    verdict = await classifier(input);
  } catch {
    return undefined;
  }
  if (!verdict) return undefined;

  const suspected = verdict.verdict !== 'clean';
  sink.setAttribute(MCP_SEMCONV.SECURITY_INJECTION_SUSPECTED, suspected);
  sink.setAttribute(MCP_SEMCONV.SECURITY_INJECTION_VERDICT, verdict.verdict);
  sink.setAttribute(MCP_SEMCONV.SECURITY_INJECTION_SOURCE, input.source);
  if (typeof verdict.score === 'number') {
    sink.setAttribute(MCP_SEMCONV.SECURITY_INJECTION_SCORE, verdict.score);
  }
  if (verdict.categories?.length) {
    sink.setAttribute(
      MCP_SEMCONV.SECURITY_INJECTION_CATEGORIES,
      verdict.categories.join(','),
    );
  }

  if (suspected) {
    sink.track(MCP_SECURITY_EVENT.INJECTION_SUSPECTED, {
      [MCP_SEMCONV.SECURITY_INJECTION_VERDICT]: verdict.verdict,
      [MCP_SEMCONV.SECURITY_INJECTION_SOURCE]: input.source,
      ...(typeof verdict.score === 'number' && {
        [MCP_SEMCONV.SECURITY_INJECTION_SCORE]: verdict.score,
      }),
      ...(verdict.categories?.length && {
        [MCP_SEMCONV.SECURITY_INJECTION_CATEGORIES]:
          verdict.categories.join(','),
      }),
    });
    recordSecurityEvent({
      event: 'injection_suspected',
      verdict: verdict.verdict,
      source: input.source,
    });
    emitBridgedSecurityEvent(bridge, {
      name: 'llm.prompt_injection.detected',
      category: 'llm',
      outcome: verdict.verdict === 'malicious' ? 'blocked' : 'denied',
      severity: verdict.verdict === 'malicious' ? 'error' : 'warning',
      reason: verdict.categories?.join(',') ?? 'injection_suspected',
      toolName: input.name,
      verdict: verdict.verdict,
      source: input.source,
      ...(typeof verdict.score === 'number' && { score: verdict.score }),
    });
  }
  return verdict;
}

/**
 * Patterns the built-in heuristic detector looks for. Each maps a category to a
 * regex; a match contributes to the score. Deliberately conservative — this is
 * a cheap first-pass signal, not a replacement for a real classifier.
 */
const INJECTION_PATTERNS: ReadonlyArray<{ category: string; re: RegExp }> = [
  {
    category: 'instruction_override',
    re: /\b(ignore|disregard|forget|override)\b[\s\S]{0,40}\b(previous|prior|above|earlier|all)\b[\s\S]{0,20}\b(instruction|prompt|rule|direction|context)/i,
  },
  {
    category: 'role_injection',
    re: /(^|\n)\s*(system|assistant|developer)\s*:|<\/?(system|assistant|tool_call|im_start)>|you are now\b/i,
  },
  {
    category: 'secrecy',
    re: /\bdo not (tell|inform|reveal|mention|notify)\b[\s\S]{0,30}\b(the )?(user|human|owner)\b/i,
  },
  {
    category: 'exfiltration',
    re: /\b(send|post|exfiltrate|upload|forward|leak|email)\b[\s\S]{0,40}\b(to )?(https?:\/\/|api[_-]?key|secret|token|credential|password|cookie|env)/i,
  },
  {
    category: 'tool_redirection',
    re: /\b(call|invoke|use|trigger)\b[\s\S]{0,30}\b(tool|function|command)\b[\s\S]{0,40}\b(instead|then|after this|next)\b/i,
  },
];

/** A base64 blob long enough to be a plausible payload-smuggling vector. */
const BASE64_BLOB = /[A-Za-z0-9+/]{256,}={0,2}/;

export interface HeuristicClassifierOptions {
  /** Score at/above which the verdict is `malicious`. Default 0.7. */
  maliciousThreshold?: number;
  /** Score at/above which the verdict is `suspicious`. Default 0.3. */
  suspiciousThreshold?: number;
}

/**
 * A dependency-free, deterministic prompt-injection heuristic. Opt-in: pass it
 * (or your own classifier) as `securityClassifier`. It scans for instruction
 * override, role injection, secrecy directives, exfiltration, tool redirection,
 * and oversized base64 blobs, scoring by how many distinct categories match.
 *
 * Heuristics produce false positives and miss novel attacks — treat the signal
 * as a tripwire feeding a critic / Model Armor, not as ground truth.
 */
export function heuristicInjectionClassifier(
  options: HeuristicClassifierOptions = {},
): McpSecurityClassifier {
  const maliciousAt = options.maliciousThreshold ?? 0.7;
  const suspiciousAt = options.suspiciousThreshold ?? 0.3;
  return ({ text }) => {
    if (!text) return { verdict: 'clean' };
    const categories: string[] = [];
    for (const { category, re } of INJECTION_PATTERNS) {
      if (re.test(text)) categories.push(category);
    }
    if (BASE64_BLOB.test(text)) categories.push('encoded_blob');

    if (categories.length === 0) return { verdict: 'clean', score: 0 };

    // Score: saturating-ish on distinct category count.
    const score = Math.min(1, categories.length / 3);
    const verdict =
      score >= maliciousAt
        ? 'malicious'
        : score >= suspiciousAt
          ? 'suspicious'
          : 'clean';
    return { verdict, score: round2(score), categories };
  };
}

// --- Spotlighting ----------------------------------------------------------

/** How to demarcate untrusted content for an LLM. */
export type SpotlightMethod = 'delimit' | 'base64';

export interface SpotlightOptions {
  /** Demarcation method. `delimit` is cheap; `base64` resists structural evasion. */
  method?: SpotlightMethod;
  /** Tag/marker used by the `delimit` method. Default `untrusted`. */
  tag?: string;
}

/**
 * Wrap untrusted content so a downstream LLM treats it as data, not
 * instructions (a.k.a. spotlighting). `delimit` wraps in `<untrusted>…</untrusted>`
 * tags (token-efficient, low risk); `base64` encodes the content (resists
 * delimiter-injection / structural evasion, ~33% larger).
 *
 * Pair with a system instruction that tells the model what the spotlight means.
 * Returns the wrapped string; does not emit telemetry (see the `securitySpotlight`
 * config option for the instrumented path).
 */
export function spotlight(
  content: string,
  options: SpotlightOptions = {},
): string {
  const method = options.method ?? 'delimit';
  if (method === 'base64') {
    return `[BASE64_UNTRUSTED]${toBase64(content)}[/BASE64_UNTRUSTED]`;
  }
  const tag = options.tag ?? 'untrusted';
  return `<${tag}>\n${content}\n</${tag}>`;
}

// --- internals -------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildManifestText(surface: ManifestTextSurface): string {
  const parts = [`name: ${surface.name}`];
  if (surface.description) {
    parts.push(`description: ${surface.description}`);
  }
  for (const [paramName, param] of Object.entries(surface.parameters ?? {})) {
    if (param?.description) {
      parts.push(`param ${paramName}: ${param.description}`);
    }
  }
  return parts.join('\n');
}

function extractParameterDescriptions(
  config: Record<string, unknown>,
): Record<string, { description?: string }> | undefined {
  const fromSchema = normalizeParameterObject(
    (config.inputSchema &&
    typeof config.inputSchema === 'object' &&
    (config.inputSchema as Record<string, unknown>).properties &&
    typeof (config.inputSchema as Record<string, unknown>).properties ===
      'object'
      ? (config.inputSchema as Record<string, unknown>).properties
      : undefined) as Record<string, unknown> | undefined,
  );
  if (fromSchema) return fromSchema;

  const fromParameters = normalizeParameterObject(
    (config.parameters &&
    typeof config.parameters === 'object' &&
    !Array.isArray(config.parameters)
      ? (config.parameters as Record<string, unknown>)
      : undefined) as Record<string, unknown> | undefined,
  );
  if (fromParameters) return fromParameters;

  if (Array.isArray(config.arguments)) {
    const out: Record<string, { description?: string }> = {};
    for (const item of config.arguments) {
      if (!item || typeof item !== 'object') continue;
      const arg = item as Record<string, unknown>;
      if (typeof arg.name !== 'string') continue;
      out[arg.name] = {
        description:
          typeof arg.description === 'string' ? arg.description : undefined,
      };
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  return undefined;
}

function normalizeParameterObject(
  parameters: Record<string, unknown> | undefined,
): Record<string, { description?: string }> | undefined {
  if (!parameters) return undefined;
  const out: Record<string, { description?: string }> = {};
  for (const [name, value] of Object.entries(parameters)) {
    if (!value || typeof value !== 'object') {
      out[name] = {};
      continue;
    }
    const obj = value as Record<string, unknown>;
    out[name] = {
      description:
        typeof obj.description === 'string' ? obj.description : undefined,
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Coerce an Attributes map to string-only for the metric counter. */
function stringAttrs(attrs: Attributes): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v != null) out[k] = String(v);
  }
  return out;
}

/** Runtime-safe base64 (Node `Buffer` or edge `btoa`/`TextEncoder`). */
function toBase64(input: string): string {
  const g = globalThis as {
    Buffer?: { from(s: string, e: string): { toString(e: string): string } };
    btoa?: (s: string) => string;
  };
  if (g.Buffer !== undefined) {
    return g.Buffer.from(input, 'utf8').toString('base64');
  }
  if (typeof g.btoa === 'function') {
    // btoa needs binary string; encode UTF-8 first.
    const bytes = new TextEncoder().encode(input);
    let binary = '';
    for (const b of bytes) binary += String.fromCodePoint(b);
    return g.btoa(binary);
  }
  // Last resort: return as-is rather than throwing inside instrumentation.
  return input;
}
