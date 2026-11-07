import { describe, it, expect } from "vitest";
import { refsByOid } from "../lib/refsByOid";

describe("refsByOid", () => {
  it("groups branches and tags by target oid", () => {
    const branches = [
      { name: "main", isRemote: false, isHead: true, targetOid: "a" },
      { name: "origin/main", isRemote: true, isHead: false, targetOid: "a" },
      { name: "feature", isRemote: false, isHead: false, targetOid: "b" },
    ];
    const tags = [{ name: "v1.0", targetOid: "a" }];

    const map = refsByOid(branches, tags);

    expect(map.get("a")).toEqual({ branches: ["main", "origin/main"], tags: ["v1.0"] });
    expect(map.get("b")).toEqual({ branches: ["feature"], tags: [] });
    expect(map.get("c")).toBeUndefined();
  });

  it("returns an empty map for no branches/tags", () => {
    expect(refsByOid([], []).size).toBe(0);
  });
});
