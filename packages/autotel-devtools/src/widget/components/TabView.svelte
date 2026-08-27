<script lang="ts">
  /**
   * Single source of truth for tab → view dispatch, shared by both surfaces
   * (the full-page Layout and the embedded Panel).
   *
   * The mapping lives in `views/registry.ts` rather than in a `{#if}` chain
   * here, so the embedded build can alias in a smaller set without this
   * component knowing which build it is in. An id with no view falls back to
   * Traces — which is also what an unknown id gets, so a stale URL cannot
   * render blank.
   */
  import { selectedTabSignal } from '../store.svelte';
  import { VIEWS } from '../views/registry';

  const selected = $derived(selectedTabSignal.value);
  const View = $derived(VIEWS[selected] ?? VIEWS.traces);
</script>

{#if View}
  <View />
{/if}
