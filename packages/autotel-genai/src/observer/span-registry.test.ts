import { SpanStatusCode } from '@opentelemetry/api';
import { describe, expect, it, vi } from 'vitest';
import { SpanRegistry } from './span-registry.js';

/** Minimal span double recording the calls the registry makes. */
function fakeSpan() {
  return {
    setStatus: vi.fn(),
    end: vi.fn(),
  };
}

function spanFor(registry: SpanRegistry, id: string) {
  return registry.spanFor(id) as unknown as ReturnType<typeof fakeSpan>;
}

describe('SpanRegistry', () => {
  it('looks up and takes open spans', () => {
    const registry = new SpanRegistry();
    const span = fakeSpan();
    registry.add('a', span as never, undefined);

    expect(registry.spanFor('a')).toBe(span);
    expect(registry.openCount).toBe(1);
    expect(registry.take('a')).toBe(span);
    expect(registry.take('a')).toBeUndefined();
    expect(registry.openCount).toBe(0);
  });

  it('reaps direct children as ERROR when a parent ends', () => {
    const registry = new SpanRegistry();
    registry.add('parent', fakeSpan() as never, undefined);
    registry.add('child', fakeSpan() as never, 'parent');
    const child = spanFor(registry, 'child');

    registry.reapDescendants('parent', 'boom');

    expect(child.setStatus).toHaveBeenCalledWith({
      code: SpanStatusCode.ERROR,
      message: 'boom',
    });
    expect(child.end).toHaveBeenCalledTimes(1);
    expect(registry.spanFor('child')).toBeUndefined();
  });

  it('reaps nested descendants depth-first', () => {
    const registry = new SpanRegistry();
    registry.add('a', fakeSpan() as never, undefined);
    registry.add('b', fakeSpan() as never, 'a');
    registry.add('c', fakeSpan() as never, 'b');
    const grandchild = spanFor(registry, 'c');

    registry.reapDescendants('a', 'interrupted');

    expect(grandchild.end).toHaveBeenCalledTimes(1);
    expect(registry.openCount).toBe(1); // only 'a' itself remains
  });

  it('leaves unrelated open spans untouched', () => {
    const registry = new SpanRegistry();
    registry.add('a', fakeSpan() as never, undefined);
    registry.add('sibling', fakeSpan() as never, undefined);
    const sibling = spanFor(registry, 'sibling');

    registry.reapDescendants('a', 'x');

    expect(sibling.end).not.toHaveBeenCalled();
    expect(registry.spanFor('sibling')).toBe(sibling);
  });

  it('passes the end time through to reaped spans', () => {
    const registry = new SpanRegistry();
    registry.add('p', fakeSpan() as never, undefined);
    registry.add('c', fakeSpan() as never, 'p');
    const child = spanFor(registry, 'c');

    registry.reapDescendants('p', 'm', 1234);

    expect(child.end).toHaveBeenCalledWith(1234);
  });
});
