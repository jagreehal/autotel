import type { SpanFilterState } from './filters';

export type ViewMode =
  | 'trace'
  | 'span'
  | 'log'
  | 'service-summary'
  | 'errors'
  | 'topology'
  | 'ai';

export interface DashboardState {
  viewMode: ViewMode;
  paused: boolean;
  recording: boolean;
  spanFilters: SpanFilterState;
}

export type KeyAction =
  | { type: 'toggleViewMode'; viewMode: ViewMode }
  | { type: 'setPaused'; paused: boolean }
  | { type: 'setRecording'; recording: boolean }
  | { type: 'setSpanFilters'; spanFilters: SpanFilterState }
  | { type: 'clearBuffers' };

export interface HandleKeyResult {
  next: DashboardState;
  actions: KeyAction[];
}

const emptyFilters = { statusGroup: 'all' } as const satisfies SpanFilterState;

export function handleKey(
  state: DashboardState,
  input: string,
): HandleKeyResult {
  const actions: KeyAction[] = [];
  let next: DashboardState = state;

  if (input === 't') {
    const viewMode = state.viewMode === 'trace' ? 'span' : 'trace';
    next = { ...state, viewMode };
    actions.push({ type: 'toggleViewMode', viewMode });
    return { next, actions };
  }

  if (input === 'l') {
    const viewMode = state.viewMode === 'log' ? 'trace' : 'log';
    next = { ...state, viewMode };
    actions.push({ type: 'toggleViewMode', viewMode });
    return { next, actions };
  }

  if (input === 'v') {
    const viewMode =
      state.viewMode === 'service-summary' ? 'trace' : 'service-summary';
    next = { ...state, viewMode };
    actions.push({ type: 'toggleViewMode', viewMode });
    return { next, actions };
  }

  if (input === 'E') {
    const viewMode = state.viewMode === 'errors' ? 'trace' : 'errors';
    next = { ...state, viewMode };
    actions.push({ type: 'toggleViewMode', viewMode });
    return { next, actions };
  }

  if (input === 'G') {
    const viewMode = state.viewMode === 'topology' ? 'trace' : 'topology';
    next = { ...state, viewMode };
    actions.push({ type: 'toggleViewMode', viewMode });
    return { next, actions };
  }

  if (input === 'a') {
    const viewMode = state.viewMode === 'ai' ? 'trace' : 'ai';
    next = { ...state, viewMode };
    actions.push({ type: 'toggleViewMode', viewMode });
    return { next, actions };
  }

  if (input === 'x') {
    next = { ...state, spanFilters: emptyFilters };
    actions.push({ type: 'setSpanFilters', spanFilters: emptyFilters });
    return { next, actions };
  }

  if (input === 'H') {
    const cur = state.spanFilters.statusGroup ?? 'all';
    const statusGroup: Exclude<SpanFilterState['statusGroup'], undefined> =
      cur === 'all'
        ? '2xx'
        : cur === '2xx'
          ? '4xx'
          : cur === '4xx'
            ? '5xx'
            : 'all';
    const spanFilters: SpanFilterState = { ...state.spanFilters, statusGroup };
    next = { ...state, spanFilters };
    actions.push({ type: 'setSpanFilters', spanFilters });
    return { next, actions };
  }

  if (input === 'r') {
    // Record snapshot implies clearing buffers and unpausing.
    next = {
      ...state,
      recording: true,
      paused: false,
      spanFilters: emptyFilters,
    };
    actions.push(
      { type: 'clearBuffers' },
      { type: 'setSpanFilters', spanFilters: emptyFilters },
      { type: 'setPaused', paused: false },
      { type: 'setRecording', recording: true },
    );
    return { next, actions };
  }

  return { next, actions };
}
