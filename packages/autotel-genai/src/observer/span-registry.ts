/**
 * Tracks the spans currently open in a {@link createGenAiObserver} stream and
 * the parent each was started under, so the observer can:
 *
 *   - look up a parent span when a child starts, and
 *   - force-close any descendant whose terminal event never arrived because its
 *     parent ended first (an aborted tool call, a cancelled turn, a run that was
 *     interrupted). Without this, abandoned spans leak open forever.
 */

import { SpanStatusCode, type Span, type TimeInput } from '@opentelemetry/api';

interface Entry {
  span: Span;
  parentId: string | undefined;
}

export class SpanRegistry {
  private readonly entries = new Map<string, Entry>();

  /** Record an open span and the parent it was started under. */
  add(id: string, span: Span, parentId: string | undefined): void {
    this.entries.set(id, { span, parentId });
  }

  /** The open span for `id`, if any (used to parent a starting child). */
  spanFor(id: string): Span | undefined {
    return this.entries.get(id)?.span;
  }

  /** Remove and return the open span for `id`. */
  take(id: string): Span | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    this.entries.delete(id);
    return entry.span;
  }

  /**
   * Close every still-open descendant of `parentId` as ERROR — their terminal
   * event never arrived because the parent ended first. Depth-first, so the
   * deepest leaks close before their own parents.
   */
  reapDescendants(
    parentId: string,
    message: string,
    endTime?: TimeInput,
  ): void {
    // Deleting from a Map during its own for…of is well-defined; recursion only
    // removes deeper descendants (parentId === id), never an unvisited sibling.
    for (const [id, entry] of this.entries) {
      if (entry.parentId !== parentId) continue;
      this.entries.delete(id);
      this.reapDescendants(id, message, endTime);
      entry.span.setStatus({ code: SpanStatusCode.ERROR, message });
      entry.span.end(endTime);
    }
  }

  /** Count of spans still open — for tests and leak assertions. */
  get openCount(): number {
    return this.entries.size;
  }
}
