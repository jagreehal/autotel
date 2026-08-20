/**
 * Typed error and audit catalogs.
 *
 * Group related errors into one catalog and get a refactor-safe builder per
 * code, with autocomplete at every call site and typed message parameters.
 *
 * @example
 * ```typescript
 * import { defineErrorCatalog } from 'autotel';
 *
 * export const billing = defineErrorCatalog('billing', {
 *   PAYMENT_DECLINED: {
 *     status: 402,
 *     message: 'Card declined',
 *     why: 'The issuer rejected the charge',
 *     fix: 'Try a different payment method',
 *   },
 *   INSUFFICIENT_FUNDS: {
 *     status: 402,
 *     message: ({ available, required }: { available: number; required: number }) =>
 *       `Insufficient funds: $${available} of $${required}`,
 *   },
 * });
 *
 * throw billing.PAYMENT_DECLINED({ cause: stripeError });
 * throw billing.INSUFFICIENT_FUNDS({ available: 5, required: 100 });
 *
 * // In a catch block — refactor-safe, no magic strings:
 * if (billing.PAYMENT_DECLINED.match(err)) { ... }
 * ```
 */

import {
  createStructuredError,
  type StructuredError,
} from './structured-error';
import type { EventAttributeValue } from './event-subscriber';
import { asFunction, asNumber, asRecord, asString } from './values';

/**
 * Structured fields attached to a log line or an error. They are serialized by
 * whatever sink receives them, so a value that cannot survive JSON has no
 * meaning here - which is what EventAttributeValue names.
 */
type LogFields = Record<string, EventAttributeValue>;

const catalogCodeKey: unique symbol = Symbol.for('autotel.catalog.code');

/** A value the builder below stamped with its catalog code. */
interface CatalogCodeCarrier {
  [catalogCodeKey]?: string | number;
}

/** Definition of a single error in a catalog. */
export interface ErrorCatalogEntry {
  /**
   * Human-readable message. Use a function to interpolate typed parameters;
   * the parameter type flows through to the call site.
   */
  message: string | ((params: never) => string);
  /** HTTP status to surface to clients. */
  status?: number;
  /** Stable error code. Defaults to `${namespace}.${KEY}`. */
  code?: string | number;
  /** Why it happened. A function receives the same params as `message`. */
  why?: string | ((params: never) => string);
  /** What the caller should do next. */
  fix?: string;
  /** Docs or runbook link. */
  link?: string;
  /** Error name. Defaults to the catalog key. */
  name?: string;
}

/** Per-call options passed alongside (or instead of) typed params. */
export interface ErrorBuildOptions {
  cause?: unknown;
  details?: LogFields;
  /** Backend-only context. Never serialized to clients. */
  internal?: LogFields;
}

type ParamsOf<E> = E extends { message: (params: infer P) => string }
  ? P
  : E extends { why: (params: infer P) => string }
    ? P
    : void;

type BuilderArgs<E extends ErrorCatalogEntry> =
  ParamsOf<E> extends void
    ? [options?: ErrorBuildOptions]
    : [params: ParamsOf<E>, options?: ErrorBuildOptions];

/** A callable error factory produced by {@link defineErrorCatalog}. */
export interface ErrorBuilder<E extends ErrorCatalogEntry> {
  (...args: BuilderArgs<E>): StructuredError;
  /** Stable code assigned to every error from this entry. */
  readonly code: string | number;
  /** True when `error` was produced by this catalog entry. */
  match(error: unknown): boolean;
}

export type ErrorCatalog<T extends Record<string, ErrorCatalogEntry>> = {
  readonly [K in keyof T]: ErrorBuilder<T[K]>;
};

function readCatalogCode(error: unknown): string | number | undefined {
  if (!asRecord(error)) return undefined;
  // SAFETY: the code is stored under this module's own symbol by the builder
  // below; a value from anywhere else simply does not carry it.
  const stored = (error as CatalogCodeCarrier)[catalogCodeKey];
  return asString(stored) ?? asNumber(stored);
}

/** True when `error` was produced by any autotel error catalog. */
export function isCatalogError(error: unknown): error is StructuredError {
  return readCatalogCode(error) !== undefined;
}

/** Returns the catalog code of `error`, or `undefined` if it has none. */
export function getCatalogCode(error: unknown): string | number | undefined {
  return readCatalogCode(error);
}

/**
 * Define a typed error catalog. Returns an object whose keys are error
 * builders. Each builder produces a {@link StructuredError} carrying the
 * entry's message, status, code, why, fix, and link.
 */
export function defineErrorCatalog<
  const T extends Record<string, ErrorCatalogEntry>,
