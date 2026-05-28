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

import { createStructuredError, type StructuredError } from './structured-error';

const catalogCodeKey = Symbol.for('autotel.catalog.code');

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
  details?: Record<string, unknown>;
  /** Backend-only context. Never serialized to clients. */
  internal?: Record<string, unknown>;
}

type ParamsOf<E> = E extends { message: (params: infer P) => string }
  ? P
  : E extends { why: (params: infer P) => string }
    ? P
    : void;

type BuilderArgs<E extends ErrorCatalogEntry> = ParamsOf<E> extends void
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
  if (error === null || typeof error !== 'object') return undefined;
  return (error as Record<symbol, unknown>)[catalogCodeKey] as
    | string
    | number
    | undefined;
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

  for (const [key, entry] of Object.entries(entries) as [
    string,
    ErrorCatalogEntry,
  ][]) {
    const code = entry.code ?? `${namespace}.${key}`;
    const usesParams =
      typeof entry.message === 'function' || typeof entry.why === 'function';

    const builder = ((
      paramsOrOptions?: unknown,
      maybeOptions?: ErrorBuildOptions,
    ): StructuredError => {
      const params = usesParams ? paramsOrOptions : undefined;
      const options = (
        usesParams ? maybeOptions : paramsOrOptions
      ) as ErrorBuildOptions | undefined;

      const message =
        typeof entry.message === 'function'
          ? (entry.message as (p: unknown) => string)(params)
          : entry.message;
      const why =
        typeof entry.why === 'function'
          ? (entry.why as (p: unknown) => string)(params)
          : entry.why;

      const error = createStructuredError({
        message,
        name: entry.name ?? key,
        code,
        ...(entry.status === undefined ? {} : { status: entry.status }),
        ...(why === undefined ? {} : { why }),
        ...(entry.fix === undefined ? {} : { fix: entry.fix }),
        ...(entry.link === undefined ? {} : { link: entry.link }),
        ...(options?.cause === undefined ? {} : { cause: options.cause }),
        ...(options?.details === undefined ? {} : { details: options.details }),
        ...(options?.internal === undefined
          ? {}
          : { internal: options.internal }),
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

type AuditDescriptorArgs<E extends AuditCatalogEntry> = ParamsOf<E> extends void
  ? []
  : [params: ParamsOf<E>];

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

  for (const [key, entry] of Object.entries(entries) as [
    string,
    AuditCatalogEntry,
  ][]) {
    const action = entry.action ?? `${namespace}.${key}`;
    const severity: AuditSeverity = entry.severity ?? 'info';

    const descriptor = ((params?: unknown): AuditAction => {
      const message =
        typeof entry.message === 'function'
          ? (entry.message as (p: unknown) => string)(params)
          : entry.message;
      return Object.freeze({
        action,
        severity,
        ...(message === undefined ? {} : { message }),
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

  return Object.freeze(catalog) as AuditCatalog<T>;
}
