import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../lib/tauri", () => ({
  invokeListRepos: vi.fn(),
  invokeAddRepo: vi.fn(),
  invokeGetBranches: vi.fn(),
  invokeGetTags: vi.fn(),
  invokeGetCommitGraph: vi.fn(),
  invokeEnsureSearchIndex: vi.fn().mockResolvedValue(undefined),
  invokeSwitchBranch: vi.fn(),
}));

import { useWorkspaceStore } from "../store/workspaceStore";
import * as tauriLib from "../lib/tauri";

describe("workspaceStore", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      repos: [],
      activeRepoId: null,
      branches: [],
      tags: [],
      commits: [],
    });
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
    (tauriLib.invokeGetBranches as any).mockResolvedValue([
      { name: "main", isRemote: false, isHead: true, targetOid: "abc" },
    ]);
    (tauriLib.invokeGetTags as any).mockResolvedValue([]);
    (tauriLib.invokeGetCommitGraph as any).mockResolvedValue([]);

    await useWorkspaceStore.getState().setActiveRepo(1);

    expect(useWorkspaceStore.getState().activeRepoId).toBe(1);
    expect(useWorkspaceStore.getState().branches).toHaveLength(1);
    expect(tauriLib.invokeGetBranches).toHaveBeenCalledWith("/tmp/a");
  });

  it("setActiveRepo fires ensure_search_index without blocking on it", async () => {
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
    });
    (tauriLib.invokeGetBranches as any).mockResolvedValue([]);
    (tauriLib.invokeGetTags as any).mockResolvedValue([]);
    (tauriLib.invokeGetCommitGraph as any).mockResolvedValue([]);

    await useWorkspaceStore.getState().setActiveRepo(1);

    expect(tauriLib.invokeEnsureSearchIndex).toHaveBeenCalledWith("/tmp/a");
  });

  it("switchBranch calls invokeSwitchBranch then refreshes branches/tags/commits", async () => {
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
    });
    (tauriLib.invokeSwitchBranch as any).mockResolvedValue(undefined);
    (tauriLib.invokeGetBranches as any).mockResolvedValue([
      { name: "feature", isRemote: false, isHead: true, targetOid: "abc" },
    ]);
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
});
