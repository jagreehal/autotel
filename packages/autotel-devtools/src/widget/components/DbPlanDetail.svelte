<script lang="ts">
  /**
   * Under a database span's statement in span detail: whether the statement
   * repeated in this trace, and what its plan says (`PlanDiagnosis`). This
   * span is the run the plan describes, so no sample link is shown.
   *
   * Full-page only: `db-panels.lean.ts` stands in for it in the embedded
   * widget, which shows the statement and leaves diagnosis to the viewer.
   */
  import { readPlan } from 'autotel-db';
  import { repeatedStatementCounts } from '../utils/queries';
  import PlanDiagnosis from './PlanDiagnosis.svelte';
  import type { SpanData, TraceData } from '../types';

  interface Props {
    span: SpanData;
    trace: TraceData;
  }
  let { span, trace }: Props = $props();

  const attributes = $derived(span.attributes || {});
  const read = $derived(readPlan(attributes));
  const repeatsInTrace = $derived(
    repeatedStatementCounts(trace).get(span.spanId),
  );
  const system = $derived(
    String(attributes['db.system.name'] ?? attributes['db.system'] ?? ''),
  );
  const operation = $derived(
    String(
      attributes['db.operation.name'] ?? attributes['db.operation'] ?? '',
    ) || undefined,
  );
</script>

{#if repeatsInTrace}
  <p class="mt-2 text-[11px] text-warning">
    Repeated ×{repeatsInTrace} in this trace: possible N+1. A loop issuing one query
    per item looks like this; so does a deliberate retry or batch.
  </p>
{/if}

<div class="mt-3">
  <PlanDiagnosis
    plan={read?.status === 'captured' ? read : undefined}
    issue={read && read.status !== 'captured' ? read : undefined}
    system={system || undefined}
    scope={span.scope?.name}
    {operation}
    compact
  />
</div>
