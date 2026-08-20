import type { UnknownRecord } from './values';
import { asRecord } from './values';

export interface EnrichContext<TEvent extends UnknownRecord> {
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
  TEvent extends UnknownRecord,
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

function mergeInto(target: UnknownRecord, source: UnknownRecord): void {
  for (const key in source) {
    const sourceVal = source[key];
    if (sourceVal === undefined) continue;
    const sourceRecord = asRecord(sourceVal);
    const targetRecord = asRecord(target[key]);
    if (sourceRecord && targetRecord) {
      mergeInto(targetRecord, sourceRecord);
    } else {
      target[key] = sourceVal;
    }
  }
}

export function defineEnricher<
  TEvent extends UnknownRecord,
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

    // SAFETY: TEvent is constrained to a bag of fields, and `field` is one of
    // its keys - the enricher writes to the field it declared.
    const event = ctx.event as UnknownRecord;
    const existing = asRecord(event[def.field]);
    if (options.overwrite || !existing) {
      event[def.field] = computed;
      return;
    }

    // SAFETY: computed is an object by TValue's constraint, and merging it
    // into the existing bag is what this enricher was asked to do.
    mergeInto(existing, computed as UnknownRecord);
  };
}
