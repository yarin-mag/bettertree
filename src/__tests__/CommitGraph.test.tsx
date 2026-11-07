import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useSearchStore } from "../store/searchStore";
import { useUiStore } from "../store/uiStore";
import { usePinnedStore } from "../store/pinnedStore";
import { useGithubStore } from "../store/githubStore";
import { useCiStatusStore } from "../store/ciStatusStore";
import CommitGraph from "../components/CommitGraph";

describe("CommitGraph", () => {
  beforeEach(() => {
    localStorage.clear();
    usePinnedStore.setState({ pinnedCommits: [], pinnedPrs: [] });
    useSearchStore.setState({ query: "" });
    useWorkspaceStore.setState({
      hasMoreCommits: false,
      isLoadingMoreCommits: false,
      repos: [],
      activeRepoId: null,
      branches: [],
      tags: [],
      commits: [
        {
          oid: "c2",
          summary: "second commit",
          author: "Test User",
          timestamp: 200,
          lane: 0,
          edges: [{ parentOid: "c1", parentLane: 0 }],
          activeLanes: [true],
        },
        {
          oid: "c1",
          summary: "first commit",
          author: "Test User",
          timestamp: 100,
          lane: 0,
          edges: [],
          activeLanes: [false],
        },
      ],
    });
  });

  it("renders one row per commit with its summary and lane", () => {
    render(<CommitGraph />);
    const rows = screen.getAllByTestId("commit-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("second commit")).toBeInTheDocument();
    expect(screen.getByText("first commit")).toBeInTheDocument();
  });

  it("positions each row's dot according to its lane", () => {
    render(<CommitGraph />);
    const dots = screen.getAllByTestId("commit-dot");
    expect(dots[0]).toHaveAttribute("cx", "12");
    expect(dots[1]).toHaveAttribute("cx", "12");
  });

  it("draws a curved connector for a merge commit with two different-lane edges", () => {
    useWorkspaceStore.setState({
      commits: [
        {
          oid: "m1",
          summary: "merge feature",
          author: "Test User",
          timestamp: 300,
          lane: 0,
          edges: [
            { parentOid: "c2", parentLane: 0 },
            { parentOid: "f1", parentLane: 1 },
          ],
          activeLanes: [true, true],
        },
      ],
    });
    render(<CommitGraph />);
    const paths = document.querySelectorAll("path");
    // One curved <path> for the cross-lane edge (lane 0 -> lane 1); the
    // same-lane edge (0 -> 0) is a straight line, not a path.
    expect(paths.length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to a plain single-color dot when a search query is filtering the list", () => {
    useSearchStore.setState({ query: "second" });
    render(<CommitGraph />);
    const dot = screen.getByTestId("commit-dot");
    expect(dot).toHaveAttribute("fill", "var(--accent)");
    expect(dot).toHaveAttribute("cx", "12");
  });

  it("shows a Load more commits button when hasMoreCommits is true", () => {
    useWorkspaceStore.setState({ hasMoreCommits: true });
    render(<CommitGraph />);
    expect(screen.getByRole("button", { name: /Load more commits/ })).toBeInTheDocument();
  });

  it("hides the Load more commits button when hasMoreCommits is false", () => {
    useWorkspaceStore.setState({ hasMoreCommits: false });
    render(<CommitGraph />);
    expect(screen.queryByRole("button", { name: /Load more commits/ })).not.toBeInTheDocument();
  });

  it("calls loadMoreCommits when the button is clicked", async () => {
    const loadMoreCommits = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({ hasMoreCommits: true, loadMoreCommits });
    render(<CommitGraph />);
    fireEvent.click(screen.getByRole("button", { name: /Load more commits/ }));
    expect(loadMoreCommits).toHaveBeenCalled();
  });

  it("shows a loading state on the button while isLoadingMoreCommits is true", () => {
    useWorkspaceStore.setState({ hasMoreCommits: true, isLoadingMoreCommits: true });
    render(<CommitGraph />);
    const button = screen.getByRole("button", { name: /Loading/ });
    expect(button).toBeDisabled();
  });

  it("shows each commit's short SHA", () => {
    render(<CommitGraph />);
    expect(screen.getByText("c2")).toBeInTheDocument();
  });

  it("shows branch and tag badges for a commit's target oid", () => {
    useWorkspaceStore.setState({
      branches: [{ name: "main", isRemote: false, isHead: true, targetOid: "c2" }],
      tags: [{ name: "v1.0", targetOid: "c1" }],
    });
    render(<CommitGraph />);
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("v1.0")).toBeInTheDocument();
  });

  it("matches by author, not just summary, when filtering", () => {
    useWorkspaceStore.setState({
      commits: [
        { oid: "c1", summary: "unrelated", author: "Alice", timestamp: 1, lane: 0, edges: [], activeLanes: [] },
        { oid: "c2", summary: "also unrelated", author: "Bob", timestamp: 2, lane: 0, edges: [], activeLanes: [] },
      ],
    });
    useSearchStore.setState({ query: "Alice" });
    render(<CommitGraph />);
    expect(screen.getByText("unrelated")).toBeInTheDocument();
    expect(screen.queryByText("also unrelated")).not.toBeInTheDocument();
  });

  it("matches by SHA prefix when filtering", () => {
    useSearchStore.setState({ query: "c2" });
    render(<CommitGraph />);
    expect(screen.getByText("second commit")).toBeInTheDocument();
    expect(screen.queryByText("first commit")).not.toBeInTheDocument();
  });

  it("ArrowDown/ArrowUp moves the active row and Enter selects it", () => {
    const selectCommit = vi.fn();
    useUiStore.setState({ selectCommit });
    render(<CommitGraph />);
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(selectCommit).toHaveBeenCalledWith("c1");
  });

  it("clicking the pin star toggles the commit in pinnedStore", () => {
    useWorkspaceStore.setState({ repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }], activeRepoId: 1 });
    render(<CommitGraph />);
    const star = screen.getAllByTitle("Pin commit")[0];
    fireEvent.click(star);
    expect(usePinnedStore.getState().isCommitPinned("/tmp/a", "c2")).toBe(true);
  });
  describe("CI status requests", () => {
    const original = useCiStatusStore.getState().request;
    afterEach(() => {
      cleanup(); // unmount before resetting stores so no update hits a mounted tree
      useCiStatusStore.setState({ request: original });
      useGithubStore.setState({ status: null });
    });

    it("requests the visible oids once GitHub is available", () => {
      const request = vi.fn();
      useCiStatusStore.setState({ request });
      useWorkspaceStore.setState({ repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }], activeRepoId: 1 });
      useGithubStore.setState({ status: { available: true, owner: "o", repo: "r", reason: null } });
      render(<CommitGraph />);
      expect(request).toHaveBeenCalledWith("/tmp/a", ["c2", "c1"]);
    });

    it("does not request when GitHub is unavailable", () => {
      const request = vi.fn();
      useCiStatusStore.setState({ request });
      useWorkspaceStore.setState({ repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }], activeRepoId: 1 });
      useGithubStore.setState({ status: { available: false, owner: null, repo: null, reason: "no gh" } });
      render(<CommitGraph />);
      expect(request).not.toHaveBeenCalled();
    });
  });
});
