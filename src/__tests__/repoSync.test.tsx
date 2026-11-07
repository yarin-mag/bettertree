import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("../lib/tauri", () => ({
  invokeListRepos: vi.fn(),
  invokeAddRepo: vi.fn(),
  invokeRemoveRepo: vi.fn(),
  invokeGetBranches: vi.fn(),
  invokeGetTags: vi.fn().mockResolvedValue([]),
  invokeGetCommitGraph: vi.fn().mockResolvedValue([]),
  invokeEnsureSearchIndex: vi.fn().mockResolvedValue(undefined),
  invokeSwitchBranch: vi.fn(),
  invokeCheckoutTag: vi.fn(),
  invokeGetGithubStatus: vi.fn().mockResolvedValue({ available: false, owner: null, repo: null, reason: "" }),
  invokeFetchRemote: vi.fn(),
}));

import * as tauri from "../lib/tauri";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useToastStore } from "../store/toastStore";
import { useRepoSync, REPO_SYNC_THROTTLE_MS } from "../hooks/useRepoSync";
import { useAutoFetch, AUTO_FETCH_INTERVAL_MS } from "../hooks/useAutoFetch";

const branch = (name: string, isHead: boolean) => ({ name, isRemote: false, isHead, targetOid: name + "-oid" });
const result = (head: string, extra: Partial<{ headDetached: boolean }> = {}) => ({
  branches: [branch("main", head === "main"), branch("feature", head === "feature")],
  headDetached: false,
  headOid: head + "-oid",
  ...extra,
});

function seed(head = "main") {
  const r = result(head);
  useWorkspaceStore.setState({
    repos: [{ id: 1, path: "/r", name: "r", pinned: false }],
    activeRepoId: 1,
    branches: r.branches,
    headDetached: r.headDetached,
    headOid: r.headOid,
    tags: [],
    commits: [],
  } as never);
}

const currentBranch = () => useWorkspaceStore.getState().branches.find((b) => b.isHead)?.name;

describe("syncActiveRepo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tauri.invokeGetTags).mockResolvedValue([]);
    vi.mocked(tauri.invokeGetCommitGraph).mockResolvedValue([]);
    vi.mocked(tauri.invokeEnsureSearchIndex).mockResolvedValue(undefined);
    vi.mocked(tauri.invokeGetGithubStatus).mockResolvedValue({ available: false, owner: null, repo: null, reason: "" } as never);
    seed("main");
  });

  it("does nothing when the repo is unchanged", async () => {
    vi.mocked(tauri.invokeGetBranches).mockResolvedValue(result("main"));
    expect(await useWorkspaceStore.getState().syncActiveRepo("/r")).toBe(false);
    expect(tauri.invokeGetCommitGraph).not.toHaveBeenCalled();
  });

  it("picks up a branch switched outside the app", async () => {
    vi.mocked(tauri.invokeGetBranches).mockResolvedValue(result("feature"));
    expect(await useWorkspaceStore.getState().syncActiveRepo("/r")).toBe(true);
    expect(currentBranch()).toBe("feature");
    expect(useWorkspaceStore.getState().headOid).toBe("feature-oid");
    expect(tauri.invokeGetCommitGraph).toHaveBeenCalled();
  });

  it("picks up a switch to a detached HEAD at the same commit", async () => {
    vi.mocked(tauri.invokeGetBranches).mockResolvedValue({ ...result("main"), headDetached: true });
    expect(await useWorkspaceStore.getState().syncActiveRepo("/r")).toBe(true);
    expect(useWorkspaceStore.getState().headDetached).toBe(true);
  });

  it("ignores a result for a repo that is no longer the active one", async () => {
    vi.mocked(tauri.invokeGetBranches).mockResolvedValue(result("feature"));
    expect(await useWorkspaceStore.getState().syncActiveRepo("/other")).toBe(false);
    expect(currentBranch()).toBe("main");
  });

  it("does nothing without an active repo", async () => {
    useWorkspaceStore.setState({ activeRepoId: null } as never);
    expect(await useWorkspaceStore.getState().syncActiveRepo("/r")).toBe(false);
    expect(tauri.invokeGetBranches).not.toHaveBeenCalled();
  });
});

