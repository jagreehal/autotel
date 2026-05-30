/**
 * Keyboard-shortcut definitions, shared between the views that handle the keys
 * and the single help modal that documents them. Centralised so the `?` help
 * has exactly one source of truth (and one rendered modal).
 */

export interface Shortcut {
  keys: string[];
  description: string;
}

export const GLOBAL_SHORTCUTS: Shortcut[] = [
  { keys: ['1-6'], description: 'Switch between tabs (Traces through Errors)' },
  { keys: ['?'], description: 'Show/hide this shortcuts help' },
  { keys: ['Esc'], description: 'Close shortcuts help / go back from trace detail' },
  { keys: ['/'], description: 'Focus search filter' },
];

export const TRACE_LIST_SHORTCUTS: Shortcut[] = [
  { keys: ['/'], description: 'Focus search filter' },
  { keys: ['Esc'], description: 'Clear selection / clear search' },
  { keys: ['CmdOrCtrl', 'A'], description: 'Select all traces' },
  { keys: ['?'], description: 'Show/hide keyboard shortcuts' },
];

export const TRACE_DETAIL_SHORTCUTS: Shortcut[] = [
  { keys: ['Esc'], description: 'Go back to trace list / close span detail' },
  { keys: ['w'], description: 'Switch to waterfall view' },
  { keys: ['f'], description: 'Switch to flame graph view' },
  { keys: ['l'], description: 'Switch to list view' },
  { keys: ['↑', '↓', 'Enter'], description: 'Navigate spans / select in waterfall' },
  { keys: ['e', 'Shift+E'], description: 'Next / previous error span' },
  { keys: ['/', 'n', 'Shift+N'], description: 'Search spans / next / prev match' },
  { keys: ['?'], description: 'Show/hide keyboard shortcuts' },
];
