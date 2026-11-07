import { describe, it, expect, beforeEach } from "vitest";
import { usePinnedStore } from "../store/pinnedStore";

describe("pinnedStore", () => {
  beforeEach(() => {
    localStorage.clear();
    usePinnedStore.setState({ pinnedCommits: [], pinnedPrs: [] });
  });

  it("toggleCommit pins then unpins", () => {
    const commit = { repoPath: "/tmp/a", oid: "abc123", summary: "fix bug" };
    usePinnedStore.getState().toggleCommit(commit);
    expect(usePinnedStore.getState().isCommitPinned("/tmp/a", "abc123")).toBe(true);
    expect(usePinnedStore.getState().pinnedCommits).toHaveLength(1);

    usePinnedStore.getState().toggleCommit(commit);
    expect(usePinnedStore.getState().isCommitPinned("/tmp/a", "abc123")).toBe(false);
    expect(usePinnedStore.getState().pinnedCommits).toHaveLength(0);
  });

  it("togglePr pins then unpins, keyed by owner/repo/number", () => {
    const pr = { owner: "acme", repo: "widgets", number: 42, title: "Fix the thing" };
    usePinnedStore.getState().togglePr(pr);
    expect(usePinnedStore.getState().isPrPinned("acme", "widgets", 42)).toBe(true);

    usePinnedStore.getState().togglePr(pr);
    expect(usePinnedStore.getState().isPrPinned("acme", "widgets", 42)).toBe(false);
  });

  it("persists to localStorage", () => {
    usePinnedStore.getState().toggleCommit({ repoPath: "/tmp/a", oid: "abc123", summary: "fix bug" });
    const raw = localStorage.getItem("pinned.commits");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toHaveLength(1);
  });

  it("distinguishes commits with the same oid in different repos", () => {
    usePinnedStore.getState().toggleCommit({ repoPath: "/tmp/a", oid: "abc123", summary: "x" });
    expect(usePinnedStore.getState().isCommitPinned("/tmp/b", "abc123")).toBe(false);
  });
});
