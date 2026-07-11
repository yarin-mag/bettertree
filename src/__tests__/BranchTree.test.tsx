import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import BranchTree from "../components/BranchTree";

describe("BranchTree", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
      branches: [
        { name: "main", isRemote: false, isHead: true, targetOid: "a" },
        { name: "origin/main", isRemote: true, isHead: false, targetOid: "a" },
      ],
      tags: [{ name: "v1.0", targetOid: "a" }],
      // Default no-op so tests that don't care about switchBranch (the
      // three pre-existing tests above) never see a mock left over from a
      // different test — each double-click test below still overrides this
      // with its own vi.fn() right before use.
      switchBranch: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("renders local branches, remote branches, and tags in separate groups", () => {
    render(<BranchTree />);
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("origin/main")).toBeInTheDocument();
    expect(screen.getByText("v1.0")).toBeInTheDocument();
  });

  it("marks the HEAD branch", () => {
    render(<BranchTree />);
    expect(screen.getByText("main").closest("[data-head]")).toHaveAttribute("data-head", "true");
  });

  it("hides branches that don't match the search query", async () => {
    const { useSearchStore } = await import("../store/searchStore");
    render(<BranchTree />);
    act(() => {
      useSearchStore.setState({ query: "orig" });
    });
    expect(screen.queryByText("main")).not.toBeInTheDocument();
    expect(screen.getByText("origin/main")).toBeInTheDocument();
    act(() => {
      useSearchStore.setState({ query: "" });
    });
  });

  it("double-clicking a local branch switches to it", async () => {
    const switchBranch = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({ switchBranch });

    render(<BranchTree />);
    fireEvent.doubleClick(screen.getByText("main"));

    await waitFor(() => {
      expect(switchBranch).toHaveBeenCalledWith("/tmp/a", "main", false);
    });
  });

  it("double-clicking a remote branch switches with isRemote true", async () => {
    const switchBranch = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({ switchBranch });

    render(<BranchTree />);
    fireEvent.doubleClick(screen.getByText("origin/main"));

    await waitFor(() => {
      expect(switchBranch).toHaveBeenCalledWith("/tmp/a", "origin/main", true);
    });
  });

  it("shows an inline error when switching fails", async () => {
    const switchBranch = vi.fn().mockRejectedValue("cannot switch branches with uncommitted changes");
    useWorkspaceStore.setState({ switchBranch });

    render(<BranchTree />);
    fireEvent.doubleClick(screen.getByText("main"));

    await waitFor(() => {
      expect(screen.getByText("cannot switch branches with uncommitted changes")).toBeInTheDocument();
    });
  });
});
