<script lang="ts">
  /**
   * Minimal harness for the shadow-DOM portal contract test: one popover wired
   * exactly the way the real UI wires them — a `BitsConfig` boundary supplying
   * the shadow-root portal target, with no per-overlay `to` prop.
   */
  import { BitsConfig, Popover } from 'bits-ui';

  interface Props {
    portalTarget: HTMLElement;
  }
  let { portalTarget }: Props = $props();
</script>

<BitsConfig defaultPortalTo={portalTarget}>
  <Popover.Root>
    <Popover.Trigger data-testid="popover-trigger">Open</Popover.Trigger>
    <Popover.Portal>
      <Popover.Content data-testid="popover-content">
        <span>portalled</span>
      </Popover.Content>
    </Popover.Portal>
  </Popover.Root>
</BitsConfig>