>(namespace: string, entries: T): ErrorCatalog<T> {
  const catalog: Record<string, ErrorBuilder<ErrorCatalogEntry>> = {};

  // SAFETY: the entries come from the caller's own catalog literal, so each
  // key is one of T's and each value that key's entry.
  for (const [key, entry] of Object.entries(entries) as [
    string,
    ErrorCatalogEntry,
  ][]) {
    const code = entry.code ?? `${namespace}.${key}`;
    const messageFor = asFunction(entry.message);
    const whyFor = asFunction(entry.why);
    const usesParams = Boolean(messageFor || whyFor);

    // SAFETY: the builder's call signature depends on whether the entry's
    // message takes params, which only the entry itself declares.
    const builder = ((
      paramsOrOptions?: unknown,
      maybeOptions?: ErrorBuildOptions,
    ): StructuredError => {
      const params = usesParams ? paramsOrOptions : undefined;
      // SAFETY: the two overloads differ by whether params come first.
      const options = (usesParams ? maybeOptions : paramsOrOptions) as
        ErrorBuildOptions | undefined;

      const message = messageFor
        ? String(messageFor(params))
        : (asString(entry.message) ?? '');
      const why = whyFor ? String(whyFor(params)) : asString(entry.why);

      // Every optional field is passed as undefined when absent, which
      // createStructuredError treats the same way an omitted key would be.
      const error = createStructuredError({
        message,
        name: entry.name ?? key,
        code,
        status: entry.status,
        why,
        fix: entry.fix,
        link: entry.link,
        cause: options?.cause,
        details: options?.details,
        internal: options?.internal,
      });

      Object.defineProperty(error, catalogCodeKey, {
        value: code,
        enumerable: false,
        writable: false,
        configurable: true,
      });

      return error;
    }) as ErrorBuilder<ErrorCatalogEntry>;

    Object.defineProperty(builder, 'code', {
      value: code,
      enumerable: true,
    });
    Object.defineProperty(builder, 'match', {
      value: (error: unknown): boolean => readCatalogCode(error) === code,
      enumerable: false,
    });

    catalog[key] = builder;
  }

  // SAFETY: the catalog was built by walking T's own keys.
  return Object.freeze(catalog) as ErrorCatalog<T>;
}

/** Severity of an audit action. */
export type AuditSeverity = 'info' | 'warn' | 'critical';

/** Definition of a single action in an audit catalog. */
export interface AuditCatalogEntry {
  /** Human-readable description. Use a function for typed params. */
  message?: string | ((params: never) => string);
  /** Stable action name. Defaults to `${namespace}.${KEY}`. */
  action?: string;
  /** Severity of the action. Defaults to `'info'`. */
  severity?: AuditSeverity;
}

/** A resolved audit action descriptor produced by an audit catalog. */
export interface AuditAction {
  readonly action: string;
  readonly severity: AuditSeverity;
  readonly message?: string;
}

type AuditDescriptorArgs<E extends AuditCatalogEntry> =
  ParamsOf<E> extends void ? [] : [params: ParamsOf<E>];

/** A callable audit-action descriptor produced by {@link defineAuditCatalog}. */
export interface AuditDescriptor<E extends AuditCatalogEntry> {
  (...args: AuditDescriptorArgs<E>): AuditAction;
  readonly action: string;
  readonly severity: AuditSeverity;
}

export type AuditCatalog<T extends Record<string, AuditCatalogEntry>> = {
  readonly [K in keyof T]: AuditDescriptor<T[K]>;
};

/**
 * Define a typed audit catalog. Returns typed action descriptors you can pass
 * to `track()` or audit helpers without scattering magic strings.
 */
export function defineAuditCatalog<
  const T extends Record<string, AuditCatalogEntry>,
>(namespace: string, entries: T): AuditCatalog<T> {
  const catalog: Record<string, AuditDescriptor<AuditCatalogEntry>> = {};

  // SAFETY: the entries come from the caller's own catalog literal, so each
  // key is one of T's and each value that key's entry.
  for (const [key, entry] of Object.entries(entries) as [
    string,
    AuditCatalogEntry,
  ][]) {
    const action = entry.action ?? `${namespace}.${key}`;
    const severity: AuditSeverity = entry.severity ?? 'info';

    const auditMessageFor = asFunction(entry.message);

    // SAFETY: as with the error builder - the signature depends on whether
    // this entry's message takes params.
    const descriptor = ((params?: unknown): AuditAction => {
      const message = auditMessageFor
        ? String(auditMessageFor(params))
        : asString(entry.message);
      return Object.freeze({
        action,
        severity,
        message,
      });
    }) as AuditDescriptor<AuditCatalogEntry>;

    Object.defineProperty(descriptor, 'action', {
      value: action,
      enumerable: true,
    });
    Object.defineProperty(descriptor, 'severity', {
      value: severity,
      enumerable: true,
    });

    catalog[key] = descriptor;
  }

  // SAFETY: as above - built from the caller's own entries.
  return Object.freeze(catalog) as AuditCatalog<T>;
}
