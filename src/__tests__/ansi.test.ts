import { describe, it, expect } from "vitest";
import { parseAnsi } from "../lib/ansi";

describe("parseAnsi", () => {
  it("returns one plain segment for text without escapes", () => {
    expect(parseAnsi("hello")).toEqual([{ text: "hello", className: "" }]);
  });
  it("colors segments and resets", () => {
    const out = parseAnsi("\u001b[31mred\u001b[0m plain");
    expect(out[0]).toEqual({ text: "red", className: "text-danger" });
    expect(out[1]).toEqual({ text: " plain", className: "" });
  });
  it("drops unknown or malformed sequences without throwing", () => {
    expect(parseAnsi("a\u001b[38;5;99mb\u001b[")).toEqual([{ text: "ab", className: "" }]);
    expect(() => parseAnsi("\u001b[")).not.toThrow();
  });
  it("drops extended color arguments instead of treating them as codes", () => {
    expect(parseAnsi("\u001b[38;5;32mx\u001b[0m")).toEqual([{ text: "x", className: "" }]);
    expect(parseAnsi("\u001b[38;5;1mx")).toEqual([{ text: "x", className: "" }]);
    expect(parseAnsi("\u001b[38;2;10;20;30mx")).toEqual([{ text: "x", className: "" }]);
    expect(parseAnsi("\u001b[48;5;32mx")).toEqual([{ text: "x", className: "" }]);
  });
  it("resets color with 39 and bold with 22/0", () => {
    expect(parseAnsi("\u001b[31mred\u001b[39mplain")).toEqual([
      { text: "red", className: "text-danger" },
      { text: "plain", className: "" },
    ]);
    expect(parseAnsi("\u001b[1mb\u001b[22mn")).toEqual([
      { text: "b", className: "font-bold" },
      { text: "n", className: "" },
    ]);
    expect(parseAnsi("\u001b[1mb\u001b[0mn")[1].className).toBe("");
  });
  it("keeps bold across color codes and never duplicates it", () => {
    expect(parseAnsi("\u001b[1m\u001b[31mx")).toEqual([{ text: "x", className: "text-danger font-bold" }]);
    expect(parseAnsi("\u001b[1m\u001b[1mx")).toEqual([{ text: "x", className: "font-bold" }]);
    expect(parseAnsi("\u001b[31m\u001b[1mx")[0].className).toBe("text-danger font-bold");
  });
  it("does not hang or throw on lone escapes or long parameter runs", () => {
    expect(parseAnsi("\u001b")).toEqual([{ text: "", className: "" }]);
    const out = parseAnsi("\u001b[" + ";".repeat(5000) + "mx");
    expect(out).toEqual([{ text: "x", className: "" }]);
  });
});
