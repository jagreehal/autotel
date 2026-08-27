/**
 * @vitest-environment jsdom
 *
 * Tree-connector contract.
 *
 * The rule worth pinning: a vertical line is drawn through a row for an
 * ancestor **only while that ancestor still has siblings below**. Drawing one
 * under a last child implies a sibling that does not exist, which is the single
 * most common tree-gutter bug and is invisible until a trace nests deeply
 * enough for someone to be relying on the lines.
 */

import { describe, it, expect } from 'vitest';
import { flattenWithConnectors } from '../utils/treeConnectors';

interface Node {
  id: string;
  children: Node[];
}

const node = (id: string, children: Node[] = []): Node => ({ id, children });

/** Flatten and label each row `id:depth:isLast:ancestorLines`. */
function shape(roots: Node[], collapsed: string[] = []) {
  return flattenWithConnectors(roots, (n) => collapsed.includes(n.id)).map(
    ({ node: n, connectors }) =>
      `${n.id}:${connectors.depth}:${connectors.isLast ? 'last' : 'mid'}:${connectors.ancestorLines
        .map((line) => (line ? '|' : ' '))
        .join('')}`,
  );
}

describe('flattenWithConnectors', () => {
  it('returns an empty list for no roots', () => {
    expect(flattenWithConnectors([])).toEqual([]);
  });

  it('walks depth-first, parent before children', () => {
    const tree = [node('a', [node('b'), node('c')]), node('d')];
    expect(shape(tree).map((row) => row.split(':')[0])).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('gives root nodes depth 0 and no ancestor lines', () => {
    const [first] = flattenWithConnectors([node('a')]);
    expect(first.connectors.depth).toBe(0);
    expect(first.connectors.ancestorLines).toEqual([]);
  });

  it('marks the final sibling as last', () => {
    // `a` is the only root, so it is itself last — which is why its children
    // carry a blank ancestor column rather than a continuing line.
    const rows = shape([node('a', [node('b'), node('c')])]);
    expect(rows).toContain('b:1:mid: ');
    expect(rows).toContain('c:1:last: ');
  });

  it('continues an ancestor line while that ancestor has siblings to come', () => {
    // a has sibling z, so a's children sit under a continuing line.
    const rows = shape([node('a', [node('b')]), node('z')]);
    expect(rows).toContain('b:1:last:|');
  });

  it('does not continue the line under a last child', () => {
    // The classic bug: `a` is the last root, so nothing follows it — a vertical
    // line beneath it would imply a sibling that does not exist.
    const rows = shape([node('z'), node('a', [node('b')])]);
    expect(rows).toContain('b:1:last: ');
  });

  it('tracks each ancestor level independently at depth', () => {
    // root1 has a sibling (line continues); child1 does not (line stops).
    const tree = [
      node('root1', [node('child1', [node('leaf')])]),
      node('root2'),
    ];
    const rows = shape(tree);
    // leaf: ancestor 0 = root1 (has sibling root2) → line;
    //       ancestor 1 = child1 (no sibling)      → blank.
    expect(rows).toContain('leaf:2:last:| ');
  });

  it('skips the subtree of a collapsed node but keeps its own row', () => {
    const rows = shape([node('a', [node('b'), node('c')])], ['a']);
    expect(rows.map((r) => r.split(':')[0])).toEqual(['a']);
  });

  it('computes connectors from the visible shape, not the full tree', () => {
    // With `a` collapsed, `z` is what follows — and `a` is not last, so its
    // (hidden) children are irrelevant to what is drawn.
    const rows = shape([node('a', [node('b')]), node('z')], ['a']);
    expect(rows).toEqual(['a:0:mid:', 'z:0:last:']);
  });

  it('handles a deep chain without losing a level', () => {
    let deep = node('n10');
    for (let i = 9; i >= 0; i--) deep = node(`n${i}`, [deep]);

    const rows = flattenWithConnectors([deep]);
    expect(rows).toHaveLength(11);
    expect(rows[10].connectors.depth).toBe(10);
    expect(rows[10].connectors.ancestorLines).toHaveLength(10);
    // A single chain has no siblings anywhere, so no line ever continues.
    expect(rows[10].connectors.ancestorLines.every((line) => !line)).toBe(true);
  });

  it('does not share the ancestor array between rows', () => {
    // Aliasing here would make one row's connectors change when a later row is
    // computed — a bug that only shows up once something mutates the array.
    const rows = flattenWithConnectors([node('a', [node('b'), node('c')])]);
    expect(rows[1].connectors.ancestorLines).not.toBe(
      rows[2].connectors.ancestorLines,
    );
  });
});
