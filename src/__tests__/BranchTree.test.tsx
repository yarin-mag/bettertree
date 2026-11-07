import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, cleanup, act, fireEvent, waitFor } from "@testing-library/react";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useBranchScopeStore } from "../store/branchScopeStore";
import { useCiStatusStore } from "../store/ciStatusStore";
import { useGithubStore } from "../store/githubStore";
import BranchTree from "../components/BranchTree";

describe("BranchTree", () => {
  beforeEach(() => {
    useBranchScopeStore.setState({ showRemoteBranches: true });
    useWorkspaceStore.setState({
      repos: [{ id: 1, path: "/tmp/a", name: "a", pinned: false }],
      activeRepoId: 1,
      branches: [
        { name: "main", isRemote: false, isHead: true, targetOid: "a" },
        { name: "origin/main", isRemote: true, isHead: false, targetOid: "a" },
      ],
      tags: [{ name: "v1.0", targetOid: "a" }],
      headDetached: false,
      headOid: null,
      // Default no-op so tests that don't care about switchBranch (the
      // three pre-existing tests above) never see a mock left over from a
      // different test — each double-click test below still overrides this
      // with its own vi.fn() right before use.
      switchBranch: vi.fn().mockResolvedValue(undefined),
      checkoutTag: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("renders local branches, remote branches, and tags in separate groups", () => {
    render(<BranchTree />);
    fireEvent.click(screen.getByText("Remotes (1)"));
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("origin/main")).toBeInTheDocument();
    expect(screen.getByText("v1.0")).toBeInTheDocument();
  });

  it("hides remote branches by default", () => {
    render(<BranchTree />);
    expect(screen.queryByText("origin/main")).not.toBeInTheDocument();
    expect(screen.getByText("Remotes (1)")).toBeInTheDocument();
  });

  it("shows remote branches after clicking the Remotes header", () => {
    render(<BranchTree />);
    fireEvent.click(screen.getByText("Remotes (1)"));
    expect(screen.getByText("origin/main")).toBeInTheDocument();
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
    fireEvent.click(screen.getByText(/Remotes/));
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
    fireEvent.click(screen.getByText("Remotes (1)"));
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

  it("shows a detached-HEAD badge naming the matching tag", () => {
    useWorkspaceStore.setState({ headDetached: true, headOid: "a" });
    render(<BranchTree />);
    expect(screen.getByText("Detached @ v1.0")).toBeInTheDocument();
  });

  it("shows a detached-HEAD badge with a short oid when no tag matches", () => {
    useWorkspaceStore.setState({ headDetached: true, headOid: "0123456789abcdef" });
    render(<BranchTree />);
    expect(screen.getByText("Detached @ 0123456")).toBeInTheDocument();
  });

  it("shows no detached-HEAD badge when HEAD is on a branch", () => {
    render(<BranchTree />);
    expect(screen.queryByText(/Detached @/)).not.toBeInTheDocument();
  });

  it("double-clicking a tag checks it out", async () => {
    const checkoutTag = vi.fn().mockResolvedValue(undefined);
    useWorkspaceStore.setState({ checkoutTag });

    render(<BranchTree />);
    fireEvent.doubleClick(screen.getByText("v1.0"));

    await waitFor(() => {
      expect(checkoutTag).toHaveBeenCalledWith("/tmp/a", "v1.0");
    });
  });

  it("shows an inline error when tag checkout fails", async () => {
    const checkoutTag = vi.fn().mockRejectedValue("cannot checkout a tag with uncommitted changes");
    useWorkspaceStore.setState({ checkoutTag });

    render(<BranchTree />);
    fireEvent.doubleClick(screen.getByText("v1.0"));

    await waitFor(() => {
      expect(screen.getByText("cannot checkout a tag with uncommitted changes")).toBeInTheDocument();
    });
  });

  it("ranks local branches with substring matches before fuzzy-only matches", async () => {
    const { useSearchStore } = await import("../store/searchStore");
    useWorkspaceStore.setState({
      branches: [
        { name: "moxbxilxe", isRemote: false, isHead: false, targetOid: "a" },
        { name: "mobile", isRemote: false, isHead: false, targetOid: "a" },
        { name: "release/mobile-v2", isRemote: false, isHead: false, targetOid: "a" },
      ],
    });
    const { container } = render(<BranchTree />);
    act(() => {
      useSearchStore.setState({ query: "mobile" });
    });
    const names = Array.from(container.querySelectorAll("[data-head] span")).map((el) => el.textContent);
    expect(names).toEqual(["mobile", "release/mobile-v2", "moxbxilxe"]);
    act(() => {
      useSearchStore.setState({ query: "" });
    });
  });

  it("shows the Show remotes checkbox checked by default and unchecking it hides the Remotes section entirely", () => {
    render(<BranchTree />);
    const checkbox = screen.getByRole("checkbox", { name: "Show remotes" });
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);

    expect(useBranchScopeStore.getState().showRemoteBranches).toBe(false);
  });

  it("does not render the Remotes section at all when showRemoteBranches is false", () => {
    useBranchScopeStore.setState({ showRemoteBranches: false });
    render(<BranchTree />);
    expect(screen.queryByText(/Remotes/)).not.toBeInTheDocument();
    expect(screen.queryByText("origin/main")).not.toBeInTheDocument();
    // Local branches and tags are unaffected.
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("v1.0")).toBeInTheDocument();
  });

  it("shows a divider between Branches/Remotes and between Remotes/Tags when remotes are shown", () => {
    render(<BranchTree />);
    expect(screen.getAllByTestId("section-divider")).toHaveLength(2);
  });

  it("shows only one divider (Branches/Tags) when remotes are hidden", () => {
    useBranchScopeStore.setState({ showRemoteBranches: false });
    render(<BranchTree />);
    expect(screen.getAllByTestId("section-divider")).toHaveLength(1);
  });

  describe("per-section exact-match filters", () => {
    beforeEach(() => {
      useWorkspaceStore.setState({
        branches: [
          { name: "main", isRemote: false, isHead: true, targetOid: "a" },
          { name: "feature/foo", isRemote: false, isHead: false, targetOid: "a" },
          { name: "origin/main", isRemote: true, isHead: false, targetOid: "a" },
          { name: "origin/feature/foo", isRemote: true, isHead: false, targetOid: "a" },
        ],
        tags: [
          { name: "v1.0.0", targetOid: "a" },
          { name: "v2.0.0", targetOid: "a" },
        ],
      });
    });

    it("shows a filter input after clicking the branch search icon, narrowing local and remote lists by exact substring", () => {
      render(<BranchTree />);
      fireEvent.click(screen.getByRole("button", { name: "Search branches" }));
      fireEvent.change(screen.getByPlaceholderText("Filter branches..."), { target: { value: "feature" } });

      expect(screen.queryByText("main")).not.toBeInTheDocument();
      expect(screen.getByText("feature/foo")).toBeInTheDocument();

      fireEvent.click(screen.getByText(/Remotes/));
      expect(screen.queryByText("origin/main")).not.toBeInTheDocument();
      expect(screen.getByText("origin/feature/foo")).toBeInTheDocument();
    });

    it("does not fuzzy-match the branch filter — scattered characters that fuzzy would accept show nothing", () => {
      render(<BranchTree />);
      fireEvent.click(screen.getByRole("button", { name: "Search branches" }));
      // "man" fuzzy-matches "main" (m-a-...-n via skipping) but is not a
      // literal substring of it, so an exact-match filter must exclude it.
      fireEvent.change(screen.getByPlaceholderText("Filter branches..."), { target: { value: "man" } });
      expect(screen.queryByText("main")).not.toBeInTheDocument();
    });

    it("clearing the branch filter restores the full list", () => {
      render(<BranchTree />);
      fireEvent.click(screen.getByRole("button", { name: "Search branches" }));
      fireEvent.change(screen.getByPlaceholderText("Filter branches..."), { target: { value: "feature" } });
      fireEvent.click(screen.getByRole("button", { name: "Clear branch filter" }));
      expect(screen.getByText("main")).toBeInTheDocument();
      expect(screen.getByText("feature/foo")).toBeInTheDocument();
    });

    it("Escape closes and clears the branch filter", () => {
      render(<BranchTree />);
      fireEvent.click(screen.getByRole("button", { name: "Search branches" }));
      const input = screen.getByPlaceholderText("Filter branches...");
      fireEvent.change(input, { target: { value: "feature" } });
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByPlaceholderText("Filter branches...")).not.toBeInTheDocument();
      expect(screen.getByText("main")).toBeInTheDocument();
    });

    it("shows a filter input after clicking the tag search icon, narrowing tags by exact substring", () => {
      render(<BranchTree />);
      fireEvent.click(screen.getByRole("button", { name: "Search tags" }));
      fireEvent.change(screen.getByPlaceholderText("Filter tags..."), { target: { value: "2.0" } });
      expect(screen.queryByText("v1.0.0")).not.toBeInTheDocument();
      expect(screen.getByText("v2.0.0")).toBeInTheDocument();
    });

    it("combines with the global search query (AND) instead of replacing it", async () => {
      const { useSearchStore } = await import("../store/searchStore");
      act(() => {
        useSearchStore.setState({ query: "main" });
      });
      render(<BranchTree />);
      fireEvent.click(screen.getByRole("button", { name: "Search branches" }));
      fireEvent.change(screen.getByPlaceholderText("Filter branches..."), { target: { value: "orig" } });

      // "main" alone matches the global query but not the local "orig" filter.
      expect(screen.queryByText("main")).not.toBeInTheDocument();
      // "origin/main" matches both the global fuzzy query ("main") and the
      // local exact filter ("orig").
      fireEvent.click(screen.getByText(/Remotes/));
      expect(screen.getByText("origin/main")).toBeInTheDocument();

      act(() => {
        useSearchStore.setState({ query: "" });
      });
    });
  });
  it("shows a CI badge on a branch whose tip has a failing status", () => {
    useCiStatusStore.setState({ byOid: { a: { oid: "a", state: "failure", total: 2, failed: 1, pending: 0, byWorkflow: [] } } });
    render(<BranchTree />);
    expect(screen.getByLabelText("CI failed")).toBeInTheDocument();
    cleanup();
    useCiStatusStore.setState({ byOid: {} });
  });

  it("requests tip statuses for windowed local branches only when GitHub is available", () => {
    const original = useCiStatusStore.getState().request;
    const request = vi.fn();
    useCiStatusStore.setState({ request });
    useGithubStore.setState({ status: { available: true, owner: "o", repo: "r", reason: null } });
    const { unmount } = render(<BranchTree />);
    expect(request).toHaveBeenCalledWith("/tmp/a", ["a"]);
    unmount();
    request.mockClear();
    useGithubStore.setState({ status: null });
    render(<BranchTree />);
    expect(request).not.toHaveBeenCalled();
    useCiStatusStore.setState({ request: original });
  });
  it("requests tip statuses when GitHub becomes available after mount, without scrolling", () => {
    const original = useCiStatusStore.getState().request;
    const request = vi.fn();
    useCiStatusStore.setState({ request });
    useGithubStore.setState({ status: null });
    render(<BranchTree />);
    expect(request).not.toHaveBeenCalled();
    act(() => {
      useGithubStore.setState({ status: { available: true, owner: "o", repo: "r", reason: null } });
    });
    expect(request).toHaveBeenCalledWith("/tmp/a", ["a"]);
    expect(request).toHaveBeenCalledTimes(1);
    cleanup();
    useGithubStore.setState({ status: null });
    useCiStatusStore.setState({ request: original });
  });

  describe("pinned current branch", () => {
    beforeEach(() => {
      useWorkspaceStore.setState({
        branches: [
          { name: "alpha", isRemote: false, isHead: false, targetOid: "a" },
          { name: "zeta", isRemote: false, isHead: true, targetOid: "z" },
          { name: "origin/zeta", isRemote: true, isHead: false, targetOid: "z" },
        ],
        headDetached: false,
        headOid: "z",
      });
    });

    it("renders the current branch as a pinned row, not duplicated in the virtual list", () => {
      render(<BranchTree />);
      const pinned = screen.getByTestId("pinned-branch");
      expect(pinned).toHaveTextContent("zeta");
      expect(pinned.querySelector("[data-head]")).toHaveAttribute("data-head", "true");
      expect(screen.getAllByText("zeta")).toHaveLength(1);
      expect(screen.getByTestId("local-branches")).not.toHaveTextContent("zeta");
      expect(screen.getByTestId("local-branches")).toHaveTextContent("alpha");
    });

    it("keeps double-click checkout and the context menu on the pinned row", async () => {
      const switchBranch = vi.fn().mockResolvedValue(undefined);
      useWorkspaceStore.setState({ switchBranch });
      render(<BranchTree />);
      fireEvent.doubleClick(screen.getByText("zeta"));
      await waitFor(() => expect(switchBranch).toHaveBeenCalledWith("/tmp/a", "zeta", false));
      fireEvent.contextMenu(screen.getByText("zeta"));
      expect(screen.getByText("Copy branch name")).toBeInTheDocument();
    });

    it("hides the pinned row when the branch filter excludes the current branch", () => {
      render(<BranchTree />);
      fireEvent.click(screen.getByLabelText("Search branches"));
      fireEvent.change(screen.getByLabelText("Filter branches"), { target: { value: "alp" } });
      expect(screen.queryByTestId("pinned-branch")).not.toBeInTheDocument();
      expect(screen.getByText("alpha")).toBeInTheDocument();
    });

    it("keeps the pinned row when the branch filter matches it", () => {
      render(<BranchTree />);
      fireEvent.click(screen.getByLabelText("Search branches"));
      fireEvent.change(screen.getByLabelText("Filter branches"), { target: { value: "zet" } });
      expect(screen.getByTestId("pinned-branch")).toHaveTextContent("zeta");
      expect(screen.queryByText("alpha")).not.toBeInTheDocument();
    });

    it("hides the pinned row when the global search query excludes it", async () => {
      const { useSearchStore } = await import("../store/searchStore");
      render(<BranchTree />);
      act(() => {
        useSearchStore.setState({ query: "alpha" });
      });
      expect(screen.queryByTestId("pinned-branch")).not.toBeInTheDocument();
      act(() => {
        useSearchStore.setState({ query: "" });
      });
    });

    it("has no pinned row when HEAD is detached", () => {
      useWorkspaceStore.setState({
        branches: [{ name: "alpha", isRemote: false, isHead: false, targetOid: "a" }],
        headDetached: true,
        headOid: "z",
      });
      render(<BranchTree />);
      expect(screen.queryByTestId("pinned-branch")).not.toBeInTheDocument();
      expect(screen.getByText(/Detached @/)).toBeInTheDocument();
    });

    it("requests the CI status for the pinned branch tip", () => {
      const original = useCiStatusStore.getState().request;
      const request = vi.fn();
      useCiStatusStore.setState({ request });
      useGithubStore.setState({ status: { available: true, owner: "o", repo: "r", reason: null } });
      render(<BranchTree />);
      expect(request).toHaveBeenCalledWith("/tmp/a", ["z"]);
      cleanup();
      useGithubStore.setState({ status: null });
      useCiStatusStore.setState({ request: original });
    });
  });
});
