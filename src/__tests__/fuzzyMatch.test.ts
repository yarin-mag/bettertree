import { describe, it, expect } from "vitest";
import { fuzzyMatch, rankMatches } from "../lib/fuzzyMatch";

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

describe("rankMatches", () => {
  it("ranks substring matches before fuzzy-only matches", () => {
    const items = ["moxbxilxe", "mobile", "release/mobile-v2"];
    expect(rankMatches("mobile", items, (s) => s)).toEqual(["mobile", "release/mobile-v2", "moxbxilxe"]);
  });

  it("excludes items that match neither as a substring nor fuzzily", () => {
    const items = ["mobile", "completely-unrelated"];
    expect(rankMatches("mobile", items, (s) => s)).toEqual(["mobile"]);
  });

  it("never duplicates an item across the two buckets", () => {
    const items = ["mobile"];
    const result = rankMatches("mobile", items, (s) => s);
    expect(result).toEqual(["mobile"]);
    expect(result.length).toBe(1);
  });

  it("returns the input unchanged and unreordered when the query is empty", () => {
    const items = ["zebra", "apple", "mango"];
    expect(rankMatches("", items, (s) => s)).toEqual(["zebra", "apple", "mango"]);
  });

  it("works with a getText accessor over non-string items", () => {
    const items = [{ name: "moxbxilxe" }, { name: "mobile" }];
    expect(rankMatches("mobile", items, (i) => i.name)).toEqual([{ name: "mobile" }, { name: "moxbxilxe" }]);
  });
});
