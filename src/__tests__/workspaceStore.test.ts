import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/tauri", () => ({
  invokeListRepos: vi.fn(),
  invokeAddRepo: vi.fn(),
  invokeRemoveRepo: vi.fn(),
  invokeGetBranches: vi.fn(),
  invokeGetTags: vi.fn(),
  invokeGetCommitGraph: vi.fn(),
  invokeEnsureSearchIndex: vi.fn().mockResolvedValue(undefined),
  invokeSwitchBranch: vi.fn(),
  invokeCheckoutTag: vi.fn(),
  invokeGetGithubStatus: vi.fn().mockResolvedValue({ available: false, owner: null, repo: null, reason: "not checked" }),
}));

import { useWorkspaceStore } from "../store/workspaceStore";
import { useGithubStore } from "../store/githubStore";
import { useRecentReposStore } from "../store/recentReposStore";
import * as tauriLib from "../lib/tauri";

describe("workspaceStore", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      repos: [],
      activeRepoId: null,
      branches: [],
      headDetached: false,
      headOid: null,
      tags: [],
      commits: [],
      commitGraphLimit: 200,
      hasMoreCommits: true,
      isLoadingMoreCommits: false,
    });
    localStorage.clear();
    useRecentReposStore.setState({ recentlyClosed: [] });
  });

  it("loadRepos populates repos from the backend", async () => {
    (tauriLib.invokeListRepos as any).mockResolvedValue([
      { id: 1, path: "/tmp/a", name: "a", pinned: false },
    ]);
    await useWorkspaceStore.getState().loadRepos();
    expect(useWorkspaceStore.getState().repos).toHaveLength(1);
    expect(useWorkspaceStore.getState().repos[0].name).toBe("a");
  });

  it("setActiveRepo loads branches, tags, and commits for that repo", async () => {
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
    });
    (tauriLib.invokeGetBranches as any).mockResolvedValue({
      branches: [{ name: "main", isRemote: false, isHead: true, targetOid: "abc" }],
      headDetached: false,
      headOid: null,
    });
    (tauriLib.invokeGetTags as any).mockResolvedValue([]);
    (tauriLib.invokeGetCommitGraph as any).mockResolvedValue([]);

    await useWorkspaceStore.getState().setActiveRepo(1);

    expect(useWorkspaceStore.getState().activeRepoId).toBe(1);
    expect(useWorkspaceStore.getState().branches).toHaveLength(1);
    expect(tauriLib.invokeGetBranches).toHaveBeenCalledWith("/tmp/a");
  });

  it("refreshActiveRepoData sets hasMoreCommits when a full page comes back, false when the history runs out", async () => {
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
    });
    (tauriLib.invokeGetBranches as any).mockResolvedValue({ branches: [], headDetached: false, headOid: null });
    (tauriLib.invokeGetTags as any).mockResolvedValue([]);
    (tauriLib.invokeGetCommitGraph as any).mockResolvedValue(
      Array.from({ length: 200 }, (_, i) => ({ oid: `c${i}`, summary: "x", author: "a", timestamp: i, lane: 0, edges: [], activeLanes: [true] }))
    );

    await useWorkspaceStore.getState().refreshActiveRepoData("/tmp/a");

    expect(tauriLib.invokeGetCommitGraph).toHaveBeenCalledWith("/tmp/a", 200);
    expect(useWorkspaceStore.getState().commits).toHaveLength(200);
    expect(useWorkspaceStore.getState().hasMoreCommits).toBe(true);

    (tauriLib.invokeGetCommitGraph as any).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({ oid: `c${i}`, summary: "x", author: "a", timestamp: i, lane: 0, edges: [], activeLanes: [true] }))
    );
    await useWorkspaceStore.getState().refreshActiveRepoData("/tmp/a");
    expect(useWorkspaceStore.getState().hasMoreCommits).toBe(false);
  });

  it("loadMoreCommits fetches a larger page for the active repo and replaces commits", async () => {
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
      commitGraphLimit: 200,
      hasMoreCommits: true,
    });
    (tauriLib.invokeGetCommitGraph as any).mockResolvedValue(
      Array.from({ length: 400 }, (_, i) => ({ oid: `c${i}`, summary: "x", author: "a", timestamp: i, lane: 0, edges: [], activeLanes: [true] }))
    );

    await useWorkspaceStore.getState().loadMoreCommits();

    expect(tauriLib.invokeGetCommitGraph).toHaveBeenCalledWith("/tmp/a", 400);
    expect(useWorkspaceStore.getState().commits).toHaveLength(400);
    expect(useWorkspaceStore.getState().commitGraphLimit).toBe(400);
    expect(useWorkspaceStore.getState().hasMoreCommits).toBe(true);
  });

  it("loadMoreCommits sets isLoadingMoreCommits while in flight", async () => {
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
      commitGraphLimit: 200,
    });
    let resolveFn: (value: any) => void;
    (tauriLib.invokeGetCommitGraph as any).mockReturnValue(
      new Promise((resolve) => {
        resolveFn = resolve;
      })
    );

    const promise = useWorkspaceStore.getState().loadMoreCommits();
    expect(useWorkspaceStore.getState().isLoadingMoreCommits).toBe(true);
    resolveFn!([]);
    await promise;
    expect(useWorkspaceStore.getState().isLoadingMoreCommits).toBe(false);
  });

  it("setActiveRepo fires ensure_search_index without blocking on it", async () => {
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
    });
    (tauriLib.invokeGetBranches as any).mockResolvedValue({ branches: [], headDetached: false, headOid: null });
    (tauriLib.invokeGetTags as any).mockResolvedValue([]);
    (tauriLib.invokeGetCommitGraph as any).mockResolvedValue([]);

    await useWorkspaceStore.getState().setActiveRepo(1);

    expect(tauriLib.invokeEnsureSearchIndex).toHaveBeenCalledWith("/tmp/a");
  });

  it("setActiveRepo fires get_github_status without blocking on it", async () => {
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
    });
    (tauriLib.invokeGetBranches as any).mockResolvedValue({ branches: [], headDetached: false, headOid: null });
    (tauriLib.invokeGetTags as any).mockResolvedValue([]);
    (tauriLib.invokeGetCommitGraph as any).mockResolvedValue([]);
    (tauriLib.invokeGetGithubStatus as any).mockResolvedValue({
      available: true,
      owner: "acme",
      repo: "widgets",
      reason: null,
    });

    await useWorkspaceStore.getState().setActiveRepo(1);

    expect(tauriLib.invokeGetGithubStatus).toHaveBeenCalledWith("/tmp/a");
    await vi.waitFor(() => {
      expect(useGithubStore.getState().status?.available).toBe(true);
    });
  });

  it("switchBranch calls invokeSwitchBranch then refreshes branches/tags/commits", async () => {
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
    });
    (tauriLib.invokeSwitchBranch as any).mockResolvedValue(undefined);
    (tauriLib.invokeGetBranches as any).mockResolvedValue({
      branches: [{ name: "feature", isRemote: false, isHead: true, targetOid: "abc" }],
      headDetached: false,
      headOid: null,
    });
    (tauriLib.invokeGetTags as any).mockResolvedValue([]);
    (tauriLib.invokeGetCommitGraph as any).mockResolvedValue([]);

    await useWorkspaceStore.getState().switchBranch("/tmp/a", "feature", false);

    expect(tauriLib.invokeSwitchBranch).toHaveBeenCalledWith("/tmp/a", "feature", false);
    expect(useWorkspaceStore.getState().branches[0].name).toBe("feature");
  });

  it("switchBranch propagates a rejection to the caller", async () => {
    (tauriLib.invokeSwitchBranch as any).mockRejectedValue("cannot switch branches with uncommitted changes");

    await expect(
      useWorkspaceStore.getState().switchBranch("/tmp/a", "feature", false)
    ).rejects.toBe("cannot switch branches with uncommitted changes");
  });

  it("checkoutTag calls invokeCheckoutTag then refreshes branches/tags/commits", async () => {
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
    });
    (tauriLib.invokeCheckoutTag as any).mockResolvedValue(undefined);
    (tauriLib.invokeGetBranches as any).mockResolvedValue({
      branches: [],
      headDetached: true,
      headOid: "abc123",
    });
    (tauriLib.invokeGetTags as any).mockResolvedValue([{ name: "v1.0", targetOid: "abc123" }]);
    (tauriLib.invokeGetCommitGraph as any).mockResolvedValue([]);

    await useWorkspaceStore.getState().checkoutTag("/tmp/a", "v1.0");

    expect(tauriLib.invokeCheckoutTag).toHaveBeenCalledWith("/tmp/a", "v1.0");
    expect(useWorkspaceStore.getState().headDetached).toBe(true);
    expect(useWorkspaceStore.getState().headOid).toBe("abc123");
  });

  describe("removeRepo", () => {
    beforeEach(() => {
      useWorkspaceStore.setState({
        repos: [
          { id: 1, path: "/tmp/a", name: "a", pinned: false },
          { id: 2, path: "/tmp/b", name: "b", pinned: false },
        ],
      });
      (tauriLib.invokeRemoveRepo as any).mockReset().mockResolvedValue(undefined);
    });

    it("calls invokeRemoveRepo and drops the repo from the list", async () => {
      await useWorkspaceStore.getState().removeRepo(2);
      expect(tauriLib.invokeRemoveRepo).toHaveBeenCalledWith(2);
      expect(useWorkspaceStore.getState().repos.map((r) => r.id)).toEqual([1]);
    });

    it("records the closed repo in recentReposStore", async () => {
      await useWorkspaceStore.getState().removeRepo(2);
      expect(useRecentReposStore.getState().recentlyClosed).toEqual([
        expect.objectContaining({ path: "/tmp/b", name: "b" }),
      ]);
    });

    it("clears activeRepoId and derived state only when the removed repo was active", async () => {
      useWorkspaceStore.setState({ activeRepoId: 1, branches: [{ name: "main", isRemote: false, isHead: true, targetOid: "x" }] });

      await useWorkspaceStore.getState().removeRepo(2);
      expect(useWorkspaceStore.getState().activeRepoId).toBe(1);
      expect(useWorkspaceStore.getState().branches).toHaveLength(1);

      await useWorkspaceStore.getState().removeRepo(1);
      expect(useWorkspaceStore.getState().activeRepoId).toBeNull();
      expect(useWorkspaceStore.getState().branches).toEqual([]);
    });

    it("is a no-op when the repo id doesn't exist", async () => {
      await useWorkspaceStore.getState().removeRepo(999);
      expect(tauriLib.invokeRemoveRepo).not.toHaveBeenCalled();
      expect(useWorkspaceStore.getState().repos).toHaveLength(2);
    });
  });
});
