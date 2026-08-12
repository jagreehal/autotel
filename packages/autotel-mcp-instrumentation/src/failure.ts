/**
 * Failure fingerprinting — "is this the same failure as the last one?"
 *
 * `error.type` marks a call as failed. It does not say whether ten failures are
 * one bug ten times or ten separate bugs, and the raw message cannot answer
 * that either: real failure text is full of run-specific values (ids, ports,
 * durations, paths), so hashing it directly yields a fingerprint with the
 * cardinality of individual failures — exactly what grouping is meant to
 * collapse.
 *
 * Stripping those values first is what makes the fingerprint stable across
 * processes, which is the property that matters on a stateless deployment:
 * there is no session to accumulate against, so correlation has to happen on
 * something every span already carries.
 *
 * The normalisation rules and hash follow the ones `autotel-devtools`' error
 * aggregator uses, so grouping behaves consistently on both sides — with one
 * deliberate deviation, noted at the digit rule below. They are not imported:
 * devtools consumes telemetry and this package produces it, and the dependency
 * would run the wrong way.
 */

import type { TraceContext } from 'autotel';
import {
  MCP_FAILURE_CATEGORY,
  MCP_SEMCONV,
  type McpFailureCategory,
} from './semantic-conventions';

/** Longest failure text considered; beyond this, messages are tails of noise. */
const MAX_NORMALIZED_LENGTH = 200;

/**
 * Strip run-specific values from failure text so two occurrences of one cause
 * produce identical output.
 */
export function normalizeFailureMessage(message: string): string {
  return (
    message
      // UUIDs — request ids, correlation ids, entity keys.
      .replaceAll(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        '[UUID]',
      )
      // Long hex runs — hashes, object ids, tokens.
      .replaceAll(/\b[0-9a-f]{16,}\b/gi, '[ID]')
      // Any digit run — durations, ports, counts, offsets. Deliberately not
      // `\b\d+\b`: there is no word boundary between a digit and a letter, so
      // the bounded form leaves `37ms` and `412ms` intact and two runs of one
      // timeout never group. Digits are never the stable part of a message.
      .replaceAll(/\d+/g, '[N]')
      // Quoted values — the interpolated subject of most messages.
      .replaceAll(/"[^"]*"/g, '"[STR]"')
      .replaceAll(/'[^']*'/g, "'[STR]'")
      .slice(0, MAX_NORMALIZED_LENGTH)
  );
}

/**
 * 32-bit string hash. Not cryptographic and not meant to be: this groups
 * failures for an operator, it does not authenticate anything. Chosen over
 * `crypto` because it is synchronous and runs unchanged on edge runtimes,
 * where `subtle.digest` is async and would force this whole path to await.
 */
function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash << 5) - hash + (value.codePointAt(index) ?? 0);
    hash = hash & hash; // wrap to 32 bits
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * The text a failure should be grouped on: an `isError` result's text content,
 * or a thrown error's name and message.
 *
 * Non-text content parts (images, audio, embedded resources) are skipped —
 * their bytes differ per call and would defeat grouping.
 */
export function extractFailureText(result: unknown): string {
  const content = (result as { content?: unknown })?.content;
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .filter(
      (part): part is { text: string } =>
        typeof part === 'object' &&
        part !== null &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string',
    )
    .map((part) => part.text)
    .join(' ')
    .trim();
}

/**
 * Ordered channel patterns — first match wins, so the more specific cause is
 * listed first. `504 Gateway Timeout` therefore reads as a timeout rather than
 * a dependency failure: the deadline is the actionable half.
 *
 * Matched against the RAW text, never the normalised form: normalisation
 * replaces every digit run, which would erase the status codes this depends on.
 */
const FAILURE_PATTERNS: ReadonlyArray<readonly [McpFailureCategory, RegExp]> = [
  [
    MCP_FAILURE_CATEGORY.AUTH,
    /\b(401|403|unauthori[sz]ed|unauthenticated|forbidden|permission denied|access denied|invalid (token|credentials|api[- ]?key)|expired token|EACCES)\b/i,
  ],
  [
    MCP_FAILURE_CATEGORY.TIMEOUT,
    /\b(timed? ?out|timeout|ETIMEDOUT|deadline exceeded|AbortError)\b/i,
  ],
  [
    MCP_FAILURE_CATEGORY.NETWORK,
    /\b(ECONNREFUSED|ECONNRESET|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|EPIPE|socket hang ?up|connection (refused|reset)|dns lookup)\b/i,
  ],
  [
    MCP_FAILURE_CATEGORY.VALIDATION,
    /\b(invalid (input|argument|parameter)|validation (failed|error)|ZodError|schema|required (field|parameter)|missing (required |)parameter|must be an?)\b/i,
  ],
  [
    MCP_FAILURE_CATEGORY.SERIALIZATION,
    /\b(JSON|unexpected token|unexpected end of|malformed|could not (parse|decode)|parse error|serial[iz]s?ation)\b/i,
  ],
  [
    MCP_FAILURE_CATEGORY.DEPENDENCY,
    /\b(502|503|504|bad gateway|service unavailable|upstream|downstream)\b/i,
  ],
];

/**
 * Sort a failure into the channel that decides who looks at it.
 *
 * Falls back to `internal` rather than an "unknown" bucket: text this package
 * cannot place is, by default, a bug in the tool, and naming it as such keeps
 * the residue from reading as a category anyone can safely ignore.
 */
export function classifyFailure(text: string): McpFailureCategory {
  for (const [category, pattern] of FAILURE_PATTERNS) {
    if (pattern.test(text)) {
      return category;
    }
  }
  return MCP_FAILURE_CATEGORY.INTERNAL;
}

/**
 * The text a thrown failure should be grouped on. The name is included because
 * it is often the only stable part — `TimeoutError` survives a message rewrite
 * that would otherwise split one bug into two groups.
 */
export function failureTextFromError(error: unknown): string {
  if (!(error instanceof Error)) {
    return typeof error === 'string' ? error : '';
  }
  return [error.name, error.message].filter(Boolean).join(': ');
}

/**
 * Group a failure by underlying cause.
 *
 * Returns `undefined` when there is no text to group on — a fingerprint of the
 * empty string would collapse every unrelated silent failure into one group,
 * which reads as a single high-frequency bug that does not exist.
 */
export function fingerprintFailure(text: string): string | undefined {
  const normalized = normalizeFailureMessage(text).trim();
  if (!normalized) {
    return undefined;
  }
  return hashString(normalized);
}

/**
 * Attach failure-grouping attributes to a span and return the category, so the
 * duration metric can carry it too. Shared by both sides of the trace: a client
 * and a server looking at the same failure must land on the same group.
 *
 * Only the category is meant for the metric. The fingerprint is one series per
 * distinct bug, which is precisely the cardinality a metric backend cannot
 * absorb — it belongs on the span, where the volume is already per-call.
 */
export function applyFailureGrouping(
  ctx: TraceContext,
  text: string,
): McpFailureCategory | undefined {
  if (!text) {
    return undefined;
  }
  const category = classifyFailure(text);
  ctx.setAttribute(MCP_SEMCONV.FAILURE_CATEGORY, category);

  const fingerprint = fingerprintFailure(text);
  if (fingerprint) {
    ctx.setAttribute(MCP_SEMCONV.FAILURE_FINGERPRINT, fingerprint);
  }
  return category;
}

export { MCP_FAILURE_CATEGORY, type McpFailureCategory };
