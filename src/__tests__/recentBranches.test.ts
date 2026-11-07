import { describe, it, expect, beforeEach } from "vitest";
import { getRecentBranches, recordRecentBranch } from "../lib/recentBranches";

describe("recentBranches", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns an empty list when nothing has been recorded", () => {
    expect(getRecentBranches()).toEqual([]);
  });

  it("records a branch and returns it most-recent-first", () => {
    recordRecentBranch("main");
    recordRecentBranch("develop");
    expect(getRecentBranches()).toEqual(["develop", "main"]);
  });

  it("moves a re-picked branch back to the front instead of duplicating it", () => {
    recordRecentBranch("main");
    recordRecentBranch("develop");
    recordRecentBranch("main");
    expect(getRecentBranches()).toEqual(["main", "develop"]);
  });

  it("caps the list at 5 entries", () => {
    ["a", "b", "c", "d", "e", "f"].forEach(recordRecentBranch);
    expect(getRecentBranches()).toEqual(["f", "e", "d", "c", "b"]);
  });

  it("returns an empty list when localStorage holds corrupt data", () => {
    localStorage.setItem("bettertree.recentBranches", "{not json");
    expect(getRecentBranches()).toEqual([]);
  });
});
