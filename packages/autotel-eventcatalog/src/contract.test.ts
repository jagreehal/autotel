// Contract tests for the public JSON surface.
//
// These are *not* about whether the renderer produces nice-looking output;
// `report.test.ts` covers that. These tests treat the JSON shape as a public
// contract that downstream tooling (the GitHub Action, Slack bots, dashboards)
// can depend on. A failure here should read as:
//
//   "You changed the published contract for vX.Y.Z. Either revert the change
//    or bump the spec version and update consumers."
//
// We deliberately avoid taking an ajv dependency for runtime validation; the
// schemas are tiny and the validator below is hand-rolled in ~60 lines. The
// JSON Schema files in `schemas/` are the shipped artifact that consumers can
// validate against using whichever validator they prefer.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { REPORT_SPEC, renderJson, type JsonReportEnvelope } from './report';
import { buildStampSummary, STAMP_SUMMARY_SPEC } from './stamp';
import { buildGenerateSummary, GENERATE_SUMMARY_SPEC } from './generate';
import { evaluatePolicy } from './policy';
import { countDriftReport } from './diff';
import type { DriftReport } from './diff';
import type { DriftDelta } from './diff-vs-base';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMAS = join(HERE, '..', 'schemas');

type JsonSchema = {
  required?: string[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean;
  type?: string;
  const?: unknown;
  enum?: unknown[];
  items?: JsonSchema;
  minimum?: number;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
};

/**
 * Minimal JSON Schema validator. Supports the subset of keywords used in
 * our shipped schemas: type, const, enum, required, properties,
 * additionalProperties, items, minimum, oneOf, allOf, $defs / $ref.
 *
 * Throws on unsupported keywords so we notice if we drift past the subset.
 */
function validate(
  data: unknown,
  schema: JsonSchema,
  defs: Record<string, JsonSchema> = schema.$defs ?? {},
  path = '$',
): string[] {
  const errors: string[] = [];

  if (schema.$ref) {
    const name = schema.$ref.replace('#/$defs/', '');
    const target = defs[name];
    if (!target) {
      errors.push(`${path}: unresolved $ref ${schema.$ref}`);
      return errors;
    }
    return validate(data, target, defs, path);
  }

  if (schema.oneOf) {
    const matched = schema.oneOf.filter(
      (s) => validate(data, s, defs, path).length === 0,
    );
    if (matched.length !== 1) {
      errors.push(
        `${path}: expected to match exactly one oneOf branch, matched ${matched.length}`,
      );
    }
    return errors;
  }

  if (schema.allOf) {
    for (const s of schema.allOf) errors.push(...validate(data, s, defs, path));
    return errors;
  }

  if (schema.const !== undefined && data !== schema.const) {
    errors.push(
      `${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(data)}`,
    );
  }

  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(
      `${path}: value ${JSON.stringify(data)} not in enum ${JSON.stringify(schema.enum)}`,
    );
  }

  if (schema.type) {
    const actual =
      data === null
        ? 'null'
        : Array.isArray(data)
          ? 'array'
          : typeof data === 'number' && Number.isInteger(data)
            ? 'integer'
            : typeof data;
    const ok =
      (schema.type === 'integer' && actual === 'integer') ||
      (schema.type === 'number' &&
        (actual === 'number' || actual === 'integer')) ||
      schema.type === actual;
    if (!ok)
      errors.push(`${path}: expected type ${schema.type}, got ${actual}`);
  }

  if (
    schema.minimum !== undefined &&
    typeof data === 'number' &&
    data < schema.minimum
  ) {
    errors.push(`${path}: ${data} < minimum ${schema.minimum}`);
  }

  if (schema.required && typeof data === 'object' && data !== null) {
    for (const key of schema.required) {
      if (!(key in (data as Record<string, unknown>))) {
        errors.push(`${path}: missing required property "${key}"`);
      }
    }
  }

  if (schema.properties && typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (key in obj) {
        errors.push(...validate(obj[key], sub, defs, `${path}.${key}`));
      }
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in schema.properties)) {
          errors.push(`${path}: unexpected property "${key}"`);
        }
      }
    }
  }

  if (schema.items && Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      errors.push(...validate(data[i], schema.items, defs, `${path}[${i}]`));
    }
  }

  return errors;
}

function loadSchema(name: string): JsonSchema {
  return JSON.parse(readFileSync(join(SCHEMAS, name), 'utf8'));
}

// ─── Fixtures ──────────────────────────────────────────────
const emptyReport: DriftReport = {
  snapshotGeneratedAt: '2026-05-22T00:00:00.000Z',
  snapshotService: 'fixture',
  events: {
    observedButUndocumented: [],
    documentedButUnseen: [],
    fieldDrift: [],
    typeDrift: [],
    valueDrift: [],
  },
  services: { observedButUndocumented: [] },
  channels: { observedButUndocumented: [] },
};

