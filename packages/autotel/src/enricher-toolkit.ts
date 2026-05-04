export interface EnrichContext<TEvent extends Record<string, unknown>> {
  event: TEvent;
  request?: {
    method?: string;
    path?: string;
    requestId?: string;
  };
  response?: {
    status?: number;
  };
  headers?: Record<string, string>;
}

export interface EnricherDefinition<
  TEvent extends Record<string, unknown>,
  TValue extends object,
> {
  /** Stable identifier used in error logs. */
  name: string;
  /** Top-level field to merge computed values into. */
  field: keyof TEvent & string;
  /** Return undefined to skip enrichment. */
  compute: (ctx: EnrichContext<TEvent>) => TValue | undefined;
}

export interface EnricherOptions {
  /** Replace existing field value instead of merge. Default false. */
  overwrite?: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mergeInto(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const key in source) {
    const sourceVal = source[key];
    if (sourceVal === undefined) continue;
    const targetVal = target[key];
    if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
      mergeInto(targetVal, sourceVal);
    } else {
      target[key] = sourceVal;
    }
  }
}

export function defineEnricher<
  TEvent extends Record<string, unknown>,
  TValue extends object,
>(
  def: EnricherDefinition<TEvent, TValue>,
  options: EnricherOptions = {},
): (ctx: EnrichContext<TEvent>) => void {
  return (ctx: EnrichContext<TEvent>) => {
    let computed: TValue | undefined;
    try {
      computed = def.compute(ctx);
    } catch (error) {
      console.error(`[autotel/${def.name}] enrich failed:`, error);
      return;
    }

    if (!computed) return;

    if (options.overwrite || !isPlainObject(ctx.event[def.field])) {
      (ctx.event as Record<string, unknown>)[def.field] = computed;
      return;
    }

    mergeInto(
      ctx.event[def.field] as unknown as Record<string, unknown>,
      computed as unknown as Record<string, unknown>,
    );
  };
}
