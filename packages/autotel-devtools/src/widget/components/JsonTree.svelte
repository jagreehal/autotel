<script lang="ts">
  import JsonNode from './JsonNode.svelte';

  /** Collapsible JSON tree for object/array attribute values. Theme-token styled. */

  interface Props {
    data: unknown;
  }
  let { data }: Props = $props();
</script>

<div class="font-mono text-xs text-fg">
  <JsonNode value={data} depth={0} />
</div>
