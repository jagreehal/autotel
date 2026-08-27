/**
 * Tree-connector metadata for the waterfall gutter.
 *
 * A waterfall indents children to show nesting, but indentation alone stops
 * being readable past two or three levels: with a deep trace you cannot tell
 * which parent a span belongs to, only that it is "further right than the
 * thing above it". Connector lines answer that — an L or T joining each span to
 * its parent, and a vertical line continued through every ancestor that still
 * has siblings below.
 *
 * Kept as data rather than drawn inline so the rule that is easy to get wrong —
 * *which* ancestor levels continue past a given row — is testable without
 * rendering anything. The classic bug is drawing a vertical line under an
 * ancestor's last child, which implies a sibling that does not exist.
 */

export interface TreeNodeLike<T> {
  children: T[];
}

/** What to draw at each level of one row's gutter. */
export interface TreeConnectors {
  /**
   * One entry per ancestor level, outermost first. `true` means that ancestor
   * has siblings still to come, so its vertical line passes through this row.
   */
  ancestorLines: boolean[];
  /** Whether this node is its parent's last child — an elbow rather than a tee. */
  isLast: boolean;
  /** Depth from the root. Root nodes are 0 and have no connector. */
  depth: number;
}

/**
 * Flatten a tree depth-first, annotating each node with its connectors.
 *
 * `isCollapsed` lets a collapsed node keep its own row while its subtree is
 * skipped — the connectors are computed from the *visible* shape, so a
 * collapsed branch does not leave a line running to nothing.
 */
export function flattenWithConnectors<T extends TreeNodeLike<T>>(
  roots: T[],
  isCollapsed: (node: T) => boolean = () => false,
): Array<{ node: T; connectors: TreeConnectors }> {
  const out: Array<{ node: T; connectors: TreeConnectors }> = [];

  const walk = (nodes: T[], ancestorLines: boolean[], depth: number): void => {
    nodes.forEach((node, index) => {
      const isLast = index === nodes.length - 1;
      out.push({
        node,
        connectors: { ancestorLines: [...ancestorLines], isLast, depth },
      });

      if (isCollapsed(node) || node.children.length === 0) return;
      // The line under *this* node continues only if it has siblings still to
      // come. Pushing `true` for a last child would draw a vertical stub
      // implying a sibling that does not exist.
      walk(node.children, [...ancestorLines, !isLast], depth + 1);
    });
  };

  walk(roots, [], 0);
  return out;
}
