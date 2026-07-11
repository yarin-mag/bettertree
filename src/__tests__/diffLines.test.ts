import { describe, it, expect } from "vitest";
import { parseDiffLines, oldPaneLines, newPaneLines } from "../lib/diffLines";

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
