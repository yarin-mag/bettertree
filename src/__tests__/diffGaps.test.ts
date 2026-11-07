import { describe, it, expect } from "vitest";
import {
  parseDiffLines,
  insertGaps,
  splitFileLines,
  buildDiffRows,
  collapseContextRows,
  changeHunkStarts,
  hunkText,
  GAP_STEP,
  type DiffLine,
} from "../lib/diffLines";

const file = (n: number, changed: Record<number, string> = {}) =>
  Array.from({ length: n }, (_, i) => changed[i + 1] ?? `line ${i + 1}`);
const same = (l: DiffLine) => ({ ...l });

describe("splitFileLines", () => {
  it("drops the empty piece after a trailing newline", () => {
    expect(splitFileLines("a\nb\n")).toEqual(["a", "b"]);
    expect(splitFileLines("a\nb")).toEqual(["a", "b"]);
    expect(splitFileLines("")).toEqual([]);
  });
});

describe("insertGaps", () => {
  // one change at line 11 of a 30-line file, 1 line of context each side
  const patch = "@@ -10,3 +10,3 @@\n line 10\n-line 11\n+CHANGED 11\n line 12\n";
  const newLines = file(30, { 11: "CHANGED 11" });
  const gaps = (lines: DiffLine[]) => lines.filter((l) => l.gap).map((l) => l.gap!);

  it("adds a gap before the first hunk and after the last one", () => {
    const out = insertGaps(parseDiffLines(patch), newLines, {}, same);
    const g = gaps(out);
    expect(g).toHaveLength(2);
    expect(g[0]).toMatchObject({ count: 9, oldStart: 1, newStart: 1, hasAbove: false, hasBelow: true });
    expect(g[1]).toMatchObject({ count: 18, oldStart: 13, newStart: 13, hasAbove: true, hasBelow: false });
    expect(out[0].gap).toBeDefined();
    expect(out[out.length - 1].gap).toBeDefined();
  });

  it("adds a gap between two hunks, with old and new numbers offset by the net change", () => {
    const twoHunks =
      "@@ -2,2 +2,1 @@\n-line 2\n-line 3\n+ONE\n@@ -20,1 +19,1 @@\n-line 20\n+TWO\n";
    // new file: line 1, ONE, then old 4..19 as new 3..18, TWO at 19, then old 21.. as new 20..
    const nl = ["line 1", "ONE", ...file(19).slice(3, 19), "TWO", ...file(30).slice(20)];
    const mid = gaps(insertGaps(parseDiffLines(twoHunks), nl, {}, same)).find((g) => g.hasAbove && g.hasBelow)!;
    expect(mid).toMatchObject({ oldStart: 4, newStart: 3, count: 16 });
  });

  it("leaves a diff that already covers the whole file without any gap", () => {
    const whole = "@@ -1,2 +1,2 @@\n-a\n+b\n c\n";
    expect(gaps(insertGaps(parseDiffLines(whole), ["b", "c"], {}, same))).toHaveLength(0);
  });

  it("reveals lines next to the previous hunk and shrinks the gap", () => {
    const out = insertGaps(parseDiffLines(patch), newLines, { 1: { top: 3, bottom: 0 } }, same);
    const revealed = out.filter((l) => l.revealed);
    expect(revealed.map((l) => l.content)).toEqual(["line 13", "line 14", "line 15"]);
    expect(revealed[0]).toMatchObject({ type: "context", oldNo: 13, newNo: 13 });
    const g = gaps(out).find((x) => !x.hasBelow)!;
    expect(g).toMatchObject({ count: 15, newStart: 16, oldStart: 16 });
  });

  it("reveals lines next to the following hunk", () => {
    const out = insertGaps(parseDiffLines(patch), newLines, { 0: { top: 0, bottom: 2 } }, same);
    const revealed = out.filter((l) => l.revealed);
    expect(revealed.map((l) => l.newNo)).toEqual([8, 9]);
    // revealed lines sit between the gap row and the hunk
    const gapIdx = out.findIndex((l) => l.gap);
    expect(out[gapIdx + 1].newNo).toBe(8);
    expect(gaps(out)[0]).toMatchObject({ count: 7 });
  });

  it("drops the gap row once every hidden line is revealed", () => {
    const out = insertGaps(parseDiffLines(patch), newLines, { 0: { top: 0, bottom: Number.MAX_SAFE_INTEGER } }, same);
    expect(gaps(out)).toHaveLength(1);
    expect(out.filter((l) => l.revealed)).toHaveLength(9);
  });

  it("ignores a gap that would run past the end of the file contents", () => {
    // stale/short content: no trailing lines to show, and no gap row for them
    const out = insertGaps(parseDiffLines(patch), file(12, { 11: "CHANGED 11" }), {}, same);
    expect(gaps(out).some((g) => !g.hasBelow)).toBe(false);
  });

  it("returns lines untouched when the patch has no line numbers", () => {
    const lines = parseDiffLines("+a\n-b\n");
    expect(insertGaps(lines, ["a"], {}, same)).toEqual(lines);
  });

  it("exposes the step used by the expand buttons", () => {
    expect(GAP_STEP).toBe(20);
  });
});

describe("rows with gaps", () => {
  const patch = "@@ -10,3 +10,3 @@\n line 10\n-line 11\n+CHANGED 11\n line 12\n";
  const lines = insertGaps(parseDiffLines(patch), file(30, { 11: "CHANGED 11" }), { 1: { top: 12, bottom: 0 } }, same);
  const rows = buildDiffRows(lines);

  it("buildDiffRows turns a gap into a gap row with no old/new line", () => {
    const gapRows = rows.filter((r) => r.gap);
    expect(gapRows).toHaveLength(2);
    expect(gapRows[0].old).toBeNull();
    expect(gapRows[0].new).toBeNull();
  });

  it("gap rows are not counted as changes", () => {
    const starts = changeHunkStarts(rows);
    expect(starts).toHaveLength(1);
    expect(rows[starts[0]].old?.content).toBe("line 11");
  });

  it("a hunk's copy text stops at a gap", () => {
    const i = changeHunkStarts(rows)[0];
    expect(hunkText(rows, i)).toBe("-line 11\n+CHANGED 11");
  });

  it("never folds a run of context that contains revealed lines", () => {
    const display = collapseContextRows(rows);
    expect(display.some((d) => d.kind === "collapsed")).toBe(false);
  });
});
