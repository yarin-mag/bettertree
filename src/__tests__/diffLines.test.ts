import { describe, it, expect } from "vitest";
import {
  parseDiffLines,
  countChangedChars,
  oldPaneLines,
  newPaneLines,
  buildDiffRows,
  flattenDiffRows,
  isWhitespaceOnlyChange,
  collapseContextRows,
  changeHunkStarts,
  type DiffLine,
  type DiffRow,
} from "../lib/diffLines";

describe("parseDiffLines", () => {
  it("classifies added, removed, and context lines", () => {
    const lines = parseDiffLines("-one\n+two\n context line\n");
    expect(lines).toEqual([
      { type: "del", content: "one" },
      { type: "add", content: "two" },
      { type: "context", content: "context line" },
    ]);
  });

  it("drops the trailing empty line produced by a final newline", () => {
    const lines = parseDiffLines("+only line\n");
    expect(lines).toHaveLength(1);
  });

  it("strips the git header preamble before the first hunk", () => {
    const patch =
      "diff --git a/foo.js b/foo.js\nnew file mode 100644\nindex 0000000..87bceb\n--- /dev/null\n+++ b/foo.js\n@@ -0,0 +1,2 @@\n+one\n+two\n";
    const lines = parseDiffLines(patch);
    expect(lines).toEqual([
      { type: "add", content: "one", newNo: 1 },
      { type: "add", content: "two", newNo: 2 },
    ]);
  });

  it("drops hunk headers and numbers lines from each header's start", () => {
    const lines = parseDiffLines("@@ -10,2 +20,2 @@ fn\n ctx\n-old\n+new\n@@ -50,1 +60,1 @@\n ctx2\n");
    expect(lines).toEqual([
      { type: "context", content: "ctx", oldNo: 10, newNo: 20 },
      { type: "del", content: "old", oldNo: 11 },
      { type: "add", content: "new", newNo: 21 },
      { type: "context", content: "ctx2", oldNo: 50, newNo: 60 },
    ]);
  });

  it("counts added and removed characters", () => {
    expect(countChangedChars(parseDiffLines("-abc\n+de\n ctx\n"))).toEqual({ added: 2, removed: 3 });
  });
});

describe("oldPaneLines / newPaneLines", () => {
  const lines = parseDiffLines("-removed\n+added\n context\n");

  it("oldPaneLines excludes added lines", () => {
    expect(oldPaneLines(lines)).toEqual([
      { type: "del", content: "removed" },
      { type: "context", content: "context" },
    ]);
  });

  it("newPaneLines excludes removed lines", () => {
    expect(newPaneLines(lines)).toEqual([
      { type: "add", content: "added" },
      { type: "context", content: "context" },
    ]);
  });
});

describe("buildDiffRows", () => {
  it("pairs a 1:1 replace into a single row with word-diff segments", () => {
    // Long enough (>30 chars) to use word-level, not char-level, diffing.
    const lines = parseDiffLines("-hello world this is a very fine day\n+hello there this is a very fine day\n");
    const rows = buildDiffRows(lines);
    expect(rows).toHaveLength(1);
    expect(rows[0].old?.content).toBe("hello world this is a very fine day");
    expect(rows[0].new?.content).toBe("hello there this is a very fine day");
    expect(rows[0].oldWords).toEqual([
      { value: "hello ", changed: false, whitespace: false },
      { value: "world", changed: true, whitespace: false },
      { value: " this is a very fine day", changed: false, whitespace: false },
    ]);
    expect(rows[0].newWords).toEqual([
      { value: "hello ", changed: false, whitespace: false },
      { value: "there", changed: true, whitespace: false },
      { value: " this is a very fine day", changed: false, whitespace: false },
    ]);
  });

  it("pads the shorter side with null when del/add counts differ", () => {
    const lines = parseDiffLines("-old\n+new1\n+new2\n");
    const rows = buildDiffRows(lines);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ old: { content: "old" }, new: { content: "new1" } });
    expect(rows[1].old).toBeNull();
    expect(rows[1].new).toMatchObject({ content: "new2" });
    // row 0 has both sides, so word-diff is computed; row 1 has no del
    // counterpart, so there's nothing to diff against
    expect(rows[0].oldWords).not.toBeNull();
    expect(rows[1].newWords).toBeNull();
  });

  it("keeps context lines on both sides of the row with no word-diff", () => {
    const lines = parseDiffLines(" context\n");
    const rows = buildDiffRows(lines);
    expect(rows).toEqual([{ old: lines[0], new: lines[0], oldWords: null, newWords: null }]);
  });
});

describe("flattenDiffRows", () => {
  it("reconstructs del-then-add order with each line's word segments attached", () => {
    const lines = parseDiffLines("-hello world\n+hello there\n context\n");
    const flat = flattenDiffRows(buildDiffRows(lines));
    expect(flat.map((f) => f.line.content)).toEqual(["hello world", "hello there", "context"]);
    expect(flat[0].words?.some((w) => w.changed)).toBe(true);
    expect(flat[2].words).toBeNull();
  });
});

describe("isWhitespaceOnlyChange", () => {
  it("is true when only whitespace differs", () => {
    expect(isWhitespaceOnlyChange("  const x = 1;", "const x = 1;")).toBe(true);
    expect(isWhitespaceOnlyChange("a\tb", "a b")).toBe(true);
  });

  it("is false when identical or when content differs", () => {
    expect(isWhitespaceOnlyChange("same", "same")).toBe(false);
    expect(isWhitespaceOnlyChange("const x = 1;", "const x = 2;")).toBe(false);
  });
});

describe("collapseContextRows", () => {
  const contextLine = (n: number): DiffLine => ({ type: "context", content: `line ${n}` });
  const contextRow = (n: number): DiffRow<DiffLine> => {
    const line = contextLine(n);
    return { old: line, new: line, oldWords: null, newWords: null };
  };
  const changeRow = (content: string): DiffRow<DiffLine> => ({
    old: { type: "del", content },
    new: null,
    oldWords: null,
    newWords: null,
  });

  it("leaves a short run of context rows alone", () => {
    const rows = [contextRow(1), contextRow(2), changeRow("x")];
    expect(collapseContextRows(rows, 3, 8)).toEqual(rows.map((row) => ({ kind: "row", row })));
  });

  it("collapses a long run of context rows down to edge rows + a placeholder", () => {
    const rows = [...Array.from({ length: 12 }, (_, i) => contextRow(i)), changeRow("x")];
    const display = collapseContextRows(rows, 3, 8);
    expect(display[0]).toEqual({ kind: "row", row: rows[0] });
    expect(display[2]).toEqual({ kind: "row", row: rows[2] });
    expect(display[3]).toEqual({ kind: "collapsed", rows: rows.slice(3, 9) });
    expect(display[4]).toEqual({ kind: "row", row: rows[9] });
    expect(display.at(-1)).toEqual({ kind: "row", row: rows[12] });
  });
});

describe("changeHunkStarts", () => {
  it("finds the first row of each contiguous non-context block", () => {
    const context: DiffLine = { type: "context", content: "ctx" };
    const contextRow: DiffRow<DiffLine> = { old: context, new: context, oldWords: null, newWords: null };
    const change = (content: string): DiffRow<DiffLine> => ({
      old: { type: "del", content },
      new: null,
      oldWords: null,
      newWords: null,
    });
    const rows = [contextRow, change("a"), change("b"), contextRow, change("c")];
    expect(changeHunkStarts(rows)).toEqual([1, 4]);
  });
});
