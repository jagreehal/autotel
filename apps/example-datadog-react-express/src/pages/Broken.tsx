type Statement = { lines: Array<{ amount: number }> };

/** Renders a statement the API returned without lines: a render-time crash. */
export function Broken() {
  const statement: Statement = JSON.parse('{}');
  const total = statement.lines.reduce((sum, line) => sum + line.amount, 0);
  return <p>Total: {total}</p>;
}
