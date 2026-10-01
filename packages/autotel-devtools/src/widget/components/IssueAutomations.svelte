<script lang="ts">
  // Destinations and automations: where issues go, and when they go there.
  import type { Automation, Destination } from '../../issues';
  import {
    deleteAutomation,
    deleteDestination,
    saveAutomation,
    saveDestination,
  } from '../issues-client';

  interface Props {
    destinations: Destination[];
    automations: Automation[];
    onChange: () => void;
  }

  let { destinations, automations, onChange }: Props = $props();

  // One field list per type: the form asks only for what that type needs.
  const FIELDS: Record<Destination['type'], Array<[string, string]>> = {
    webhook: [
      ['url', 'HTTPS URL'],
      ['secret', 'Signing secret (optional)'],
    ],
    'claude-code': [
      ['routineId', 'Routine ID'],
      ['token', 'Token'],
    ],
    cursor: [
      ['url', 'Automation webhook URL'],
      ['authorization', 'Authorization header (optional)'],
    ],
    devin: [
      ['orgId', 'Organization ID'],
      ['token', 'Token'],
      ['playbookId', 'Playbook ID (optional)'],
    ],
    slack: [['url', 'Incoming webhook URL']],
    pagerduty: [['routingKey', 'Routing key']],
  };
  const LABELS: Record<Destination['type'], string> = {
    webhook: 'Webhook',
    'claude-code': 'Claude Code',
    cursor: 'Cursor',
    devin: 'Devin',
    slack: 'Slack',
    pagerduty: 'PagerDuty',
  };

  let type = $state<Destination['type']>('claude-code');
  let name = $state('');
  let values = $state<Record<string, string>>({});
  let triggerType = $state<'threshold' | 'recurrence'>('threshold');
  let triggerValue = $state(5);
  let automationDestination = $state('');
  let error = $state('');

  async function addDestination() {
    const fields = Object.fromEntries(
      Object.entries(values).filter(
        ([key, value]) =>
          FIELDS[type].some(([k]) => k === key) && value.trim() !== '',
      ),
    );
    const saved = await saveDestination({
      type,
      name: name || LABELS[type],
      ...fields,
    } as Destination);
    if (!saved) {
      error = 'Destination rejected: check the required fields';
      return;
    }
    error = '';
    name = '';
    values = {};
    onChange();
  }

  async function addAutomation() {
    const trigger =
      triggerType === 'threshold'
        ? { type: 'threshold' as const, count: triggerValue }
        : { type: 'recurrence' as const, inactiveMs: triggerValue * 3_600_000 };
    const saved = await saveAutomation({
      name: `${triggerType} ${triggerValue}`,
      trigger,
      destinationId: automationDestination,
    });
    error = saved ? '' : 'Automation rejected';
    if (saved) onChange();
  }

  async function remove(kind: 'destination' | 'automation', id: string) {
    const ok =
      kind === 'destination'
        ? await deleteDestination(id)
        : await deleteAutomation(id);
    error = ok ? '' : `Could not delete ${kind}`;
    if (ok) onChange();
  }

  const describe = (a: Automation) =>
    a.trigger.type === 'threshold'
      ? `after ${a.trigger.count} occurrences`
      : `on return after ${a.trigger.inactiveMs / 3_600_000}h quiet`;
</script>

<div class="space-y-3 text-xs" data-testid="issue-automations">
  <section class="space-y-1">
    <h5 class="font-semibold text-fg-muted">Destinations</h5>
    {#each destinations as destination (destination.id)}
      <div class="flex items-center gap-2">
        <span class="text-fg">{destination.name}</span>
        <span class="text-fg-subtle">{LABELS[destination.type]}</span>
        <button
          class="ml-auto text-fg-subtle hover:text-danger"
          onclick={() => remove('destination', destination.id)}>Remove</button
        >
      </div>
    {/each}
    <div class="flex flex-wrap gap-1 items-center">
      <select
        aria-label="Destination type"
        class="border border-line rounded px-1 py-0.5 bg-surface"
        bind:value={type}
      >
        {#each Object.entries(LABELS) as [value, label] (value)}
          <option {value}>{label}</option>
        {/each}
      </select>
      <input
        aria-label="Destination name"
        class="border border-line rounded px-1 py-0.5 bg-surface"
        placeholder="Name"
        bind:value={name}
      />
      {#each FIELDS[type] as [key, label] (key)}
        <input
          aria-label={label}
          class="border border-line rounded px-1 py-0.5 bg-surface"
          placeholder={label}
          type={/token|secret|authorization|routingKey/i.test(key)
            ? 'password'
            : 'text'}
          value={values[key] ?? ''}
          oninput={(e) =>
            (values = {
              ...values,
              [key]: (e.target as HTMLInputElement).value,
            })}
        />
      {/each}
      <button
        class="px-2 py-0.5 rounded border border-line hover:bg-hover"
        onclick={addDestination}>Add destination</button
      >
    </div>
  </section>

  <section class="space-y-1">
    <h5 class="font-semibold text-fg-muted">Automations</h5>
    {#each automations as automation (automation.id)}
      <div class="flex items-center gap-2">
        <span class="text-fg">{describe(automation)}</span>
        <span class="text-fg-subtle"
          >→ {destinations.find((d) => d.id === automation.destinationId)
            ?.name ?? automation.destinationId}</span
        >
        <button
          class="ml-auto text-fg-subtle hover:text-danger"
          onclick={() => remove('automation', automation.id)}>Remove</button
        >
      </div>
    {/each}
    {#if destinations.length > 0}
      <div class="flex flex-wrap gap-1 items-center">
        <select
          aria-label="Trigger"
          class="border border-line rounded px-1 py-0.5 bg-surface"
          bind:value={triggerType}
        >
          <option value="threshold">After N occurrences</option>
          <option value="recurrence">Returns after N hours quiet</option>
        </select>
        <input
          aria-label="Trigger value"
          type="number"
          min="1"
          class="w-16 border border-line rounded px-1 py-0.5 bg-surface"
          bind:value={triggerValue}
        />
        <select
          aria-label="Automation destination"
          class="border border-line rounded px-1 py-0.5 bg-surface"
          bind:value={automationDestination}
        >
          <option value="">Destination…</option>
          {#each destinations as destination (destination.id)}
            <option value={destination.id}>{destination.name}</option>
          {/each}
        </select>
        <button
          class="px-2 py-0.5 rounded border border-line hover:bg-hover disabled:opacity-50"
          disabled={!automationDestination}
          onclick={addAutomation}>Add automation</button
        >
      </div>
    {/if}
  </section>
  {#if error}<p class="text-danger">{error}</p>{/if}
</div>
