import { describe, expect, it } from "vitest";

import { diffFile } from "./lineDiff";

const BEFORE = "# header\nmain_line: ''\nending: ''\nconstraints: 旧值\nthemes: ''\n";
const AFTER = "# header\nmain_line: ''\nending: ''\nconstraints: 新值\nthemes: ''\n";

describe("diffFile", () => {
  it("reports only the rewritten line", () => {
    const diff = diffFile(BEFORE, AFTER);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
    expect(diff.changedLines).toEqual([4]);
    expect(diff.firstChange).toBe(4);
    expect(diff.lines.filter((row) => row.type === "plus")[0].text).toBe("constraints: 新值");
  });

  it("says nothing changed when the text is identical", () => {
    const diff = diffFile(BEFORE, BEFORE);
    expect(diff.added).toBe(0);
    expect(diff.removed).toBe(0);
    expect(diff.changedLines).toEqual([]);
    expect(diff.lines.every((row) => row.type === "same")).toBe(true);
  });

  it("keeps an untouched head out of the change set", () => {
    const diff = diffFile("a\nb\nc\n", "a\nX\nc\n");
    expect(diff.changedLines).toEqual([2]);
    expect(diff.added).toBe(1);
    expect(diff.removed).toBe(1);
  });

  // Head/tail trimming describes one hunk, so two separate edits read as the
  // whole span between them. The card shows the changed lines either way.
  it("collapses two edits into one hunk", () => {
    const diff = diffFile("a\nb\nc\nd\n", "a\nX\nc\nY\n");
    expect(diff.changedLines).toEqual([2, 3, 4]);
    expect(diff.lines.filter((row) => row.type === "minus").map((row) => row.text)).toEqual([
      "b",
      "c",
      "d",
    ]);
  });
});