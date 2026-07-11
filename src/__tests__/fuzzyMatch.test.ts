import { describe, it, expect } from "vitest";
import { fuzzyMatch } from "../lib/fuzzyMatch";

describe("fuzzyMatch", () => {
  it("matches when query characters appear in order in the target", () => {
    expect(fuzzyMatch("mn", "main")).toBe(true);
    expect(fuzzyMatch("ftr", "feature/login")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(fuzzyMatch("MAIN", "main")).toBe(true);
  });

  it("returns false when characters are out of order or missing", () => {
    expect(fuzzyMatch("nma", "main")).toBe(false);
    expect(fuzzyMatch("xyz", "main")).toBe(false);
  });

  it("empty query matches everything", () => {
    expect(fuzzyMatch("", "main")).toBe(true);
  });
});
