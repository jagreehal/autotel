<script lang="ts">
  import { X } from '@lucide/svelte';
  import { isMac } from '../utils/keyboard';
  import type { Shortcut } from '../shortcuts';

  interface Props {
    shortcuts: Shortcut[];
    onClose: () => void;
  }
  let { shortcuts, onClose }: Props = $props();

  let modalEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    // Listen both on the modal (for when it's focused) and window (as fallback)
    const el = modalEl;
    if (el) {
      el.addEventListener('keydown', handleKeydown);
      el.focus();
    }
    window.addEventListener('keydown', handleKeydown);
    return () => {
      if (el) el.removeEventListener('keydown', handleKeydown);
      window.removeEventListener('keydown', handleKeydown);
    };
  });
</script>

<div
  class="fixed inset-0 z-[1000] flex items-center justify-center"
  role="dialog"
  aria-modal="true"
  aria-label="Keyboard shortcuts"
>
  <!-- Backdrop — a real <button> so it's natively click + keyboard dismissable
       (Escape is also handled on mount). -->
  <button
    type="button"
    aria-label="Close"
    class="absolute inset-0 bg-black/55 backdrop-blur-[2px] at-backdrop-in"
    onclick={onClose}
  ></button>
  <div
    bind:this={modalEl}
    tabindex="-1"
    class="at-modal-in relative z-[1] bg-surface border border-line rounded-lg shadow-xl w-[480px] max-w-[90vw] max-h-[80vh] flex flex-col overflow-hidden outline-none"
  >
    <div
      class="flex items-center justify-between px-4 py-3 border-b border-line bg-subtle flex-shrink-0"
    >
      <span class="text-sm font-semibold text-fg"> Keyboard Shortcuts </span>
      <button
        onclick={onClose}
        class="inline-flex items-center justify-center w-7 h-7 p-0 bg-transparent border border-line rounded cursor-pointer text-sm text-fg-subtle hover:bg-red-50 hover:border-red-300 hover:text-red-600 transition-colors"
        title="Close (Esc)"
      >
        <X size={14} />
      </button>
    </div>
    <div class="overflow-y-auto py-2">
      <table class="w-full border-collapse">
        <tbody>
          {#each shortcuts as shortcut, i (i)}
            <tr class="border-b border-line-subtle last:border-b-0">
              <td class="py-2.5 px-4 whitespace-nowrap align-middle w-[1%]">
                {#each shortcut.keys as key, j (j)}
                  <kbd
                    class="inline-block px-1.5 py-0.5 font-mono text-xs font-semibold bg-hover border border-line rounded text-fg mr-1 last:mr-0 shadow-[0_1px_0_#d4d4d8]"
                  >
                    {key === 'CmdOrCtrl'
                      ? isMac
                        ? '⌘'
                        : 'Ctrl'
                      : key === 'AltOrOpt'
                        ? isMac
                          ? '⌥'
                          : 'Alt'
                        : key}
                  </kbd>
                {/each}
              </td>
              <td class="py-2.5 pr-4 pl-1 text-sm text-fg-muted align-middle">
                {shortcut.description}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</div>
