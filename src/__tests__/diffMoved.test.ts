import { describe, it, expect } from "vitest";
import {
  parseDiffLines,
  markMovedLines,
  hunkText,
  buildDiffRows,
  isHugePatch,
  patchLineCount,
  HUGE_PATCH_LINES,
} from "../lib/diffLines";

describe("markMovedLines", () => {
  it("flags a line deleted in one hunk and added in another", () => {
    const patch = [
      "@@ -1,3 +1,2 @@",
      "-const value = compute(input);",
      " keep one",
      " keep two",
      "@@ -20,2 +19,3 @@",
      " tail",
      "+const value = compute(input);",
      " end",
    ].join("\n");
    const out = markMovedLines(parseDiffLines(patch));
    expect(out.filter((l) => l.moved).map((l) => l.type)).toEqual(["del", "add"]);
  });

  it("ignores trivial lines like braces and blanks", () => {
    const patch = ["@@ -1,3 +1,2 @@", "-}", " a", " b", "@@ -20,2 +19,3 @@", " c", "+}", " d"].join("\n");
    expect(markMovedLines(parseDiffLines(patch)).some((l) => l.moved)).toBe(false);
  });

  it("does not treat an in-place reindent as a move", () => {
    const patch = "@@ -1,1 +1,1 @@\n-foo(bar, baz);\n+    foo(bar, baz);\n";
    expect(markMovedLines(parseDiffLines(patch)).some((l) => l.moved)).toBe(false);
  });

  it("does not mutate its input", () => {
    const lines = parseDiffLines("@@ -1,1 +1,1 @@\n-one line here\n+two line here\n");
    const out = markMovedLines(lines);
    expect(out).not.toBe(lines);
    expect(lines.every((l) => l.moved === undefined)).toBe(true);
  });
});

describe("hunkText", () => {
  it("returns the change block as -/+ lines", () => {
    const rows = buildDiffRows(parseDiffLines("@@ -1,3 +1,3 @@\n ctx\n-old\n+new\n ctx2\n"));
    expect(hunkText(rows, 1)).toBe("-old\n+new");
  });
});

describe("isHugePatch", () => {
  it("is false for small patches and true past the byte or line limits", () => {
    expect(isHugePatch("@@ -1 +1 @@\n-a\n+b\n")).toBe(false);
    expect(isHugePatch("x".repeat(250_000))).toBe(true);
    expect(isHugePatch("+a\n".repeat(HUGE_PATCH_LINES + 1))).toBe(true);
  });
  it("counts lines", () => {
    expect(patchLineCount("")).toBe(0);
    expect(patchLineCount("a\nb")).toBe(2);
  });
});