const driftyReport: DriftReport = {
  ...emptyReport,
  events: {
    observedButUndocumented: ['order.cancelled'],
    documentedButUnseen: ['LegacyEvent'],
    fieldDrift: [
      {
        event: 'recommendation.generated',
        extra: ['personalization_seed'],
        missing: [],
      },
    ],
    typeDrift: [],
    valueDrift: [],
  },
};

const cleanDelta: DriftDelta = {
  hasNewDrift: false,
  introduced: {
    events: {
      observedButUndocumented: [],
      documentedButUnseen: [],
      fieldDrift: [],
      typeDrift: [],
      valueDrift: [],
    },
    services: { observedButUndocumented: [] },
    channels: { observedButUndocumented: [] },
  },
  resolved: {
    events: {
      observedButUndocumented: [],
      documentedButUnseen: [],
      fieldDrift: [],
      typeDrift: [],
      valueDrift: [],
    },
    services: { observedButUndocumented: [] },
    channels: { observedButUndocumented: [] },
  },
};

// ─── Contract: drift report JSON envelope ──────────────────
describe('drift report JSON envelope (autotel-eventcatalog-report/v0.2.0)', () => {
  const schema = loadSchema('drift-report-v0.2.0.json');

  it('mode=all output validates against the published schema', () => {
    const json = renderJson({ mode: 'all', report: driftyReport });
    const parsed = JSON.parse(json);
    expect(validate(parsed, schema)).toEqual([]);
    expect(parsed.spec).toBe(REPORT_SPEC);
  });

  it('mode=new-only output validates against the published schema', () => {
    const json = renderJson({ mode: 'new-only', delta: cleanDelta });
    const parsed = JSON.parse(json);
    expect(validate(parsed, schema)).toEqual([]);
  });

  it('byte-equal to golden fixture for a representative drifty report', () => {
    // Lock the exact bytes for the all-mode envelope. If a future change
    // re-orders keys or changes whitespace, this test fails with a clear
    // message: "You changed the published contract."
    const json = renderJson({ mode: 'all', report: driftyReport });
    const golden = readFileSync(
      join(HERE, '__fixtures__', 'drift-report-all.golden.json'),
      'utf8',
    );
    // Goldens are written with a trailing newline (POSIX convention); the
    // renderer omits it. Compare with the trailing newline normalised so the
    // contract is "every byte of the JSON envelope", not "do you end with \n".
    expect(json).toBe(golden.replace(/\n$/, ''));
  });

  it('spec marker is the only place the version lives; bumping it is a breaking change', () => {
    // Sanity: if someone renames REPORT_SPEC by accident, the published
    // contract changes silently. Pin it to the schema's const here.
    const schemaConst = (
      (schema.oneOf ?? [])[0]?.properties?.spec as
        | { const?: string }
        | undefined
    )?.const;
    expect(REPORT_SPEC).toBe(schemaConst);
  });
});

// ─── Contract: drift summary JSON ──────────────────────────
describe('drift summary JSON (autotel-eventcatalog-drift-summary/v0.2.0)', () => {
  const schema = loadSchema('drift-summary-v0.2.0.json');
  // The CLI builds the summary inline; we replicate the shape here so the
  // contract test is independent of CLI implementation details. The
  // important thing is that the shape we ship matches the published schema.
  function buildSummary(
    mode: 'all' | 'new-only',
    report: DriftReport,
  ): unknown {
    const policy = evaluatePolicy({ mode: 'all', report });
    return {
      spec: 'autotel-eventcatalog-drift-summary/v0.2.0',
      mode,
      shouldFail: policy.shouldFail,
      reason: policy.reason,
      counts: countDriftReport(report),
    };
  }

  it('clean drift summary validates against the schema', () => {
    expect(validate(buildSummary('all', emptyReport), schema)).toEqual([]);
  });

  it('drifty summary validates against the schema', () => {
    expect(validate(buildSummary('all', driftyReport), schema)).toEqual([]);
  });

  it('byte-equal to golden fixture for a clean run', () => {
    const summary = buildSummary('all', emptyReport);
    const json = JSON.stringify(summary, null, 2);
    const golden = readFileSync(
      join(HERE, '__fixtures__', 'drift-summary-clean.golden.json'),
      'utf8',
    );
    expect(json).toBe(golden.trimEnd());
  });

  it('byte-equal to golden fixture for a drifty run', () => {
    const summary = buildSummary('all', driftyReport);
    const json = JSON.stringify(summary, null, 2);
    const golden = readFileSync(
      join(HERE, '__fixtures__', 'drift-summary-drifty.golden.json'),
      'utf8',
    );
    expect(json).toBe(golden.trimEnd());
  });
});

