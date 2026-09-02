export type DiffLine = { type: "same" | "minus" | "plus"; text: string; line: number };

export type FileDiff = {
  lines: DiffLine[];
  added: number;
  removed: number;
  /** 1-based lines in the *current buffer* a proposal would rewrite. */
  changedLines: number[];
  firstChange: number | null;
};

/**
 * The agent may only rewrite values, so a proposal differs from the file in a
 * few short runs. Trimming the common head and tail shows exactly those runs and
 * never invents a move the way a full LCS diff is free to.
 */
export function diffFile(before: string, after: string): FileDiff {
  const a = before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail += 1;
  }

  const lines: DiffLine[] = [];
  for (let i = 0; i < head; i += 1) lines.push({ type: "same", text: a[i], line: i + 1 });
  const changedLines: number[] = [];
  for (let i = head; i < a.length - tail; i += 1) {
    lines.push({ type: "minus", text: a[i], line: i + 1 });
    changedLines.push(i + 1);
  }
  for (let i = head; i < b.length - tail; i += 1) lines.push({ type: "plus", text: b[i], line: i + 1 });
  for (let i = a.length - tail; i < a.length; i += 1) lines.push({ type: "same", text: a[i], line: i + 1 });

  return {
    lines,
    added: b.length - tail - head,
    removed: a.length - tail - head,
    changedLines,
    firstChange: changedLines[0] ?? (head < b.length ? head + 1 : null),
  };
}