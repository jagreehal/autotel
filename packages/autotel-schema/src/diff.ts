/**
 * Snapshot diffing — the CI gate that catches breaking changes to your trace
 * surface before they ship.
 *
 * "If you wouldn't ship a rename to your public API without a changelog, don't
 * do it to your traces." This module is what makes that enforceable: classify
 * every change between two snapshots as breaking, additive, or neutral, and let
 * CI fail on the breaking ones.
 */

import type { ContractSnapshot, SnapshotAttribute } from './snapshot.js';

export type ChangeKind = 'breaking' | 'additive' | 'neutral';

export type ChangeType =
  | 'span_removed'
  | 'span_added'
  | 'attribute_removed'
  | 'attribute_added'
  | 'type_changed'
  | 'required_added'
  | 'required_removed'
  | 'enum_value_removed'
  | 'enum_value_added'
  | 'stability_downgraded'
  | 'stability_advanced'
  | 'deprecated'
  | 'replacement_documented';

export interface SnapshotChange {
  kind: ChangeKind;
  type: ChangeType;
  /** Span the change applies to (`*` = common attributes / contract-wide). */
  span: string;
  attribute?: string;
  message: string;
}

export interface SnapshotDiff {
  service: string;
  previousVersion: string;
  nextVersion: string;
  breaking: SnapshotChange[];
  additive: SnapshotChange[];
  neutral: SnapshotChange[];
}

/**
 * How every cross-stability transition is classified. Keyed `prev->next` so all
 * six transitions are explicit and auditable — no silent fall-through. Same-
 * stability transitions are absent (no change to report).
 */
const STABILITY_TRANSITIONS: Record<
  string,
  { kind: ChangeKind; type: ChangeType }
> = {
  'stable->experimental': { kind: 'breaking', type: 'stability_downgraded' },
  'stable->deprecated': { kind: 'additive', type: 'deprecated' },
  'experimental->stable': { kind: 'neutral', type: 'stability_advanced' },
  'experimental->deprecated': { kind: 'additive', type: 'deprecated' },
  'deprecated->stable': { kind: 'neutral', type: 'stability_advanced' },
  'deprecated->experimental': { kind: 'breaking', type: 'stability_downgraded' },
};

function stabilityMessage(
  type: ChangeType,
  attribute: string,
  prev: SnapshotAttribute,
  next: SnapshotAttribute,
): string {
  if (type === 'deprecated') {
    return `attribute "${attribute}" was deprecated${next.replacedBy ? ` (use "${next.replacedBy}")` : ''}`;
  }
  if (type === 'stability_downgraded') {
    return `attribute "${attribute}" stability downgraded ${prev.stability} → ${next.stability}`;
  }
  return `attribute "${attribute}" promoted ${prev.stability} → ${next.stability}`;
}

function push(
  diff: SnapshotDiff,
  change: SnapshotChange,
): void {
  if (change.kind === 'breaking') diff.breaking.push(change);
  else if (change.kind === 'additive') diff.additive.push(change);
  else diff.neutral.push(change);
}

function diffAttribute(
  diff: SnapshotDiff,
  span: string,
  attribute: string,
  prev: SnapshotAttribute,
  next: SnapshotAttribute,
): void {
  if (prev.type !== next.type) {
    push(diff, {
      kind: 'breaking',
      type: 'type_changed',
      span,
      attribute,
      message: `attribute "${attribute}" changed type ${prev.type} → ${next.type}`,
    });
  }

  if (!prev.required && next.required) {
    push(diff, {
      kind: 'breaking',
      type: 'required_added',
      span,
      attribute,
      message: `attribute "${attribute}" became required`,
    });
  } else if (prev.required && !next.required) {
    push(diff, {
      kind: 'additive',
      type: 'required_removed',
      span,
      attribute,
      message: `attribute "${attribute}" is no longer required`,
    });
  }

  // Enum: removing a permitted value can break a producer that still emits it.
  if (prev.enum && next.enum) {
    const nextSet = new Set(next.enum);
    const removed = prev.enum.filter((v) => !nextSet.has(v));
    const prevSet = new Set(prev.enum);
    const added = next.enum.filter((v) => !prevSet.has(v));
    if (removed.length > 0) {
      push(diff, {
        kind: 'breaking',
        type: 'enum_value_removed',
        span,
        attribute,
        message: `attribute "${attribute}" dropped enum value(s) ${JSON.stringify(removed)}`,
      });
    }
    if (added.length > 0) {
      push(diff, {
        kind: 'additive',
        type: 'enum_value_added',
        span,
        attribute,
        message: `attribute "${attribute}" added enum value(s) ${JSON.stringify(added)}`,
      });
    }
  }

  if (prev.stability !== next.stability) {
    const transition =
      STABILITY_TRANSITIONS[`${prev.stability}->${next.stability}`];
    if (transition) {
      push(diff, {
        ...transition,
        span,
        attribute,
        message: stabilityMessage(transition.type, attribute, prev, next),
      });
    }
  }
}

