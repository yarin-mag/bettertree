import { describe, it, expect, beforeEach, vi } from "vitest";
import { StrictMode } from "react";
import { renderHook, act, waitFor } from "@testing-library/react";

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
  invokeGetGithubStatus: vi.fn().mockResolvedValue({ available: false, owner: null, repo: null, reason: "" }),
}));

import * as tauri from "../lib/tauri";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useViewStore } from "../store/viewStore";
import { useUiStore } from "../store/uiStore";
import { useSessionRestore } from "../hooks/useSessionRestore";

const KEY = "bettertree.session";
const repos = [
  { id: 1, path: "/work/a", name: "a", pinned: false },
  { id: 2, path: "/work/b", name: "b", pinned: false },
];
const commit = (oid: string) => ({ oid, summary: oid, author: "A", timestamp: 1, lane: 0, edges: [], activeLanes: [true] });
const saved = () => JSON.parse(localStorage.getItem(KEY) ?? "null");
const store = (s: object) => localStorage.setItem(KEY, JSON.stringify(s));

describe("useSessionRestore", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(tauri.invokeListRepos).mockResolvedValue(repos);
    vi.mocked(tauri.invokeGetBranches).mockResolvedValue({ branches: [], headDetached: false, headOid: null });
    vi.mocked(tauri.invokeGetTags).mockResolvedValue([]);
    vi.mocked(tauri.invokeGetCommitGraph).mockResolvedValue([commit("c1"), commit("c2")]);
    useWorkspaceStore.setState({ repos: [], activeRepoId: null, commits: [], branches: [], tags: [] } as never);
    useViewStore.setState({ activeView: "repo" });
    useUiStore.setState({ selectedCommitOid: null } as never);
  });

  const mount = () => renderHook(() => useSessionRestore());

  it("reselects the last repo, view and commit", async () => {
    store({ repoPath: "/work/b", view: "compare", selectedCommitOid: "c2" });
    mount();
    await waitFor(() => expect(useWorkspaceStore.getState().activeRepoId).toBe(2));
    await waitFor(() => expect(useUiStore.getState().selectedCommitOid).toBe("c2"));
    expect(useViewStore.getState().activeView).toBe("compare");
  });

  it("skips a commit that is not in the loaded graph, without touching the rest", async () => {
    store({ repoPath: "/work/a", view: "pulls", selectedCommitOid: "gone" });
    mount();
    await waitFor(() => expect(useWorkspaceStore.getState().activeRepoId).toBe(1));
    expect(useUiStore.getState().selectedCommitOid).toBeNull();
    expect(useViewStore.getState().activeView).toBe("pulls");
  });

  it("restores nothing and clears the entry when the saved repo is no longer there", async () => {
    store({ repoPath: "/work/removed", view: "pulls", selectedCommitOid: "c1" });
    mount();
    await waitFor(() => expect(tauri.invokeListRepos).toHaveBeenCalled());
    await waitFor(() => expect(saved().repoPath).toBeNull());
    expect(useWorkspaceStore.getState().activeRepoId).toBeNull();
    expect(useViewStore.getState().activeView).toBe("repo");
  });

  it("does nothing without a saved session", async () => {
    mount();
    await waitFor(() => expect(tauri.invokeListRepos).toHaveBeenCalled());
    expect(useWorkspaceStore.getState().activeRepoId).toBeNull();
  });

  it("does not override a repo you picked while the list was still loading", async () => {
    store({ repoPath: "/work/b", view: "compare", selectedCommitOid: "c1" });
    let resolveList!: (v: typeof repos) => void;
    vi.mocked(tauri.invokeListRepos).mockReturnValue(new Promise((r) => (resolveList = r)));
    mount();
    act(() => useWorkspaceStore.setState({ activeRepoId: 1 } as never));
    await act(async () => resolveList(repos));
    await new Promise((r) => setTimeout(r, 20));
    expect(useWorkspaceStore.getState().activeRepoId).toBe(1);
    expect(useViewStore.getState().activeView).toBe("repo");
  });

  it("does not apply the view or commit if you switched repos while restoring", async () => {
    store({ repoPath: "/work/a", view: "compare", selectedCommitOid: "c1" });
    let resolveGraph!: (v: ReturnType<typeof commit>[]) => void;
    vi.mocked(tauri.invokeGetCommitGraph).mockReturnValue(new Promise((r) => (resolveGraph = r)));
    mount();
    await waitFor(() => expect(useWorkspaceStore.getState().activeRepoId).toBe(1));
    act(() => useWorkspaceStore.setState({ activeRepoId: 2 } as never));
    await act(async () => resolveGraph([commit("c1")]));
    await new Promise((r) => setTimeout(r, 20));
    expect(useViewStore.getState().activeView).toBe("repo");
    expect(useUiStore.getState().selectedCommitOid).toBeNull();
  });

  it("does not overwrite the saved session while it is still restoring", async () => {
    store({ repoPath: "/work/a", view: "pulls", selectedCommitOid: "c1" });
    vi.mocked(tauri.invokeListRepos).mockReturnValue(new Promise(() => {}));
    mount();
    act(() => useViewStore.getState().setActiveView("actions"));
    expect(saved()).toEqual({ repoPath: "/work/a", view: "pulls", selectedCommitOid: "c1" });
  });

  it("saves repo, view and commit as they change once restored", async () => {
    mount();
    await waitFor(() => expect(tauri.invokeListRepos).toHaveBeenCalled());
    await waitFor(() => expect(saved()).not.toBeNull());

    await act(async () => { await useWorkspaceStore.getState().setActiveRepo(2); });
    act(() => useViewStore.getState().setActiveView("actions"));
    act(() => useUiStore.getState().selectCommit("c2"));

    expect(saved()).toEqual({ repoPath: "/work/b", view: "actions", selectedCommitOid: "c2" });
  });

  it("stops saving after unmount", async () => {
    const { unmount } = mount();
    await waitFor(() => expect(saved()).not.toBeNull());
    unmount();
    act(() => useViewStore.getState().setActiveView("pulls"));
    expect(saved().view).not.toBe("pulls");
  });

  it("ignores corrupt storage, an unknown view and unreadable storage", async () => {
    localStorage.setItem(KEY, "{nope");
    mount();
    await waitFor(() => expect(tauri.invokeListRepos).toHaveBeenCalled());
    expect(useWorkspaceStore.getState().activeRepoId).toBeNull();

    store({ repoPath: "/work/a", view: "weird", selectedCommitOid: null });
    mount();
    await waitFor(() => expect(useWorkspaceStore.getState().activeRepoId).toBe(1));
    expect(useViewStore.getState().activeView).toBe("repo");

    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => mount()).not.toThrow();
    spy.mockRestore();
  });

  it("survives the repo list failing to load", async () => {
    store({ repoPath: "/work/a", view: "pulls", selectedCommitOid: null });
    vi.mocked(tauri.invokeListRepos).mockRejectedValue("db error");
    mount();
    await new Promise((r) => setTimeout(r, 20));
    expect(useWorkspaceStore.getState().activeRepoId).toBeNull();
  });

  it("restores the view and commit under StrictMode's double effect, and keeps the saved session", async () => {
    store({ repoPath: "/work/b", view: "compare", selectedCommitOid: "c2" });
    renderHook(() => useSessionRestore(), { wrapper: StrictMode });
    await waitFor(() => expect(useUiStore.getState().selectedCommitOid).toBe("c2"));
    expect(useWorkspaceStore.getState().activeRepoId).toBe(2);
    expect(useViewStore.getState().activeView).toBe("compare");
    await waitFor(() => expect(saved()).toEqual({ repoPath: "/work/b", view: "compare", selectedCommitOid: "c2" }));
  });

  it("a failed repo-list load leaves the saved session alone, even after other state changes", async () => {
    const original = { repoPath: "/work/a", view: "pulls", selectedCommitOid: "c1" };
    store(original);
    vi.mocked(tauri.invokeListRepos).mockRejectedValue("db error");
    mount();
    await new Promise((r) => setTimeout(r, 20));

    act(() => useViewStore.getState().setActiveView("actions"));
    act(() => useUiStore.getState().setDrawerTab("checks"));
    act(() => useWorkspaceStore.setState({ isLoadingMoreCommits: true } as never));

    expect(saved()).toEqual(original);
  });

  it("after a failed load it resumes saving once you pick a repo", async () => {
    store({ repoPath: "/work/a", view: "pulls", selectedCommitOid: null });
    vi.mocked(tauri.invokeListRepos).mockRejectedValue("db error");
    mount();
    await new Promise((r) => setTimeout(r, 20));
    act(() => useWorkspaceStore.setState({ repos, activeRepoId: 2 } as never));
    expect(saved().repoPath).toBe("/work/b");
  });
});
