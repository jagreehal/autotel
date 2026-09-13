import type { EventName, Origin, TraceEntry } from 'claude-code';

import type { Attributes, Autotel } from '../types';
import { newId, type Exporter, type OpenSpan, type SpanContext } from './otlp';

/**
 * What the mod records, as plain values: the hooks in `register.ts` read the
 * engine's `e` and `next` into these at the boundary, and everything that
 * decides a span's name, place and attributes lives here, where a test can
 * drive it without the engine.
 */

/** One link of the chain beneath a dispatch, as `next.trace` reports it. */
export type Link = TraceEntry<EventName, unknown, unknown>;

/** A dispatch as it begins: the event, who raised it, and what it names. */
export type DispatchStart = {
  event: EventName;
  origin: Origin;
  /** On `tool.call`: the tool and the call's id (`agentId` in a subagent). */
  tool?: { name: string; useId: string; agentId?: string };
  /**
   * Opens the turn's trace when none is open: `prompt.submit`, where an
   * interaction begins, and `turn.start`, for a turn nothing submitted (a
   * resumed session's, a scheduled one's).
   */
  opensTurn?: true;
  /** On `turn.start`: the turn's id, stamped on the open turn's root. */
  turnId?: string;
};

/** A dispatch as it settles: the chain beneath, and the failure if it threw. */
export type DispatchEnd = {
  trace: readonly Link[];
  error?: string;
  /**
   * On `tool.call`: the result was `{ deny }`, so a hook answered for the
   * tool. Read off the result, not the chain: a hooks module that passes a
   * result through reports `returned` too, since results cross as copies.
   */
  denied?: boolean;
  /** On `prompt.submit`: the result was `{ drop }`; no turn will follow. */
  promptDropped?: string;
  /**
   * On `turn.complete`: how the turn ended. Closes the open turn's trace when
   * it is that turn's; a subagent's (`agentId` set) closes nothing.
   */
  turnComplete?: {
    turnId: string;
    agentId?: string;
    reason: string;
    isAborted: boolean;
    durationMs: number;
  };
};

/** What the `ToolUse` row badge shows for a call once it has settled. */
export type ToolTiming = {
  ms: number;
  /** A hook answered the call itself, rather than the tool. */
  denied: boolean;
};

export type Recorder = {
  /** Records one dispatch: returns what to call once it settles. */
  begin: (start: DispatchStart) => (end: DispatchEnd) => void;
  /** The settled timing of a tool call, once its dispatch has ended. */
  timingFor: (toolUseId: string) => ToolTiming | undefined;
  /** The `$.autotel` noun, its spans placed the way dispatches are. */
  autotel: Autotel;
  /** Posts everything queued now: a turn's end, a session's end. */
  flush: () => Promise<void>;
};

/**
 * One turn's trace: its root span stays open from `prompt.submit` (or
 * `turn.start`) to the `turn.complete` that names it. `id` is known once
 * `turn.start` has run.
 */
type Turn = {
  traceId: string;
  root: OpenSpan;
  id?: string;
};

/**
 * The `deny` a link's returned value carries, if it is one. Results cross
 * the chain as plain data; a `{ deny: reason }` is the one shape that means
 * a hook answered for the tool.
 */
function returnedDenial(returned: Link['returned']): string | undefined {
  if (Object(returned) !== returned) return undefined;
  // SAFETY: an object; `deny` is read out and checked for being a string.
  const { deny } = returned as { deny?: unknown };
  return String(deny) === deny ? String(deny) : undefined;
}

/**
 * The link that decided a denied dispatch: follow the final denial down
 * through contiguous forwarding links, and stop when the downstream result
 * changes. A logger passing a guard's denial up shares that denial with
 * every link above the guard; an outer policy that replaces a success (or
 * an overridden inner denial) beneath it is where the final denial starts.
 * Hooks bypassed by `next.to` stay in the chain as `skipped` with no
 * result — ignore them when reading the first result and when walking.
 * When the first real result is not the denial, omit the name rather than
 * guess from a deeper, overridden carrier.
 */
function decidedBy(trace: readonly Link[]): Link | undefined {
  let finalDenial: string | undefined;
  let decider: Link | undefined;
  for (const link of trace) {
    if (link.outcome === 'skipped') continue;
    const denial = returnedDenial(link.returned);
    if (finalDenial === undefined) {
      if (denial === undefined) return undefined;
      finalDenial = denial;
    } else if (denial !== finalDenial) {
      break;
    }
    if (link.plugin === 'engine') break;
    decider = link;
  }
  return decider;
}