function diffAttributeMaps(
  diff: SnapshotDiff,
  span: string,
  prev: Record<string, SnapshotAttribute>,
  next: Record<string, SnapshotAttribute>,
): void {
  for (const [key, prevAttr] of Object.entries(prev)) {
    const nextAttr = next[key];
    if (!nextAttr) {
      // A removed attribute whose replacement is named is a documented
      // migration (still breaking — but reported as such with the pointer).
      push(diff, {
        kind: 'breaking',
        type: prevAttr.replacedBy ? 'replacement_documented' : 'attribute_removed',
        span,
        attribute: key,
        message: prevAttr.replacedBy
          ? `attribute "${key}" removed — replaced by "${prevAttr.replacedBy}"`
          : `attribute "${key}" was removed`,
      });
      continue;
    }
    diffAttribute(diff, span, key, prevAttr, nextAttr);
  }
  for (const key of Object.keys(next)) {
    if (!prev[key]) {
      const added = next[key];
      // Always `attribute_added` (the event is "new attribute"); severity rides
      // on `kind` — a new *required* attribute breaks existing producers.
      push(diff, {
        kind: added.required ? 'breaking' : 'additive',
        type: 'attribute_added',
        span,
        attribute: key,
        message: added.required
          ? `new required attribute "${key}" added`
          : `new attribute "${key}" added`,
      });
    }
  }
}

/**
 * Diff two snapshots, classifying every change. The `breaking` array is what a
 * CI gate keys off; `hasBreakingChanges()` is the convenience predicate.
 */
export function diffSnapshots(
  previous: ContractSnapshot,
  next: ContractSnapshot,
): SnapshotDiff {
  const diff: SnapshotDiff = {
    service: next.service,
    previousVersion: previous.version,
    nextVersion: next.version,
    breaking: [],
    additive: [],
    neutral: [],
  };

  diffAttributeMaps(diff, '*', previous.commonAttributes, next.commonAttributes);

  for (const [name, prevSpan] of Object.entries(previous.spans)) {
    const nextSpan = next.spans[name];
    if (!nextSpan) {
      push(diff, {
        kind: 'breaking',
        type: 'span_removed',
        span: name,
        message: `span "${name}" was removed`,
      });
      continue;
    }
    diffAttributeMaps(diff, name, prevSpan.attributes, nextSpan.attributes);
  }
  for (const name of Object.keys(next.spans)) {
    if (!previous.spans[name]) {
      push(diff, {
        kind: 'additive',
        type: 'span_added',
        span: name,
        message: `new span "${name}" added`,
      });
    }
  }

  return diff;
}

/** `true` when the diff contains at least one breaking change. */
export function hasBreakingChanges(diff: SnapshotDiff): boolean {
  return diff.breaking.length > 0;
}

/** Markdown rendering of a diff — for CI logs and PR comments. */
export function formatDiff(diff: SnapshotDiff): string {
  const lines: string[] = [ 
    `# Telemetry contract diff: ${diff.service} ${diff.previousVersion} → ${diff.nextVersion}`,
    ''];
  const section = (title: string, changes: SnapshotChange[]) => {
    if (changes.length === 0) return;
    lines.push(`## ${title} (${changes.length})`, '');
    for (const c of changes) {
      const where = c.attribute ? `\`${c.span}.${c.attribute}\`` : `\`${c.span}\``;
      lines.push(`- ${where}: ${c.message}`);
    }
    lines.push('');
  };
  section('💥 Breaking', diff.breaking);
  section('➕ Additive', diff.additive);
  section('• Neutral', diff.neutral);
  if (
    diff.breaking.length === 0 &&
    diff.additive.length === 0 &&
    diff.neutral.length === 0
  ) {
    lines.push('No changes to the telemetry contract.', '');
  }
  return lines.join('\n');
}
