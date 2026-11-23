/**
 * Fields a comparison must not rank, because the queries already decided them.
 *
 * Investigating `status = ERROR` against everything else, `status=ERROR` is in
 * 100% of one side by construction, and so is every field that restates a
 * failure: `error`, `error.type`, `exception.type`, `operation.success`.
 * Ranked, those rows would sit above the attribute the reader came for (a flag
 * variant, a currency). The same holds for any field a query filters on,
 * including an experiment's or flag's arm.
 */
import { parse, type QueryNode } from '../query';

/** Every field that says "this span failed": filtering on one decides them all. */
const OUTCOME_FIELDS = [
  'status',
  'error',
  'error.type',
  'exception.type',
  'exception.message',
  'exception.stack',
  'exception.stacktrace',
  'operation.success',
  'otel.status_code',
  'otel.status_description',
];

export function cohortDefinitionFields(...queries: string[]): string[] {
  const fields = new Set<string>();
  const walk = (node: QueryNode): void => {
    if (node.type === 'comparison') fields.add(node.field);
    else if (node.type === 'and' || node.type === 'or') {
      walk(node.left);
      walk(node.right);
    }
  };
  for (const query of queries) {
    const parsed = parse(query);
    if (parsed.ok) walk(parsed.node);
  }
  if (OUTCOME_FIELDS.some((field) => fields.has(field))) {
    for (const field of OUTCOME_FIELDS) fields.add(field);
  }
  return [...fields];
}
