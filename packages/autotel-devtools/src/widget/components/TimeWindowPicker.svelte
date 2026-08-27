<script lang="ts">
  /**
   * The global time-window control.
   *
   * One control for every tab. Presets are stored as intents rather than
   * timestamps (see `timeWindow.ts`), so "Last 15m" keeps tracking now instead
   * of freezing at the moment it was clicked.
   *
   * The custom range takes two `datetime-local` inputs rather than a parsed
   * natural-language box: the native control is keyboard accessible, localised
   * and understood by every user for free, which a bespoke parser is not.
   */
  import { Popover } from 'bits-ui';
  import { Clock, Check } from '@lucide/svelte';
  import {
    PRESETS,
    windowLabel,
    type WindowSelection,
    type PresetId,
  } from '../timeWindow';
  import { cn } from '../utils/cn';
  import { zoneLabel } from '../timeFormat';
  import { timeZoneSignal } from '../store.svelte';

  interface Props {
    selection: WindowSelection;
    onChange: (selection: WindowSelection) => void;
    class?: string;
  }
  let { selection, onChange, class: className }: Props = $props();

  let open = $state(false);

  // Seed the custom fields from the current selection so switching to the
  // Custom tab starts from what is on screen rather than from empty boxes.
  const seed = $derived(
    selection.type === 'custom'
      ? { start: selection.start, end: selection.end }
      : { start: Date.now() - 15 * 60_000, end: Date.now() },
  );
  let customStart = $state('');
  let customEnd = $state('');

  function openChanged(next: boolean) {
    open = next;
    if (next) {
      customStart = toLocalInput(seed.start);
      customEnd = toLocalInput(seed.end);
    }
  }

  function choosePreset(preset: PresetId) {
    onChange({ type: 'preset', preset });
    open = false;
  }

  function applyCustom() {
    const start = fromLocalInput(customStart);
    const end = fromLocalInput(customEnd);
    // Refuse silently-wrong input rather than applying a window nobody asked
    // for: an unparseable date should leave the current window alone.
    if (start === null || end === null) return;
    onChange({ type: 'custom', start, end });
    open = false;
  }

  const customValid = $derived(
    fromLocalInput(customStart) !== null && fromLocalInput(customEnd) !== null,
  );

  /** Epoch ms → the `YYYY-MM-DDTHH:mm` shape `datetime-local` requires. */
  function toLocalInput(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function fromLocalInput(value: string): number | null {
    if (!value) return null;
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
</script>

<Popover.Root bind:open onOpenChange={openChanged}>
  <Popover.Trigger
    aria-label="Time window"
    title="Change the time window"
    class={cn(
      'inline-flex items-center gap-1.5 px-2 py-1 text-xs rounded border',
      'border-line bg-surface text-fg-muted hover:text-fg hover:bg-hover',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      className,
    )}
  >
    <Clock size={12} />
    {windowLabel(selection)}
  </Popover.Trigger>

  <Popover.Portal>
    <Popover.Content
      sideOffset={6}
      align="start"
      class="z-50 w-64 rounded-md border border-line bg-surface p-1 shadow-lg"
    >
      <div role="group" aria-label="Presets">
        {#each PRESETS as preset (preset.id)}
          {@const active =
            selection.type === 'preset' && selection.preset === preset.id}
          <button
            type="button"
            onclick={() => choosePreset(preset.id)}
            aria-current={active ? 'true' : undefined}
            class={cn(
              'flex w-full items-center justify-between rounded px-2 py-1.5 text-xs',
              'text-fg hover:bg-hover focus-visible:outline-none focus-visible:bg-hover',
              active && 'bg-selected font-medium',
            )}
          >
            {preset.label}
            {#if active}<Check size={12} class="text-accent" />{/if}
          </button>
        {/each}
      </div>

      <div class="mt-1 border-t border-line pt-2 px-2 pb-1">
        <div class="text-[11px] uppercase tracking-wide text-fg-subtle mb-1.5">
          Custom range
        </div>
        <label class="block text-[11px] text-fg-muted mb-1">
          From
          <input
            type="datetime-local"
            bind:value={customStart}
            class="mt-0.5 w-full rounded border border-line bg-subtle px-1.5 py-1 text-xs text-fg focus:outline-none focus:border-accent"
          />
        </label>
        <label class="block text-[11px] text-fg-muted mb-2">
          To
          <input
            type="datetime-local"
            bind:value={customEnd}
            class="mt-0.5 w-full rounded border border-line bg-subtle px-1.5 py-1 text-xs text-fg focus:outline-none focus:border-accent"
          />
        </label>
        <!--
          Local against UTC, in the popover that already owns time. Two options
          rather than a zone picker: the question people actually have is
          "is this my clock or the log's", and a searchable list of 400 zones
          is a lot of UI for the rest.
        -->
        <div class="mb-2 border-t border-line pt-2">
          <div class="mb-1 text-[11px] text-fg-muted">Show times in</div>
          <div class="flex gap-1">
            {#each [{ id: 'local', label: 'Local' }, { id: 'utc', label: 'UTC' }] as const as zone (zone.id)}
              <button
                type="button"
                aria-pressed={timeZoneSignal.value === zone.id}
                onclick={() => (timeZoneSignal.value = zone.id)}
                class={cn(
                  'flex-1 rounded px-2 py-1 text-xs',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  timeZoneSignal.value === zone.id
                    ? 'bg-accent text-white'
                    : 'border border-line text-fg-muted hover:text-fg',
                )}
              >
                {zone.label}
              </button>
            {/each}
          </div>
          <div class="mt-1 text-[11px] text-fg-subtle">
            Currently {zoneLabel(timeZoneSignal.value)}
          </div>
        </div>
        <button
          type="button"
          onclick={applyCustom}
          disabled={!customValid}
          class={cn(
            'w-full rounded px-2 py-1 text-xs font-medium',
            'bg-accent text-white hover:opacity-90',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          )}
        >
          Apply
        </button>
      </div>
    </Popover.Content>
  </Popover.Portal>
</Popover.Root>
