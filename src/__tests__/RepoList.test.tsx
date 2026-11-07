import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../lib/tauri", () => ({
  invokeListRepos: vi.fn().mockResolvedValue([]),
  invokeAddRepo: vi.fn(),
  invokeRemoveRepo: vi.fn().mockResolvedValue(undefined),
  invokeGetBranches: vi.fn(),
  invokeGetTags: vi.fn(),
  invokeGetCommitGraph: vi.fn(),
  invokeEnsureSearchIndex: vi.fn().mockResolvedValue(undefined),
  invokeSwitchBranch: vi.fn(),
  invokeCheckoutTag: vi.fn(),
  invokeGetGithubStatus: vi.fn().mockResolvedValue({ available: false, owner: null, repo: null, reason: "not checked" }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import RepoList from "../components/RepoList";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useRecentReposStore } from "../store/recentReposStore";
import * as tauriLib from "../lib/tauri";
import { useSettingsModalStore } from "../store/settingsModalStore";

describe("RepoList", () => {
  beforeEach(() => {
    localStorage.clear();
    useRecentReposStore.setState({ recentlyClosed: [] });
    useWorkspaceStore.setState({
      repos: [
        { id: 1, path: "/tmp/a", name: "a", pinned: false },
        { id: 2, path: "/tmp/b", name: "b", pinned: false },
      ],
      activeRepoId: 1,
    });
    (tauriLib.invokeListRepos as any).mockResolvedValue(useWorkspaceStore.getState().repos);
  });

  it("does not show an 'Open recent' toggle when nothing has been closed", () => {
    render(<RepoList />);
    expect(screen.queryByTitle("Open recent")).not.toBeInTheDocument();
  });

  it("closing a repo removes it from the list and calls invokeRemoveRepo", async () => {
    render(<RepoList />);
    fireEvent.click(screen.getAllByTitle("Close repo")[0]);
    await waitFor(() => expect(tauriLib.invokeRemoveRepo).toHaveBeenCalled());
  });

  it("shows a 'Recently closed' entry after closing a repo, and reopening it calls invokeAddRepo", async () => {
    render(<RepoList />);
    const closeButtons = screen.getAllByTitle("Close repo");
    fireEvent.click(closeButtons[0]);
    await waitFor(() => expect(tauriLib.invokeRemoveRepo).toHaveBeenCalledWith(1));

    fireEvent.click(screen.getByTitle("Open recent"));
    expect(screen.getByText("Recently closed")).toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();

    (tauriLib.invokeAddRepo as any).mockResolvedValue({ id: 3, path: "/tmp/a", name: "a", pinned: false });
    fireEvent.click(screen.getByText("a"));
    await waitFor(() => expect(tauriLib.invokeAddRepo).toHaveBeenCalledWith("/tmp/a"));
    expect(useRecentReposStore.getState().recentlyClosed).toHaveLength(0);
  });

  it("right-click → Repo settings… opens settings for that repo", () => {
    useSettingsModalStore.getState().close();
    render(<RepoList />);

    fireEvent.contextMenu(screen.getByText("a"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Repo settings…" }));

    expect(useSettingsModalStore.getState()).toMatchObject({ isOpen: true, repoPath: "/tmp/a" });
  });
});
