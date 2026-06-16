/**
 * Minimal line diff for snapshot failures. The goal is a message that points
 * at *what moved* — a renamed field, a switched date format, a dropped value —
 * not a full diff engine. Lines only in the approved file are marked `-`, lines
 * only in the actual output are marked `+`, and a little surrounding context is
 * kept so the change is readable in a terminal.
 */
export function lineDiff(approved: string, actual: string): string {
  const a = approved.split('\n');
  const b = actual.split('\n');
  const lcs = longestCommonSubsequence(a, b);

  const out: string[] = [];
  let i = 0;
  let j = 0;
  for (const [ai, bj] of lcs) {
    while (i < ai) out.push(`- ${a[i++]}`);
    while (j < bj) out.push(`+ ${b[j++]}`);
    out.push(`  ${a[i++]}`);
    j++;
  }
  while (i < a.length) out.push(`- ${a[i++]}`);
  while (j < b.length) out.push(`+ ${b[j++]}`);

  return out.join('\n');
}

/** Indices `[i, j]` of lines common to both, longest such subsequence. */
function longestCommonSubsequence(
  a: string[],
  b: string[],
): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const table: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => 0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}
