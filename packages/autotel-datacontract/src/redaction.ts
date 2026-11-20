import type { DataContract, SchemaProperty } from './contract.js';

const SENSITIVE_CLASSES = new Set([
  'restricted',
  'confidential',
  'secret',
  'sensitive',
  'pii',
]);

export const isSensitive = (
  p: Pick<SchemaProperty, 'classification' | 'tags'>,
): boolean =>
  SENSITIVE_CLASSES.has((p.classification ?? '').toLowerCase()) ||
  (p.tags ?? []).some((t) => /^pii(:true)?$/i.test(t));

/** Dot paths (`customers.customer_name`) of every field the contract marks restricted, confidential or `pii:true`. */
export function sensitiveFields(contract: DataContract): string[] {
  const out: string[] = [];
  const walk = (props: SchemaProperty[] | undefined, prefix: string) => {
    for (const p of props ?? []) {
      const path = `${prefix}.${p.name}`;
      if (isSensitive(p)) out.push(path);
      walk(p.properties, path);
    }
  };
  for (const obj of contract.schema ?? []) walk(obj.properties, obj.name);
  return out;
}

/**
 * Key patterns for autotel's attribute redactor, so a span attribute named
 * like a sensitive column is redacted wherever it turns up:
 * `init({ attributeRedactor: { keyPatterns: redactionKeyPatterns(contract) } })`.
 */
export function redactionKeyPatterns(contract: DataContract): RegExp[] {
  const names = new Set(
    sensitiveFields(contract).map((p) => p.slice(p.lastIndexOf('.') + 1)),
  );
  return [...names]
    .toSorted()
    .map(
      (n) =>
        new RegExp(
          `^${n.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)}$`,
          'i',
        ),
    );
}
