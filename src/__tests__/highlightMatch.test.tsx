import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { splitMatches, highlightMatch } from "../lib/highlightMatch";

describe("splitMatches", () => {
  it("returns one plain part for an empty query", () => {
    expect(splitMatches("hello", "")).toEqual([{ text: "hello", match: false }]);
    expect(splitMatches("hello", "  ")).toEqual([{ text: "hello", match: false }]);
  });
  it("matches case-insensitively and keeps original casing", () => {
    expect(splitMatches("Fix Bug fix", "fix")).toEqual([
      { text: "Fix", match: true },
      { text: " Bug ", match: false },
      { text: "fix", match: true },
    ]);
  });
  it("escapes regex special characters", () => {
    expect(splitMatches("a.b axb (x)", ".")).toEqual([
      { text: "a", match: false },
      { text: ".", match: true },
      { text: "b axb (x)", match: false },
    ]);
    expect(splitMatches("call(x)", "(x)")).toHaveLength(2);
  });
  it("handles empty text", () => {
    expect(splitMatches("", "a")).toEqual([]);
  });
});

describe("highlightMatch", () => {
  it("wraps matches in mark", () => {
    const { container } = render(<div>{highlightMatch("one two", "two")}</div>);
    const mark = container.querySelector("mark")!;
    expect(mark.textContent).toBe("two");
    expect(mark.className).toContain("bg-accent-soft");
  });
});