function linkAttributes(link: Link): Attributes {
  const attributes = {
    'plugin.name': link.plugin,
    'claude_code.hook.tier': link.tier,
    'claude_code.hook.outcome': link.outcome,
    duration_ms: link.ms,
  };
  return link.reason === undefined
    ? attributes
    : { ...attributes, 'claude_code.hook.reason': link.reason };
}

/** The badge text for a settled tool call. */
export function badge(timing: ToolTiming): string {
  const ms =
    timing.ms < 1000
      ? `${Math.round(timing.ms)}ms`
      : `${(timing.ms / 1000).toFixed(2)}s`;
  return timing.denied ? ` denied by hook · ${ms}` : ` ${ms}`;
}

/** A span for callers with nothing to export to: the body still runs. */
const NO_SPAN = {
  setAttribute: () => {},
  setAttributes: () => {},
  addEvent: () => {},
};

/**
 * @param exporter where spans go; absent, the recorder is inert and
 *   `$.autotel.span` only runs its body
 */
export function createRecorder(exporter: Exporter | undefined): Recorder {
  let turn: Turn | undefined;
  const timings = new Map<string, ToolTiming>();

  function contextFor(): SpanContext {
    return turn === undefined
      ? { traceId: newId(16) }
      : { traceId: turn.traceId, parentSpanId: turn.root.spanId };
  }

  function begin(start: DispatchStart): (end: DispatchEnd) => void {
    if (exporter === undefined) return () => {};
    const live = exporter;

    // The root this dispatch opened, if it did: a prompt queued while a turn
    // runs opens nothing, and its rejection must close nothing.
    let opened: Turn | undefined;
    if (start.opensTurn && turn === undefined) {
      const traceId = newId(16);
      opened = { traceId, root: live.start('claude_code.turn', { traceId }) };
      turn = opened;
    }
    if (start.turnId !== undefined && turn !== undefined) {
      turn.id = start.turnId;
      turn.root.setAttribute('claude_code.turn.id', start.turnId);
    }

    const tool = start.tool;
    const span = live.start(`claude_code.${start.event}`, contextFor(), {
      'claude_code.event': start.event,
      'plugin.name': start.origin.plugin,
      'claude_code.tier': start.origin.tier,
    });
    if (tool !== undefined) {
      span.setAttributes({ tool_name: tool.name, tool_use_id: tool.useId });
      if (tool.agentId !== undefined)
        span.setAttribute('agent_id', tool.agentId);
    }
    const startedMs = Date.now();

    return (end) => {
      for (const link of end.trace) span.addEvent('hook', linkAttributes(link));
      const denied = end.denied === true;
      const decider = denied ? decidedBy(end.trace) : undefined;
      if (decider !== undefined)
        span.setAttribute('claude_code.decided_by', decider.plugin);
      span.end(end.error === undefined ? {} : { error: end.error });

      if (tool !== undefined)
        timings.set(tool.useId, { ms: Date.now() - startedMs, denied });

      const dropped = end.promptDropped ?? end.error;
      if (opened !== undefined && dropped !== undefined && turn === opened) {
        opened.root.setAttribute('claude_code.prompt.dropped', dropped);
        opened.root.end(end.error === undefined ? {} : { error: end.error });
        turn = undefined;
        void live.flush();
      }

      const complete = end.turnComplete;
      if (
        complete !== undefined &&
        complete.agentId === undefined &&
        turn !== undefined &&
        (turn.id === undefined || turn.id === complete.turnId)
      ) {
        turn.root.setAttributes({
          'claude_code.turn.reason': complete.reason,
          'claude_code.turn.aborted': complete.isAborted,
          duration_ms: complete.durationMs,
        });
        turn.root.end(
          complete.reason === 'error' ? { error: 'turn ended in error' } : {},
        );
        turn = undefined;
        void live.flush();
      }
    };
  }

  const autotel: Autotel = {
    span: async (name, fn, attributes) => {
      if (exporter === undefined) return fn(NO_SPAN);
      const span = exporter.start(name, contextFor(), attributes);
      try {
        const result = await fn(span);
        span.end();
        return result;
      } catch (error) {
        span.end({ error: String(error) });
        throw error;
      }
    },
  };

  return {
    begin,
    timingFor: (id) => timings.get(id),
    autotel,
    flush: () => exporter?.flush() ?? Promise.resolve(),
  };
}