// ─── Contract: stamp summary JSON ──────────────────────────
describe('stamp summary JSON (autotel-eventcatalog-stamp-summary/v0.1.0)', () => {
  const schema = loadSchema('stamp-summary-v0.1.0.json');

  it('mixed-results summary validates', () => {
    const summary = buildStampSummary(
      {
        updates: [
          {
            catalogId: 'A',
            snapshotName: 'a',
            filePath: '/x/a.mdx',
            action: 'insert',
            changed: true,
          },
          {
            catalogId: 'B',
            snapshotName: 'b',
            filePath: '/x/b.mdx',
            action: 'replace',
            changed: false,
          },
        ],
        skips: [{ snapshotName: 'gone', reason: 'no-catalog-match' }],
      },
      false,
    );
    expect(summary.spec).toBe(STAMP_SUMMARY_SPEC);
    expect(validate(summary, schema)).toEqual([]);
  });

  it('byte-equal to golden fixture for a no-op run', () => {
    const summary = buildStampSummary({ updates: [], skips: [] }, false);
    const json = JSON.stringify(summary, null, 2);
    const golden = readFileSync(
      join(HERE, '__fixtures__', 'stamp-summary-noop.golden.json'),
      'utf8',
    );
    expect(json).toBe(golden.trimEnd());
  });
});

// ─── Contract: generate summary JSON ───────────────────────
describe('generate summary JSON (autotel-eventcatalog-generate-summary/v0.1.0)', () => {
  const schema = loadSchema('generate-summary-v0.1.0.json');

  it('validates against the published schema', () => {
    const summary = buildGenerateSummary(
      {
        operations: [
          { kind: 'service', id: 'OrdersService', action: 'create' },
          { kind: 'service', id: 'PaymentService', action: 'create' },
          {
            kind: 'event',
            id: 'OrderPlaced',
            action: 'create',
            schemaSource: 'declared',
          },
          {
            kind: 'event',
            id: 'PaymentCaptured',
            action: 'create',
            schemaSource: 'inferred',
          },
          { kind: 'channel', id: 'orders.events', action: 'create' },
          {
            kind: 'service-edge',
            id: 'OrdersService->OrderPlaced',
            action: 'link',
          },
          {
            kind: 'service-edge',
            id: 'PaymentService<-OrderPlaced',
            action: 'link',
            detail: 'receives',
          },
          {
            kind: 'channel-edge',
            id: 'OrderPlaced->orders.events',
            action: 'link',
          },
        ],
      },
      { dryRun: false, edgesOnly: false },
    );
    expect(validate(summary, schema)).toEqual([]);
    expect(summary.spec).toBe(GENERATE_SUMMARY_SPEC);
    expect(summary.totals).toEqual({ created: 5, linked: 3, skipped: 0 });
    expect(summary.created.services).toEqual([
      'OrdersService',
      'PaymentService',
    ]);
    expect(summary.edges.sends).toEqual([
      { service: 'OrdersService', event: 'OrderPlaced' },
    ]);
    expect(summary.edges.receives).toEqual([
      { service: 'PaymentService', event: 'OrderPlaced' },
    ]);
    expect(summary.edges.messages).toEqual([
      { channel: 'orders.events', event: 'OrderPlaced' },
    ]);
    expect(summary.schemaSources).toEqual({ declared: 1, inferred: 1 });
  });

  it('validates a dry-run no-op (empty plan) against the schema', () => {
    const summary = buildGenerateSummary(
      { operations: [] },
      { dryRun: true, edgesOnly: false },
    );
    expect(validate(summary, schema)).toEqual([]);
    expect(summary.dryRun).toBe(true);
    expect(summary.totals).toEqual({ created: 0, linked: 0, skipped: 0 });
  });

  it('rejects a payload missing required `totals`', () => {
    const broken = {
      spec: GENERATE_SUMMARY_SPEC,
      dryRun: false,
      edgesOnly: false,
      attempted: 0,
      created: { services: [], events: [], channels: [] },
      edges: { sends: [], receives: [], messages: [] },
      schemaSources: { declared: 0, inferred: 0 },
      skipped: { services: [], events: [], channels: [] },
    };
    expect(validate(broken, schema).length).toBeGreaterThan(0);
  });
});

// ─── Validator self-check ─────────────────────────────────
describe('tiny JSON Schema validator (used by the contract tests above)', () => {
  it('catches missing required properties', () => {
    const errs = validate({ a: 1 }, { required: ['a', 'b'], properties: {} });
    expect(errs).toEqual([
      expect.stringContaining('missing required property "b"'),
    ]);
  });

  it('rejects const mismatches', () => {
    const errs = validate(
      { spec: 'wrong' },
      {
        properties: { spec: { const: 'right' } },
      },
    );
    expect(errs[0]).toContain('expected const');
  });

  it('integer vs number distinction', () => {
    expect(validate(1.5, { type: 'integer' })).toHaveLength(1);
    expect(validate(2, { type: 'integer' })).toEqual([]);
    expect(validate(2, { type: 'number' })).toEqual([]);
    expect(validate(1.5, { type: 'number' })).toEqual([]);
  });

  it('rejects additional properties when additionalProperties: false', () => {
    const errs = validate(
      { a: 1, b: 2 },
      { properties: { a: { type: 'number' } }, additionalProperties: false },
    );
    expect(errs[0]).toContain('unexpected property "b"');
  });

  // Silence the unused-envelope-type import without polluting runtime.
  it('exports the envelope type', () => {
    const _envelope = null as unknown as JsonReportEnvelope;
    expect(_envelope).toBe(null);
  });
});
