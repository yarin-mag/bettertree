import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useGithubStore } from "../store/githubStore";
import { useUiStore } from "../store/uiStore";
import { useViewStore } from "../store/viewStore";
import { usePinnedStore } from "../store/pinnedStore";
import { useRecentReposStore } from "../store/recentReposStore";
import CommandPalette from "../components/CommandPalette";

vi.mock("../lib/tauri", () => ({
  invokeListRepos: vi.fn(),
  invokeAddRepo: vi.fn(),
  invokeRemoveRepo: vi.fn(),
  invokeGetBranches: vi.fn().mockResolvedValue({ branches: [], headDetached: false, headOid: null }),
  invokeGetTags: vi.fn().mockResolvedValue([]),
  invokeGetCommitGraph: vi.fn().mockResolvedValue([]),
  invokeEnsureSearchIndex: vi.fn().mockResolvedValue(undefined),
  invokeSwitchBranch: vi.fn().mockResolvedValue(undefined),
  invokeCheckoutTag: vi.fn(),
  invokeGetGithubStatus: vi.fn().mockResolvedValue({ available: false, owner: null, repo: null, reason: "not checked" }),
}));

import * as tauriLib from "../lib/tauri";

function openPalette() {
  fireEvent.keyDown(window, { key: "k", metaKey: true });
}

describe("CommandPalette", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useWorkspaceStore.setState({
      repos: [
        { id: 1, path: "/tmp/a", name: "repo-a", pinned: false },
        { id: 2, path: "/tmp/b", name: "repo-b", pinned: false },
      ],
      activeRepoId: 1,
      branches: [
        { name: "main", isRemote: false, isHead: true, targetOid: "x" },
        { name: "feature", isRemote: false, isHead: false, targetOid: "y" },
      ],
    });
    useGithubStore.setState({ status: null, pullRequests: [] });
    useUiStore.setState({ selectedCommitOid: null });
    useViewStore.setState({ activeView: "repo" });
    usePinnedStore.setState({ pinnedCommits: [], pinnedPrs: [] });
    useRecentReposStore.setState({ recentlyClosed: [] });
  });

  it("is closed by default and opens on Cmd+K", () => {
    render(<CommandPalette />);
    expect(screen.queryByPlaceholderText(/Jump to/)).not.toBeInTheDocument();
    openPalette();
    expect(screen.getByPlaceholderText(/Jump to/)).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    render(<CommandPalette />);
    openPalette();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByPlaceholderText(/Jump to/)).not.toBeInTheDocument();
  });

  it("lists repos and branches of the active repo", () => {
    render(<CommandPalette />);
    openPalette();
    expect(screen.getByText("repo-a")).toBeInTheDocument();
    expect(screen.getByText("repo-b")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("feature")).toBeInTheDocument();
  });

  it("filters items by typed text", () => {
    render(<CommandPalette />);
    openPalette();
    fireEvent.change(screen.getByPlaceholderText(/Jump to/), { target: { value: "feature" } });
    expect(screen.getByText("feature")).toBeInTheDocument();
    expect(screen.queryByText("main")).not.toBeInTheDocument();
    expect(screen.queryByText("repo-a")).not.toBeInTheDocument();
  });

  it("clicking a repo switches to it and closes the palette", async () => {
    render(<CommandPalette />);
    openPalette();
    fireEvent.click(screen.getByText("repo-b"));
    await waitFor(() => expect(useWorkspaceStore.getState().activeRepoId).toBe(2));
    expect(screen.queryByPlaceholderText(/Jump to/)).not.toBeInTheDocument();
  });

  it("clicking a branch switches to it", async () => {
    render(<CommandPalette />);
    openPalette();
    fireEvent.click(screen.getByText("feature"));
    await waitFor(() =>
      expect(tauriLib.invokeSwitchBranch).toHaveBeenCalledWith("/tmp/a", "feature", false)
    );
  });

  it("clicking a pinned commit switches repo if needed and selects it", async () => {
    usePinnedStore.getState().toggleCommit({ repoPath: "/tmp/b", oid: "deadbeef", summary: "fix thing" });
    render(<CommandPalette />);
    openPalette();
    fireEvent.click(screen.getByText("fix thing"));
    await waitFor(() => expect(useWorkspaceStore.getState().activeRepoId).toBe(2));
    expect(useUiStore.getState().selectedCommitOid).toBe("deadbeef");
  });

  it("only shows pinned PRs that match the active repo's github owner/repo", () => {
    usePinnedStore.getState().togglePr({ owner: "acme", repo: "widgets", number: 1, title: "in repo" });
    usePinnedStore.getState().togglePr({ owner: "other", repo: "thing", number: 2, title: "other repo" });
    useGithubStore.setState({ status: { available: true, owner: "acme", repo: "widgets", reason: null } });
    render(<CommandPalette />);
    openPalette();
    expect(screen.getByText("#1 in repo")).toBeInTheDocument();
    expect(screen.queryByText("#2 other repo")).not.toBeInTheDocument();
  });

  it("lists recently-closed repos and reopens them on click", async () => {
    useRecentReposStore.getState().addClosed({ path: "/tmp/c", name: "repo-c" });
    (tauriLib.invokeAddRepo as any).mockResolvedValue({ id: 3, path: "/tmp/c", name: "repo-c", pinned: false });
    render(<CommandPalette />);
    openPalette();
    fireEvent.click(screen.getByText("repo-c"));
    await waitFor(() => expect(tauriLib.invokeAddRepo).toHaveBeenCalledWith("/tmp/c"));
    expect(useRecentReposStore.getState().recentlyClosed).toHaveLength(0);
  });

  it("shows No matches when nothing matches the filter", () => {
    render(<CommandPalette />);
    openPalette();
    fireEvent.change(screen.getByPlaceholderText(/Jump to/), { target: { value: "zzzzzz" } });
    expect(screen.getByText("No matches")).toBeInTheDocument();
  });
});
