<script lang="ts">
  // Container: turns a raw stack-trace string into a browsable list of frames
  // with the source for whichever one you pick.
  //
  // The loader is injected rather than built here so this component never needs
  // to know the receiver's URL — and so tests and stories can hand it a fake
  // without intercepting the network.
  import StackFrameList from './StackFrameList.svelte';
  import SourcePeek from './SourcePeek.svelte';
  import { parseStackTrace, type StackFrame } from '../../server/parse-stack';
  import type { SourceWindow } from '../../server/source-file';
  import type { SourceLoader } from '../source-client';

  interface Props {
    stackTrace: string;
    loadSource: SourceLoader;
    /** Lines either side of the failing line. */
    context?: number;
  }

  let { stackTrace, loadSource, context = 4 }: Props = $props();

  const frames = $derived(parseStackTrace(stackTrace));

  let selected = $state<StackFrame | null>(null);
  let sourceWindow = $state<SourceWindow | null>(null);
  // Distinguishes "not asked yet" from "asked, and there was nothing" — only
  // the latter should explain itself.
  let hasLoaded = $state(false);

  // Sequence number, not the frame object: assigning to `selected` wraps it in
  // a `$state` proxy, so `selected !== frame` is true even for the same frame
  // and would discard every response.
  let latestRequest = 0;

  async function select(frame: StackFrame) {
    selected = frame;
    hasLoaded = false;
    const request = ++latestRequest;

    const loaded = await loadSource(frame, context);

    // Ignore a response the reader has already moved on from.
    if (request !== latestRequest) return;
    sourceWindow = loaded;
    hasLoaded = true;
  }
</script>

{#if frames.length > 0}
  <div class="flex flex-col gap-2">
    <div class="overflow-hidden rounded border border-line">
      <StackFrameList {frames} {selected} onselect={select} />
    </div>

    {#if hasLoaded}
      <div class="overflow-hidden rounded border border-line">
        <SourcePeek window={sourceWindow} />
      </div>
    {/if}
  </div>
{/if}
