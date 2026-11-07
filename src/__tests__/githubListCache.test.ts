import { describe, it, expect, beforeEach } from "vitest";
import { getCachedList, mergeCachedList } from "../lib/githubListCache";

describe("githubListCache", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns an empty list when nothing is cached yet", () => {
    expect(getCachedList("branches", "/tmp/a")).toEqual([]);
  });

  it("mergeCachedList stores the fresh list and getCachedList returns it back", () => {
    mergeCachedList("branches", "/tmp/a", ["main", "develop"]);
    expect(getCachedList("branches", "/tmp/a")).toEqual(["develop", "main"]);
  });

  it("mergeCachedList unions new entries with what's already cached, without dropping old ones", () => {
    mergeCachedList("branches", "/tmp/a", ["main", "develop"]);
    mergeCachedList("branches", "/tmp/a", ["main", "feature/new-thing"]);
    expect(getCachedList("branches", "/tmp/a")).toEqual(["develop", "feature/new-thing", "main"]);
  });

  it("keeps caches separate per repo path", () => {
    mergeCachedList("branches", "/tmp/a", ["main"]);
    mergeCachedList("branches", "/tmp/b", ["staging"]);
    expect(getCachedList("branches", "/tmp/a")).toEqual(["main"]);
    expect(getCachedList("branches", "/tmp/b")).toEqual(["staging"]);
  });

  it("keeps caches separate per kind within the same repo", () => {
    mergeCachedList("branches", "/tmp/a", ["main"]);
    mergeCachedList("assignableUsers", "/tmp/a", ["avery"]);
    expect(getCachedList("branches", "/tmp/a")).toEqual(["main"]);
    expect(getCachedList("assignableUsers", "/tmp/a")).toEqual(["avery"]);
  });

  it("ignores corrupted cache entries instead of throwing", () => {
    localStorage.setItem("bettertree.githubListCache.branches:/tmp/a", "{not json");
    expect(getCachedList("branches", "/tmp/a")).toEqual([]);
  });
});
