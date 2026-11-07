import { describe, it, expect, beforeEach } from "vitest";
import { getVisibleFilters, setVisibleFilters, DEFAULT_VISIBLE_FILTERS } from "../lib/visibleFilters";

describe("visibleFilters", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns the defaults when nothing has been stored", () => {
    expect(getVisibleFilters()).toEqual(DEFAULT_VISIBLE_FILTERS);
  });

  it("round-trips a custom set", () => {
    setVisibleFilters(["author", "sort"]);
    expect(getVisibleFilters()).toEqual(["author", "sort"]);
  });

  it("falls back to the defaults when localStorage holds corrupt data", () => {
    localStorage.setItem("bettertree.visibleFilters", "{not json");
    expect(getVisibleFilters()).toEqual(DEFAULT_VISIBLE_FILTERS);
  });
});
