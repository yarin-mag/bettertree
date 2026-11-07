import { describe, it, expect, beforeEach } from "vitest";
import { useRecentReposStore } from "../store/recentReposStore";

describe("recentReposStore", () => {
  beforeEach(() => {
    localStorage.clear();
    useRecentReposStore.setState({ recentlyClosed: [] });
  });

  it("addClosed adds a repo to the front of the list", () => {
    useRecentReposStore.getState().addClosed({ path: "/tmp/a", name: "a" });
    const list = useRecentReposStore.getState().recentlyClosed;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ path: "/tmp/a", name: "a" });
    expect(typeof list[0].closedAt).toBe("number");
  });

  it("moves a re-closed repo to the front instead of duplicating it", () => {
    useRecentReposStore.getState().addClosed({ path: "/tmp/a", name: "a" });
    useRecentReposStore.getState().addClosed({ path: "/tmp/b", name: "b" });
    useRecentReposStore.getState().addClosed({ path: "/tmp/a", name: "a" });
    const list = useRecentReposStore.getState().recentlyClosed;
    expect(list.map((r) => r.path)).toEqual(["/tmp/a", "/tmp/b"]);
  });

  it("caps the list at 5 entries, dropping the oldest", () => {
    for (let i = 0; i < 7; i++) {
      useRecentReposStore.getState().addClosed({ path: `/tmp/${i}`, name: `${i}` });
    }
    const list = useRecentReposStore.getState().recentlyClosed;
    expect(list).toHaveLength(5);
    expect(list.map((r) => r.path)).toEqual(["/tmp/6", "/tmp/5", "/tmp/4", "/tmp/3", "/tmp/2"]);
  });

  it("removeClosed drops the matching entry", () => {
    useRecentReposStore.getState().addClosed({ path: "/tmp/a", name: "a" });
    useRecentReposStore.getState().addClosed({ path: "/tmp/b", name: "b" });
    useRecentReposStore.getState().removeClosed("/tmp/a");
    expect(useRecentReposStore.getState().recentlyClosed.map((r) => r.path)).toEqual(["/tmp/b"]);
  });

  it("persists across store instances via localStorage", () => {
    useRecentReposStore.getState().addClosed({ path: "/tmp/a", name: "a" });
    const raw = localStorage.getItem("workspace.recentlyClosed");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual(useRecentReposStore.getState().recentlyClosed);
  });
});