describe("useRepoSync (refresh when you come back to the window)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-08T10:00:00Z"));
    vi.mocked(tauri.invokeGetTags).mockResolvedValue([]);
    vi.mocked(tauri.invokeGetCommitGraph).mockResolvedValue([]);
    vi.mocked(tauri.invokeEnsureSearchIndex).mockResolvedValue(undefined);
    vi.mocked(tauri.invokeGetGithubStatus).mockResolvedValue({ available: false, owner: null, repo: null, reason: "" } as never);
    vi.mocked(tauri.invokeGetBranches).mockResolvedValue(result("feature"));
    seed("main");
  });
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

  it("re-reads the repo when the window gains focus", async () => {
    renderHook(() => useRepoSync("/r"));
    act(() => window.dispatchEvent(new Event("focus")));
    await flush();
    expect(currentBranch()).toBe("feature");
  });

  it("re-reads the repo when the page becomes visible again", async () => {
    renderHook(() => useRepoSync("/r"));
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await flush();
    expect(currentBranch()).toBe("feature");
  });

  it("does not sync while the page is hidden", async () => {
    renderHook(() => useRepoSync("/r"));
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await flush();
    expect(tauri.invokeGetBranches).not.toHaveBeenCalled();
  });

  it("ignores a burst of events but syncs again after the throttle window", async () => {
    // unchanged repo: each sync is exactly one read
    vi.mocked(tauri.invokeGetBranches).mockResolvedValue(result("main"));
    renderHook(() => useRepoSync("/r"));
    act(() => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
    });
    await flush();
    expect(tauri.invokeGetBranches).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(REPO_SYNC_THROTTLE_MS + 1); });
    act(() => window.dispatchEvent(new Event("focus")));
    await flush();
    expect(tauri.invokeGetBranches).toHaveBeenCalledTimes(2);
  });

  it("does nothing without a repo and stops listening on unmount", async () => {
    renderHook(() => useRepoSync(undefined));
    act(() => window.dispatchEvent(new Event("focus")));
    await flush();
    expect(tauri.invokeGetBranches).not.toHaveBeenCalled();

    const { unmount } = renderHook(() => useRepoSync("/r"));
    unmount();
    act(() => window.dispatchEvent(new Event("focus")));
    await flush();
    expect(tauri.invokeGetBranches).not.toHaveBeenCalled();
  });

  it("swallows a failing read instead of surfacing an unhandled rejection", async () => {
    vi.mocked(tauri.invokeGetBranches).mockRejectedValue("repo gone");
    renderHook(() => useRepoSync("/r"));
    act(() => window.dispatchEvent(new Event("focus")));
    await flush();
    expect(currentBranch()).toBe("main");
  });
});

describe("background poll no longer depends on the network", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
    vi.mocked(tauri.invokeGetTags).mockResolvedValue([]);
    vi.mocked(tauri.invokeGetCommitGraph).mockResolvedValue([]);
    vi.mocked(tauri.invokeEnsureSearchIndex).mockResolvedValue(undefined);
    vi.mocked(tauri.invokeGetGithubStatus).mockResolvedValue({ available: false, owner: null, repo: null, reason: "" } as never);
    seed("main");
  });
  afterEach(() => vi.useRealTimers());

  it("updates the current branch on the poll even when the fetch fails", async () => {
    vi.mocked(tauri.invokeFetchRemote).mockRejectedValue("network unreachable");
    vi.mocked(tauri.invokeGetBranches).mockResolvedValue(result("feature"));
    renderHook(() => useAutoFetch(1, "/r"));

    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_FETCH_INTERVAL_MS + 10); });

    expect(tauri.invokeFetchRemote).toHaveBeenCalled();
    expect(currentBranch()).toBe("feature");
  });

  it("still picks up refs the fetch brought in", async () => {
    vi.mocked(tauri.invokeFetchRemote).mockResolvedValue(undefined);
    const withNew = { ...result("main"), branches: [...result("main").branches, branch("new-remote", false)] };
    vi.mocked(tauri.invokeGetBranches)
      .mockResolvedValueOnce(result("main")) // local check before the fetch: unchanged
      .mockResolvedValue(withNew); // check after the fetch, and the reload it triggers
    renderHook(() => useAutoFetch(1, "/r"));

    await act(async () => { await vi.advanceTimersByTimeAsync(AUTO_FETCH_INTERVAL_MS + 10); });

    expect(useWorkspaceStore.getState().branches.map((b) => b.name)).toContain("new-remote");
  });
});
