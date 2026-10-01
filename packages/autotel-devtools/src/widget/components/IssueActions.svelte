<script lang="ts">
  // Status and hand-off for one issue: resolve / ignore / reopen, send it to a
  // destination now, and the runs that already sent it.
  import type { Destination, IssueStatus } from '../../issues';
  import {
    fetchIssueRuns,
    sendIssue,
    setIssueStatus,
    type IssueRunSummary,
  } from '../issues-client';

  interface Props {
    fingerprint: string;
    status: IssueStatus;
    destinations: Destination[];
    onStatusChange: (status: IssueStatus) => void;
  }

  let { fingerprint, status, destinations, onStatusChange }: Props = $props();

  let runs = $state<IssueRunSummary[]>([]);
  let destinationId = $state('');
  let sending = $state(false);
  let message = $state('');

  $effect(() => {
    void fetchIssueRuns(fingerprint).then((r) => (runs = r));
  });

  async function changeStatus(next: IssueStatus) {
    if (await setIssueStatus(fingerprint, next)) onStatusChange(next);
    else message = 'Could not update status';
  }

  async function send() {
    if (!destinationId) return;
    sending = true;
    const result = await sendIssue(fingerprint, destinationId);
    sending = false;
    message = result?.run?.status === 'succeeded' ? 'Sent' : 'Send failed';
    runs = await fetchIssueRuns(fingerprint);
  }

  const nameOf = (id: string) =>
    destinations.find((d) => d.id === id)?.name ?? id;
</script>

<div class="space-y-2" data-testid="issue-actions">
  <div class="flex flex-wrap items-center gap-2 text-xs">
    {#if status === 'active'}
      <button
        class="px-2 py-1 rounded border border-line hover:bg-hover text-fg"
        onclick={() => changeStatus('resolved')}>Resolve</button
      >
      <button
        class="px-2 py-1 rounded border border-line hover:bg-hover text-fg-muted"
        onclick={() => changeStatus('ignored')}>Ignore</button
      >
    {:else}
      <button
        class="px-2 py-1 rounded border border-line hover:bg-hover text-fg"
        onclick={() => changeStatus('active')}>Reopen</button
      >
    {/if}

    {#if destinations.length > 0}
      <select
        aria-label="Send to destination"
        class="border border-line rounded px-2 py-1 bg-surface text-fg-muted"
        bind:value={destinationId}
      >
        <option value="">Send to…</option>
        {#each destinations as destination (destination.id)}
          <option value={destination.id}>{destination.name}</option>
        {/each}
      </select>
      <button
        class="px-2 py-1 rounded border border-line hover:bg-hover text-fg disabled:opacity-50"
        disabled={!destinationId || sending}
        onclick={send}>{sending ? 'Sending…' : 'Send'}</button
      >
    {/if}
    {#if message}<span class="text-fg-subtle">{message}</span>{/if}
  </div>

  {#if runs.length > 0}
    <div class="text-xs text-fg-subtle space-y-0.5">
      {#each runs.slice(0, 5) as run (run.id)}
        <div>
          {new Date(run.createdAt).toLocaleString()} · {run.trigger} →
          {nameOf(run.destinationId)} ·
          <span class={run.status === 'failed' ? 'text-danger' : ''}
            >{run.status}</span
          >{run.error ? ` (${run.error})` : ''}
        </div>
      {/each}
    </div>
  {/if}
</div>
