<script lang="ts">
  /**
   * The query input.
   *
   * Validation runs in the browser against the same parser the server compiles
   * with, so a syntax error is reported on the keystroke that caused it rather
   * than after a round trip. The server still parses what it receives — this is
   * a faster mirror of that check, never a replacement for it.
   *
   * Errors are shown but never block: the last valid query stays applied while
   * you are mid-edit, because clearing the results on every half-typed
   * expression makes the bar unusable.
   */
  import { Search, X, CircleAlert } from '@lucide/svelte';
  import { parse } from '../../query/parse';
  import type { QueryError } from '../../query/ast';
  import { cn } from '../utils/cn';

  interface Props {
    value: string;
    /** Called with the text on every change — validity is reported separately. */
    onInput: (value: string) => void;
    /** Called only when the text parses, i.e. when it is worth running. */
    onSubmit: (value: string) => void;
    placeholder?: string;
    /** Errors from the server, shown when the client-side parse found none. */
    serverErrors?: QueryError[];
    /** Known columns and observed attribute keys for completion. */
    fields?: string[];
    class?: string;
    ref?: HTMLInputElement | null;
  }
  let {
    value,
    onInput,
    onSubmit,
    placeholder = 'Filter — e.g. service = api AND duration > 100',
    serverErrors,
    fields = [],
    class: className,
    ref = $bindable(null),
  }: Props = $props();

  const parsed = $derived(parse(value));
  const clientErrors = $derived(parsed.ok ? [] : parsed.errors);
  // Prefer the local errors: they are the same grammar and arrive sooner. Server
  // errors only surface for things the client parse accepts.
  const errors = $derived(
    clientErrors.length > 0 ? clientErrors : (serverErrors ?? []),
  );
  const invalid = $derived(errors.length > 0 && value.trim().length > 0);
  let focused = $state(false);
  const completion = $derived.by(() => {
    const match = value.match(/(?:^|[\s(])([A-Za-z_][\w.-]*)$/);
    const prefix = match?.[1]?.toLowerCase() ?? '';
    if (value.trim().length > 0 && !match) return [];
    return fields
      .filter((field) => field.toLowerCase().startsWith(prefix))
      .filter((field) => field.toLowerCase() !== prefix)
      .slice(0, 8);
  });

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !invalid) {
      event.preventDefault();
      onSubmit(value);
    }
    if (event.key === 'Escape' && value) {
      event.preventDefault();
      onInput('');
      onSubmit('');
    }
  }

  function clear() {
    onInput('');
    onSubmit('');
    ref?.focus();
  }

  function complete(field: string) {
    const match = value.match(/(?:^|[\s(])([A-Za-z_][\w.-]*)$/);
    const start = match?.[1] ? value.length - match[1].length : value.length;
    onInput(`${value.slice(0, start)}${field} = `);
    ref?.focus();
  }
</script>

<div class={cn('relative', className)}>
  <Search
    size={12}
    class="absolute left-2 top-[9px] text-fg-subtle pointer-events-none"
  />
  <input
    bind:this={ref}
    {value}
    {placeholder}
    oninput={(event) => onInput(event.currentTarget.value)}
    onkeydown={handleKeydown}
    spellcheck="false"
    autocomplete="off"
    autocapitalize="off"
    aria-label="Query"
    aria-invalid={invalid ? 'true' : undefined}
    aria-describedby={invalid ? 'query-error' : undefined}
    onfocus={() => (focused = true)}
    onblur={() => (focused = false)}
    class={cn(
      'w-full pl-7 pr-7 py-1.5 text-xs font-mono rounded border bg-surface text-fg',
      'focus:outline-none focus:ring-1',
      invalid
        ? 'border-danger-border focus:ring-danger'
        : 'border-line focus:ring-accent',
    )}
  />
  {#if value}
    <button
      type="button"
      onclick={clear}
      title="Clear query"
      aria-label="Clear query"
      class="absolute right-1.5 top-[7px] p-0.5 text-fg-subtle hover:text-fg-muted"
    >
      <X size={12} />
    </button>
  {/if}

  {#if focused && completion.length > 0}
    <div
      role="listbox"
      aria-label="Query fields"
      class="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-auto rounded border border-line bg-surface shadow-lg"
    >
      {#each completion as field (field)}
        <button
          type="button"
          role="option"
          aria-selected="false"
          onmousedown={(event) => event.preventDefault()}
          onclick={() => complete(field)}
          class="block w-full px-2 py-1.5 text-left font-mono text-xs text-fg hover:bg-hover"
        >
          {field}
        </button>
      {/each}
    </div>
  {/if}

  {#if invalid}
    <div
      id="query-error"
      role="status"
      class="mt-1 flex items-start gap-1.5 text-[11px] text-danger"
    >
      <CircleAlert size={12} class="mt-px shrink-0" />
      <span>
        {errors[0].message}
        <span class="text-fg-subtle">(column {errors[0].range.from + 1})</span>
      </span>
    </div>
  {/if}
</div>
