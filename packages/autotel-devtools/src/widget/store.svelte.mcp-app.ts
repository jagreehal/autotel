// The two store signals the waterfall reads, for the MCP App build (swapped in
// by `vite.widget.config.ts`). The full store pulls in every view's state,
// which a chat view that draws one trace never uses.
import { signal } from './signals.svelte';
import type { Shortcut } from './shortcuts';
import type { TimeZonePreference } from './timeFormat';
import type {
  helpShortcutsSignal as HelpShortcutsSignal,
  timeZoneSignal as TimeZoneSignal,
} from './store.svelte';

export const helpShortcutsSignal: typeof HelpShortcutsSignal = signal<
  Shortcut[] | null
>(null);
export const timeZoneSignal: typeof TimeZoneSignal =
  signal<TimeZonePreference>('local');
